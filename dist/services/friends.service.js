"use strict";
// ==========================================
// ALFYCHAT - SERVICE AMIS
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.friendService = exports.FriendService = void 0;
const uuid_1 = require("uuid");
const database_1 = require("../database");
const redis_1 = require("../redis");
class FriendService {
    get db() {
        return (0, database_1.getDatabaseClient)();
    }
    get redis() {
        return (0, redis_1.getRedisClient)();
    }
    // Envoyer une demande d'ami
    async sendRequest(fromUserId, toUserId) {
        // Vérifier si une relation existe déjà
        const [existing] = await this.db.query(`SELECT * FROM friends 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`, [fromUserId, toUserId, toUserId, fromUserId]);
        if (existing.length > 0) {
            const rel = existing[0];
            if (rel.status === 'blocked') {
                throw new Error('Impossible d\'envoyer une demande');
            }
            throw new Error('Une relation existe déjà');
        }
        const requestId = (0, uuid_1.v4)();
        await this.db.execute(`INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, 'pending')`, [requestId, fromUserId, toUserId]);
        // Récupérer les infos de l'expéditeur
        const fromUser = await this.getUserInfo(fromUserId);
        return {
            id: requestId,
            fromUser: fromUser,
            toUserId,
            status: 'pending',
            createdAt: new Date(),
        };
    }
    // Accepter une demande d'ami
    async acceptRequest(requestId, userId) {
        const [result] = await this.db.execute(`UPDATE friends SET status = 'accepted' 
       WHERE id = ? AND friend_id = ? AND status = 'pending'`, [requestId, userId]);
        if (result.affectedRows === 0) {
            throw new Error('Demande non trouvée');
        }
        // Invalider le cache
        const [request] = await this.db.query('SELECT * FROM friends WHERE id = ?', [requestId]);
        if (request.length > 0) {
            await this.invalidateCache(request[0].user_id);
            await this.invalidateCache(userId);
        }
    }
    // Refuser une demande d'ami
    async rejectRequest(requestId, userId) {
        await this.db.execute(`DELETE FROM friends WHERE id = ? AND friend_id = ? AND status = 'pending'`, [requestId, userId]);
    }
    // Supprimer un ami
    async removeFriend(userId, friendId) {
        await this.db.execute(`DELETE FROM friends 
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
       AND status = 'accepted'`, [userId, friendId, friendId, userId]);
        await this.invalidateCache(userId);
        await this.invalidateCache(friendId);
    }
    // Bloquer un utilisateur
    async blockUser(userId, blockedUserId) {
        // Supprimer toute relation existante
        await this.db.execute(`DELETE FROM friends 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`, [userId, blockedUserId, blockedUserId, userId]);
        // Créer la relation de blocage
        await this.db.execute(`INSERT INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, 'blocked')`, [(0, uuid_1.v4)(), userId, blockedUserId]);
        await this.invalidateCache(userId);
    }
    // Débloquer un utilisateur
    async unblockUser(userId, blockedUserId) {
        await this.db.execute(`DELETE FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'blocked'`, [userId, blockedUserId]);
        await this.invalidateCache(userId);
    }
    // Récupérer la liste d'amis
    async getFriends(userId) {
        // Vérifier le cache
        const cached = await this.redis.get(`friends:${userId}`);
        if (cached) {
            return JSON.parse(cached);
        }
        const [rows] = await this.db.query(`SELECT f.*, 
              u.id as friend_user_id, u.username, u.display_name, 
              u.avatar_url, u.status as user_status, u.is_online
       FROM friends f
       JOIN users u ON (
         CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END = u.id
       )
       WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'`, [userId, userId, userId]);
        const friends = rows.map(row => this.formatFriend(row, userId));
        // Mettre en cache (5 minutes)
        await this.redis.set(`friends:${userId}`, JSON.stringify(friends), { EX: 300 });
        return friends;
    }
    // Récupérer les demandes reçues
    async getPendingRequests(userId) {
        const [rows] = await this.db.query(`SELECT f.*, 
              u.id as from_user_id, u.username, u.display_name, 
              u.avatar_url, u.status as user_status, u.is_online
       FROM friends f
       JOIN users u ON f.user_id = u.id
       WHERE f.friend_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`, [userId]);
        return rows.map(row => ({
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
    async getBlockedUsers(userId) {
        const [rows] = await this.db.query(`SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, u.is_online
       FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = 'blocked'`, [userId]);
        return rows.map(row => ({
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            avatarUrl: row.avatar_url,
            status: row.status,
            isOnline: Boolean(row.is_online),
        }));
    }
    // Vérifier si deux utilisateurs sont amis
    async areFriends(userId1, userId2) {
        const [rows] = await this.db.query(`SELECT 1 FROM friends 
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
       AND status = 'accepted'`, [userId1, userId2, userId2, userId1]);
        return rows.length > 0;
    }
    // Helpers privés
    async getUserInfo(userId) {
        const [rows] = await this.db.query('SELECT id, username, display_name, avatar_url, status, is_online FROM users WHERE id = ?', [userId]);
        if (rows.length === 0)
            return null;
        const row = rows[0];
        return {
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            avatarUrl: row.avatar_url,
            status: row.status,
            isOnline: Boolean(row.is_online),
        };
    }
    async invalidateCache(userId) {
        await this.redis.del(`friends:${userId}`);
    }
    formatFriend(row, currentUserId) {
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
exports.FriendService = FriendService;
exports.friendService = new FriendService();
//# sourceMappingURL=friends.service.js.map