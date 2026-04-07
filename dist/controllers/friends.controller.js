"use strict";
// ==========================================
// ALFYCHAT - CONTRÔLEUR AMIS
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.friendController = exports.FriendController = void 0;
const friends_service_1 = require("../services/friends.service");
const index_1 = require("../index");
const friendService = new friends_service_1.FriendService();
class FriendController {
    // Envoyer une demande d'ami
    async sendRequest(req, res) {
        try {
            const { fromUserId, toUserId } = req.body;
            const request = await friendService.sendRequest(fromUserId, toUserId);
            index_1.logger.info(`Demande d'ami envoyée: ${fromUserId} -> ${toUserId}`);
            res.status(201).json(request);
        }
        catch (error) {
            index_1.logger.error('Erreur envoi demande:', error);
            res.status(400).json({ error: error.message });
        }
    }
    // Accepter une demande
    async acceptRequest(req, res) {
        try {
            const { requestId } = req.params;
            const userId = req.headers['x-user-id'];
            await friendService.acceptRequest(requestId, userId);
            index_1.logger.info(`Demande acceptée: ${requestId}`);
            res.json({ success: true });
        }
        catch (error) {
            index_1.logger.error('Erreur acceptation:', error);
            res.status(400).json({ error: error.message });
        }
    }
    // Refuser une demande
    async rejectRequest(req, res) {
        try {
            const { requestId } = req.params;
            const userId = req.headers['x-user-id'];
            await friendService.rejectRequest(requestId, userId);
            index_1.logger.info(`Demande refusée: ${requestId}`);
            res.json({ success: true });
        }
        catch (error) {
            index_1.logger.error('Erreur refus:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Supprimer un ami
    async removeFriend(req, res) {
        try {
            const { userId, friendId } = req.params;
            await friendService.removeFriend(userId, friendId);
            index_1.logger.info(`Ami supprimé: ${userId} <-> ${friendId}`);
            res.json({ success: true });
        }
        catch (error) {
            index_1.logger.error('Erreur suppression ami:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Bloquer un utilisateur
    async blockUser(req, res) {
        try {
            const { userId, blockedUserId } = req.body;
            await friendService.blockUser(userId, blockedUserId);
            index_1.logger.info(`Utilisateur bloqué: ${userId} -> ${blockedUserId}`);
            res.json({ success: true });
        }
        catch (error) {
            index_1.logger.error('Erreur blocage:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Débloquer un utilisateur
    async unblockUser(req, res) {
        try {
            const { userId, blockedUserId } = req.params;
            await friendService.unblockUser(userId, blockedUserId);
            index_1.logger.info(`Utilisateur débloqué: ${userId} -> ${blockedUserId}`);
            res.json({ success: true });
        }
        catch (error) {
            index_1.logger.error('Erreur déblocage:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Récupérer la liste d'amis
    async getFriends(req, res) {
        try {
            const { userId } = req.params;
            const friends = await friendService.getFriends(userId);
            res.json(friends);
        }
        catch (error) {
            index_1.logger.error('Erreur récupération amis:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Récupérer les demandes en attente
    async getPendingRequests(req, res) {
        try {
            const { userId } = req.params;
            const requests = await friendService.getPendingRequests(userId);
            res.json(requests);
        }
        catch (error) {
            index_1.logger.error('Erreur récupération demandes:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Récupérer les utilisateurs bloqués
    async getBlockedUsers(req, res) {
        try {
            const { userId } = req.params;
            const blocked = await friendService.getBlockedUsers(userId);
            res.json(blocked);
        }
        catch (error) {
            index_1.logger.error('Erreur récupération bloqués:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
    // Vérifier si deux utilisateurs sont amis
    async checkFriendship(req, res) {
        try {
            const { userId1, userId2 } = req.params;
            const areFriends = await friendService.areFriends(userId1, userId2);
            res.json({ areFriends });
        }
        catch (error) {
            index_1.logger.error('Erreur vérification amitié:', error);
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
}
exports.FriendController = FriendController;
exports.friendController = new FriendController();
//# sourceMappingURL=friends.controller.js.map