"use strict";
// ==========================================
// ALFYCHAT - SERVICE AMIS
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.app = void 0;
exports.getDatabase = getDatabase;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_2 = require("express");
const express_validator_1 = require("express-validator");
const uuid_1 = require("uuid");
const promise_1 = __importDefault(require("mysql2/promise"));
const winston_1 = __importDefault(require("winston"));
dotenv_1.default.config();
const app = (0, express_1.default)();
exports.app = app;
app.use((0, cors_1.default)());
app.use((0, helmet_1.default)());
app.use(express_1.default.json());
// Logger
const logger = winston_1.default.createLogger({
    level: 'info',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.simple()),
    transports: [new winston_1.default.transports.Console()],
});
exports.logger = logger;
// Database
let pool;
function getDatabase() {
    return pool;
}
function getDb() {
    return {
        async query(sql, params) {
            const [rows] = await pool.execute(sql, params);
            return [rows];
        },
        async execute(sql, params) {
            const [result] = await pool.execute(sql, params);
            return result;
        },
    };
}
// Routes
const friendsRouter = (0, express_2.Router)();
// Récupérer les amis
friendsRouter.get('/', async (req, res) => {
    try {
        const { userId } = req.query;
        const db = getDb();
        const [friends] = await db.query(`SELECT f.*, 
              u.username, u.display_name, u.avatar_url, u.status, u.is_online
       FROM friends f
       JOIN users u ON (f.friend_id = u.id AND f.user_id = ?) OR (f.user_id = u.id AND f.friend_id = ?)
       WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted' AND u.id != ?`, [userId, userId, userId, userId, userId]);
        res.json(friends);
    }
    catch (error) {
        logger.error('Erreur récupération amis:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Récupérer les demandes d'amis en attente
friendsRouter.get('/requests', async (req, res) => {
    try {
        const { userId } = req.query;
        const db = getDb();
        const [received] = await db.query(`SELECT f.*, u.username, u.display_name, u.avatar_url
       FROM friends f
       JOIN users u ON f.user_id = u.id
       WHERE f.friend_id = ? AND f.status = 'pending'`, [userId]);
        const [sent] = await db.query(`SELECT f.*, u.username, u.display_name, u.avatar_url
       FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = 'pending'`, [userId]);
        res.json({ received, sent });
    }
    catch (error) {
        logger.error('Erreur récupération demandes:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Envoyer une demande d'ami
friendsRouter.post('/requests', (0, express_validator_1.body)('fromUserId').isUUID(), (0, express_validator_1.body)('toUserId').isUUID(), async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { fromUserId, toUserId, message } = req.body;
        const db = getDb();
        const id = (0, uuid_1.v4)();
        // Vérifier si une relation existe déjà
        const [existing] = await db.query(`SELECT id, status FROM friends 
         WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`, [fromUserId, toUserId, toUserId, fromUserId]);
        if (existing.length > 0) {
            const relation = existing[0];
            if (relation.status === 'blocked') {
                return res.status(403).json({ error: 'Impossible d\'envoyer une demande' });
            }
            return res.status(409).json({ error: 'Demande déjà envoyée ou déjà amis' });
        }
        await db.execute('INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)', [id, fromUserId, toUserId, 'pending']);
        logger.info(`Demande d'ami envoyée: ${fromUserId} -> ${toUserId}`);
        res.status(201).json({ id, fromUserId, toUserId, status: 'pending' });
    }
    catch (error) {
        logger.error('Erreur envoi demande:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Accepter une demande d'ami
friendsRouter.post('/requests/:requestId/accept', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { userId } = req.body;
        const db = getDb();
        // Vérifier que la demande existe et est pour cet utilisateur
        const [requests] = await db.query('SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = ?', [requestId, userId, 'pending']);
        if (requests.length === 0) {
            return res.status(404).json({ error: 'Demande non trouvée' });
        }
        await db.execute('UPDATE friends SET status = ? WHERE id = ?', ['accepted', requestId]);
        const request = requests[0];
        logger.info(`Demande d'ami acceptée: ${request.user_id} <-> ${request.friend_id}`);
        res.json({ ...request, status: 'accepted' });
    }
    catch (error) {
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
        await db.execute('DELETE FROM friends WHERE id = ? AND friend_id = ? AND status = ?', [requestId, userId, 'pending']);
        res.json({ success: true });
    }
    catch (error) {
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
        await db.execute(`DELETE FROM friends 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`, [userId, friendId, friendId, userId]);
        res.json({ success: true });
    }
    catch (error) {
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
        const id = (0, uuid_1.v4)();
        // Supprimer toute relation existante
        await db.execute(`DELETE FROM friends 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`, [userId, targetId, targetId, userId]);
        // Créer un blocage
        await db.execute('INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)', [id, userId, targetId, 'blocked']);
        res.json({ success: true });
    }
    catch (error) {
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
        await db.execute('DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?', [userId, targetId, 'blocked']);
        res.json({ success: true });
    }
    catch (error) {
        logger.error('Erreur déblocage:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
// Récupérer les utilisateurs bloqués
friendsRouter.get('/blocked', async (req, res) => {
    try {
        const { userId } = req.query;
        const db = getDb();
        const [blocked] = await db.query(`SELECT f.friend_id as id, u.username, u.display_name, u.avatar_url
       FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = 'blocked'`, [userId]);
        res.json(blocked);
    }
    catch (error) {
        logger.error('Erreur récupération bloqués:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});
app.use('/friends', friendsRouter);
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'friends' });
});
async function start() {
    try {
        pool = promise_1.default.createPool({
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
        });
    }
    catch (error) {
        logger.error('Erreur au démarrage:', error);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map