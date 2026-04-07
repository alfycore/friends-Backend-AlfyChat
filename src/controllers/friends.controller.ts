// ==========================================
// ALFYCHAT - CONTRÔLEUR AMIS
// ==========================================

import { Request, Response } from 'express';
import { FriendService } from '../services/friends.service';
import { logger } from '../index';

const friendService = new FriendService();

export class FriendController {
  // Envoyer une demande d'ami
  async sendRequest(req: Request, res: Response) {
    try {
      const { fromUserId, toUserId } = req.body;

      const request = await friendService.sendRequest(fromUserId, toUserId);
      logger.info(`Demande d'ami envoyée: ${fromUserId} -> ${toUserId}`);
      res.status(201).json(request);
    } catch (error: any) {
      logger.error('Erreur envoi demande:', error);
      res.status(400).json({ error: error.message });
    }
  }

  // Accepter une demande
  async acceptRequest(req: Request, res: Response) {
    try {
      const { requestId } = req.params;
      const userId = req.headers['x-user-id'] as string;

      await friendService.acceptRequest(requestId, userId);
      logger.info(`Demande acceptée: ${requestId}`);
      res.json({ success: true });
    } catch (error: any) {
      logger.error('Erreur acceptation:', error);
      res.status(400).json({ error: error.message });
    }
  }

  // Refuser une demande
  async rejectRequest(req: Request, res: Response) {
    try {
      const { requestId } = req.params;
      const userId = req.headers['x-user-id'] as string;

      await friendService.rejectRequest(requestId, userId);
      logger.info(`Demande refusée: ${requestId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur refus:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Supprimer un ami
  async removeFriend(req: Request, res: Response) {
    try {
      const { userId, friendId } = req.params;

      await friendService.removeFriend(userId, friendId);
      logger.info(`Ami supprimé: ${userId} <-> ${friendId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur suppression ami:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Bloquer un utilisateur
  async blockUser(req: Request, res: Response) {
    try {
      const { userId, blockedUserId } = req.body;

      await friendService.blockUser(userId, blockedUserId);
      logger.info(`Utilisateur bloqué: ${userId} -> ${blockedUserId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur blocage:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Débloquer un utilisateur
  async unblockUser(req: Request, res: Response) {
    try {
      const { userId, blockedUserId } = req.params;

      await friendService.unblockUser(userId, blockedUserId);
      logger.info(`Utilisateur débloqué: ${userId} -> ${blockedUserId}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Erreur déblocage:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Récupérer la liste d'amis
  async getFriends(req: Request, res: Response) {
    try {
      const { userId } = req.params;

      const friends = await friendService.getFriends(userId);
      res.json(friends);
    } catch (error) {
      logger.error('Erreur récupération amis:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Récupérer les demandes en attente
  async getPendingRequests(req: Request, res: Response) {
    try {
      const { userId } = req.params;

      const requests = await friendService.getPendingRequests(userId);
      res.json(requests);
    } catch (error) {
      logger.error('Erreur récupération demandes:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Récupérer les utilisateurs bloqués
  async getBlockedUsers(req: Request, res: Response) {
    try {
      const { userId } = req.params;

      const blocked = await friendService.getBlockedUsers(userId);
      res.json(blocked);
    } catch (error) {
      logger.error('Erreur récupération bloqués:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Vérifier si deux utilisateurs sont amis
  async checkFriendship(req: Request, res: Response) {
    try {
      const { userId1, userId2 } = req.params;

      const areFriends = await friendService.areFriends(userId1, userId2);
      res.json({ areFriends });
    } catch (error) {
      logger.error('Erreur vérification amitié:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

export const friendController = new FriendController();
