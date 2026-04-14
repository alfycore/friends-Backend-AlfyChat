// ==========================================
// ALFYCHAT - SERVICE AMIS
// ==========================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import mysql, { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import winston from 'winston';
import { authMiddleware } from './middleware/auth';
import { startServiceRegistration, serviceMetricsMiddleware, collectServiceMetrics } from './utils/service-client';

dotenv.config();

const _allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:4000')
  .split(',').map((o) => o.trim());

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    if (_allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origine non autorisée — ${origin}`));
  },
  credentials: true,
}));
app.use(helmet());
app.use(express.json());
app.use(serviceMetricsMiddleware);

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

// Database
let pool: Pool;

export function getDatabase() {
  return pool;
}

function getDb() {
  return {
    async query<T extends RowDataPacket[]>(sql: string, params?: any[]): Promise<T[]> {
      const [rows] = await pool.execute<T>(sql, params);
      return [rows];
    },
    async execute(sql: string, params?: any[]): Promise<ResultSetHeader> {
      const [result] = await pool.execute<ResultSetHeader>(sql, params);
      return result;
    },
  };
}

// Helper partagé : récupère les infos utilisateur depuis la DB MySQL commune.
// On lit directement la table `users` — pas de round-trip HTTP, donc plus de
// fallback "Unknown" quand le service users n'est pas joignable.
interface UserInfoRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string | null;
  is_online: number | boolean | null;
}
async function fetchUsersByIds(userIds: string[]): Promise<Record<string, {
  id: string; username: string; displayName: string | null; avatarUrl: string | null;
  status: string; isOnline: boolean;
}>> {
  if (userIds.length === 0) return {};
  const placeholders = userIds.map(() => '?').join(',');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, username, display_name, avatar_url, status, is_online
     FROM users WHERE id IN (${placeholders})`,
    userIds,
  );
  const map: Record<string, any> = {};
  for (const r of rows as UserInfoRow[]) {
    map[r.id] = {
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      status: r.status || 'offline',
      isOnline: Boolean(r.is_online),
    };
  }
  return map;
}

// Routes
const friendsRouter = Router();

// Stockage temporaire en mémoire (pour le debug)
let tempFriends: any[] = [];
let tempRequests: { id: string; fromUser: string; toUser: string; status: string; createdAt: string }[] = [];

