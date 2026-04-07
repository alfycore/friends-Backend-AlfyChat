// ==========================================
// ALFYCHAT - SERVICE AMIS
// ==========================================

import { v4 as uuidv4 } from 'uuid';
import { getDatabaseClient } from '../database';
import { getRedisClient } from '../redis';
import { Friend, FriendRequest, FriendUser, FriendStatus } from '../types/friend';

export class FriendService {
  private get db() {
    return getDatabaseClient();
  }

  private get redis() {
    return getRedisClient();
  }

  // Envoyer une demande d'ami
  async sendRequest(fromUserId: string, toUserId: string): Promise<FriendRequest> {
    // Empêcher l'auto-demande
    if (fromUserId === toUserId) {
      throw new Error('Vous ne pouvez pas vous envoyer une demande d\'ami');
    }
    // Vérifier si une relation existe déjà
    const [existing] = await this.db.query(
      `SELECT * FROM friends 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [fromUserId, toUserId, toUserId, fromUserId]
    );

    if ((existing as any[]).length > 0) {
      const rel = (existing as any[])[0];
      if (rel.status === 'blocked') {
        throw new Error('Impossible d\'envoyer une demande');
      }
      throw new Error('Une relation existe déjà');
    }

    const requestId = uuidv4();
    await this.db.execute(
      `INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, 'pending')`,
      [requestId, fromUserId, toUserId]
    );

    // Récupérer les infos de l'expéditeur
    const fromUser = await this.getUserInfo(fromUserId);

    return {
      id: requestId,
      fromUser: fromUser!,
      toUserId,
      status: 'pending',
      createdAt: new Date(),
    };
  }

  // Accepter une demande d'ami
  async acceptRequest(requestId: string, userId: string): Promise<void> {
    const [result] = await this.db.execute(
      `UPDATE friends SET status = 'accepted' 
       WHERE id = ? AND friend_id = ? AND status = 'pending'`,
      [requestId, userId]
    );

    if ((result as any).affectedRows === 0) {
      throw new Error('Demande non trouvée');
    }

    // Invalider le cache
    const [request] = await this.db.query('SELECT * FROM friends WHERE id = ?', [requestId]);
    if ((request as any[]).length > 0) {
      await this.invalidateCache((request as any[])[0].user_id);
      await this.invalidateCache(userId);
    }
  }

  // Refuser une demande d'ami
  async rejectRequest(requestId: string, userId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM friends WHERE id = ? AND friend_id = ? AND status = 'pending'`,
      [requestId, userId]
    );
  }

  // Supprimer un ami
  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM friends 
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
       AND status = 'accepted'`,
      [userId, friendId, friendId, userId]
    );

    await this.invalidateCache(userId);
    await this.invalidateCache(friendId);
  }

  // Bloquer un utilisateur
  async blockUser(userId: string, blockedUserId: string): Promise<void> {
    // Supprimer toute relation existante
    await this.db.execute(
      `DELETE FROM friends 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [userId, blockedUserId, blockedUserId, userId]
    );

    // Créer la relation de blocage
    await this.db.execute(
      `INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, 'blocked')`,
      [uuidv4(), userId, blockedUserId]
    );

    await this.invalidateCache(userId);
  }

  // Débloquer un utilisateur
  async unblockUser(userId: string, blockedUserId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'blocked'`,
      [userId, blockedUserId]
    );

    await this.invalidateCache(userId);
  }

  // Récupérer la liste d'amis
  async getFriends(userId: string): Promise<Friend[]> {
    // Vérifier le cache
    const cached = await this.redis.get(`friends:${userId}`);
    if (cached) {
      return JSON.parse(cached as string);
    }

    const [rows] = await this.db.query(
      `SELECT f.*, 
              u.id as friend_user_id, u.username, u.display_name, 
              u.avatar_url, u.status as user_status, u.is_online
       FROM friends f
       JOIN users u ON (
         CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END = u.id
       )
       WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'`,
      [userId, userId, userId]
    );

    const friends = (rows as any[]).map(row => this.formatFriend(row, userId));

    // Mettre en cache (5 minutes)
    await this.redis.set(`friends:${userId}`, JSON.stringify(friends), { EX: 300 });

    return friends;
  }

  // Récupérer les demandes reçues
  async getPendingRequests(userId: string): Promise<FriendRequest[]> {
    const [rows] = await this.db.query(
      `SELECT f.*, 
              u.id as from_user_id, u.username, u.display_name, 
              u.avatar_url, u.status as user_status, u.is_online
       FROM friends f
       JOIN users u ON f.user_id = u.id
       WHERE f.friend_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId]
    );

    return (rows as any[]).map(row => ({
      id: row.id,
      fromUser: {
        id: row.from_user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        status: row.user_status,
        isOnline: Boolean(row.is_online),
      },
      toUserId: userId,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  // Récupérer les utilisateurs bloqués
  async getBlockedUsers(userId: string): Promise<FriendUser[]> {
    const [rows] = await this.db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, u.is_online
       FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = 'blocked'`,
      [userId]
    );

    return (rows as any[]).map(row => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      status: row.status,
      isOnline: Boolean(row.is_online),
    }));
  }

  // Vérifier si deux utilisateurs sont amis
  async areFriends(userId1: string, userId2: string): Promise<boolean> {
    const [rows] = await this.db.query(
      `SELECT 1 FROM friends 
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
       AND status = 'accepted'`,
      [userId1, userId2, userId2, userId1]
    );

    return (rows as any[]).length > 0;
  }

  // Helpers privés
  private async getUserInfo(userId: string): Promise<FriendUser | null> {
    const [rows] = await this.db.query(
      'SELECT id, username, display_name, avatar_url, status, is_online FROM users WHERE id = ?',
      [userId]
    );

    if ((rows as any[]).length === 0) return null;

    const row = (rows as any[])[0];
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      status: row.status,
      isOnline: Boolean(row.is_online),
    };
  }

  private async invalidateCache(userId: string): Promise<void> {
    await this.redis.del(`friends:${userId}`);
  }

  private formatFriend(row: any, currentUserId: string): Friend {
    return {
      id: row.id,
      userId: row.user_id,
      friendId: row.friend_id,
      status: row.status,
      createdAt: row.created_at,
      friend: {
        id: row.friend_user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        status: row.user_status,
        isOnline: Boolean(row.is_online),
      },
    };
  }
}

export const friendService = new FriendService();