// Récupérer les amis
friendsRouter.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const db = getDb();
    
    // Récupérer les IDs des amis acceptés depuis la DB
    const [friendships] = await db.query<RowDataPacket[]>(
      `SELECT 
         CASE 
           WHEN user_id = ? THEN friend_id 
           ELSE user_id 
         END as friendId
       FROM friends
       WHERE (user_id = ? OR friend_id = ?) 
         AND status = 'accepted'`,
      [userId, userId, userId]
    );
    
    // Si pas d'amis, retourner un tableau vide
    if (friendships.length === 0) {
      return res.json([]);
    }
    
    const friendIds = friendships.map((f: any) => f.friendId);
    const usersMap = await fetchUsersByIds(friendIds);
    res.json(friendIds.map((id) => usersMap[id]).filter(Boolean));
  } catch (error) {
    logger.error('Erreur récupération amis:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Envoyer une demande d'ami
friendsRouter.post('/request', authMiddleware, async (req, res) => {
  try {
    const userIdOrUsername = req.body.userId || req.body.targetUserId;
    const fromUserId = (req as any).userId;
    
    if (!userIdOrUsername) {
      return res.status(400).json({ error: 'UserId ou username requis' });
    }

    const db = getDb();
    
    // Chercher l'utilisateur par ID ou username
    let targetUserId = userIdOrUsername;
    
    // Si ce n'est pas un UUID, chercher par username
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userIdOrUsername)) {
      const [users] = await db.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE username = ?',
        [userIdOrUsername]
      );
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }
      
      targetUserId = users[0].id;
    }
    
    // Vérifier qu'on ne s'envoie pas une demande à soi-même
    if (targetUserId === fromUserId) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous envoyer une demande d\'ami' });
    }
    
    const requestId = uuidv4();
    
    // Vérifier si une relation existe déjà
    const [existing] = await db.query<RowDataPacket[]>(
      `SELECT id, status FROM friends 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [fromUserId, targetUserId, targetUserId, fromUserId]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Demande déjà envoyée ou déjà amis' });
    }
    
    // Insérer la demande dans la DB
    await db.execute(
      'INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)',
      [requestId, fromUserId, targetUserId, 'pending']
    );

    logger.info(`Demande d'ami ajoutée: ${requestId}`);

    res.status(201).json({ success: true, message: 'Demande envoyée', id: requestId, toUserId: targetUserId, fromUserId });
  } catch (error) {
    logger.error('Erreur envoi demande:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Récupérer les demandes d'amis en attente
friendsRouter.get('/requests', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const db = getDb();
    
    // Demandes reçues (IDs uniquement)
    const [receivedRows] = await db.query<RowDataPacket[]>(
      `SELECT f.id, f.user_id as userId
       FROM friends f
       WHERE f.friend_id = ? AND f.status = 'pending'`,
      [userId]
    );
    
    // Demandes envoyées (IDs uniquement)
    const [sentRows] = await db.query<RowDataPacket[]>(
      `SELECT f.id, f.friend_id as userId
       FROM friends f
       WHERE f.user_id = ? AND f.status = 'pending'`,
      [userId]
    );
    
    // Si pas de demandes, retourner des tableaux vides
    if (receivedRows.length === 0 && sentRows.length === 0) {
      return res.json({ received: [], sent: [] });
    }
    
    // Récupérer les infos utilisateur depuis le service Users
    const allUserIds = [
      ...receivedRows.map((r: any) => r.userId),
      ...sentRows.map((s: any) => s.userId)
    ];
    
    if (allUserIds.length === 0) {
      return res.json({ received: [], sent: [] });
    }
    
    const usersMap = await fetchUsersByIds(allUserIds);

    const received = receivedRows
      .map((r: any) => {
        const u = usersMap[r.userId];
        if (!u) return null;
        return {
          id: r.id,
          userId: r.userId,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          message: 'Demande d\'ami',
        };
      })
      .filter(Boolean);

    const sent = sentRows
      .map((s: any) => {
        const u = usersMap[s.userId];
        if (!u) return null;
        return {
          id: s.id,
          userId: s.userId,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
        };
      })
      .filter(Boolean);

    res.json({ received, sent });
  } catch (error) {
    logger.error('Erreur récupération demandes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Accepter une demande d'ami
friendsRouter.post('/request/:requestId/accept', authMiddleware, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = (req as any).userId;
    const db = getDb();
    
    // Vérifier que la demande existe et est pour cet utilisateur
    const [requests] = await db.query<RowDataPacket[]>(
      'SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = ?',
      [requestId, userId, 'pending']
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }
    
    await db.execute(
      'UPDATE friends SET status = ? WHERE id = ?',
      ['accepted', requestId]
    );
    
    logger.info(`Demande d'ami acceptée: ${requestId}`);
    
    res.json({ success: true, message: 'Demande acceptée' });
  } catch (error) {
    logger.error('Erreur acceptation demande:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Refuser une demande d'ami
friendsRouter.post('/request/:requestId/decline', authMiddleware, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = (req as any).userId;
    const db = getDb();
    
    await db.execute(
      'DELETE FROM friends WHERE id = ? AND friend_id = ? AND status = ?',
      [requestId, userId, 'pending']
    );
    
    logger.info(`Demande d'ami refusée: ${requestId}`);
    
    res.json({ success: true, message: 'Demande refusée' });
  } catch (error) {
    logger.error('Erreur refus demande:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Envoyer une demande d'ami
friendsRouter.post('/requests',
  body('fromUserId').isUUID(),
  body('toUserId').isUUID(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { fromUserId, toUserId, message } = req.body;
      const db = getDb();
      const id = uuidv4();

      // Vérifier si une relation existe déjà
      const [existing] = await db.query(
        `SELECT id, status FROM friends 
         WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
        [fromUserId, toUserId, toUserId, fromUserId]
      );

      if (existing.length > 0) {
        const relation = (existing as any[])[0];
        if (relation.status === 'blocked') {
          return res.status(403).json({ error: 'Impossible d\'envoyer une demande' });
        }
        return res.status(409).json({ error: 'Demande déjà envoyée ou déjà amis' });
      }

      await db.execute(
        'INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)',
        [id, fromUserId, toUserId, 'pending']
      );

      logger.info(`Demande d'ami envoyée: ${fromUserId} -> ${toUserId}`);

      res.status(201).json({ id, fromUserId, toUserId, status: 'pending' });
    } catch (error) {
      logger.error('Erreur envoi demande:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// Accepter une demande d'ami
friendsRouter.post('/requests/:requestId/accept', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { userId } = req.body;
    const db = getDb();

    // Vérifier que la demande existe et est pour cet utilisateur
    const [requests] = await db.query(
      'SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = ?',
      [requestId, userId, 'pending']
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    await db.execute(
      'UPDATE friends SET status = ? WHERE id = ?',
      ['accepted', requestId]
    );

    const request = (requests as any[])[0];
    logger.info(`Demande d'ami acceptée: ${request.user_id} <-> ${request.friend_id}`);

    res.json({ ...request, status: 'accepted' });
  } catch (error) {
    logger.error('Erreur acceptation demande:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Refuser une demande d'ami
friendsRouter.post('/requests/:requestId/decline', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { userId } = req.body;
    const db = getDb();

    await db.execute(
      'DELETE FROM friends WHERE id = ? AND friend_id = ? AND status = ?',
      [requestId, userId, 'pending']
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Erreur refus demande:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Supprimer un ami
friendsRouter.delete('/:friendId', async (req, res) => {
  try {
    const { friendId } = req.params;
    const { userId } = req.body;
    const db = getDb();

    await db.execute(
      `DELETE FROM friends 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [userId, friendId, friendId, userId]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Erreur suppression ami:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Bloquer un utilisateur
friendsRouter.post('/:userId/block', async (req, res) => {
  try {
    const { userId: targetId } = req.params;
    const { userId } = req.body;
    const db = getDb();
    const id = uuidv4();

    // Supprimer toute relation existante
    await db.execute(
      `DELETE FROM friends 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [userId, targetId, targetId, userId]
    );

    // Créer un blocage
    await db.execute(
      'INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)',
      [id, userId, targetId, 'blocked']
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Erreur blocage:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Débloquer un utilisateur
friendsRouter.post('/:userId/unblock', async (req, res) => {
  try {
    const { userId: targetId } = req.params;
    const { userId } = req.body;
    const db = getDb();

    await db.execute(
      'DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?',
      [userId, targetId, 'blocked']
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Erreur déblocage:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Récupérer les utilisateurs bloqués
friendsRouter.get('/blocked', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const db = getDb();

    const [blocked] = await db.query<RowDataPacket[]>(
      `SELECT f.friend_id as id, u.username, u.display_name as displayName, u.avatar_url as avatarUrl
       FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = 'blocked'`,
      [userId]
    );

    res.json(blocked);
  } catch (error) {
    logger.error('Erreur récupération bloqués:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Vérifier le statut de blocage avec un autre utilisateur
friendsRouter.get('/block-status/:otherId', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { otherId } = req.params;
    const db = getDb();

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT user_id, friend_id FROM friends
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
       AND status = 'blocked'`,
      [userId, otherId, otherId, userId]
    );

    let iBlockedThem = false;
    let theyBlockedMe = false;
    for (const row of rows) {
      if (row.user_id === userId) iBlockedThem = true;
      if (row.user_id === otherId) theyBlockedMe = true;
    }

    res.json({ iBlockedThem, theyBlockedMe });
  } catch (error) {
    logger.error('Erreur vérification blocage:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.use('/friends', friendsRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'friends' });
});

app.get('/metrics', (req, res) => {
  res.json({
    service: 'friends',
    serviceId: process.env.SERVICE_ID || 'friends-default',
    location: (process.env.SERVICE_LOCATION || 'EU').toUpperCase(),
    ...collectServiceMetrics(),
    uptime: process.uptime(),
  });
});

async function start() {
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'alfychat',
      password: process.env.DB_PASSWORD || 'alfychat',
      database: process.env.DB_NAME || 'alfychat',
      connectionLimit: 10,
    });

    // Migration
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS friends (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        friend_id VARCHAR(36) NOT NULL,
        status ENUM('pending', 'accepted', 'blocked') DEFAULT 'pending',
        nickname VARCHAR(64),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_friendship (user_id, friend_id),
        INDEX idx_user_friends (user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const PORT = process.env.PORT || 3003;
    app.listen(PORT, () => {
      logger.info(`🚀 Service Friends démarré sur le port ${PORT}`);
      startServiceRegistration('friends');
    });
  } catch (error) {
    logger.error('Erreur au démarrage:', error);
    process.exit(1);
  }
}

start();

export { app, logger };
