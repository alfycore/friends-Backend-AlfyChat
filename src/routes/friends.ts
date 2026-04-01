// ==========================================
// ALFYCHAT - ROUTES AMIS
// ==========================================

import { Router } from 'express';
import { body, param } from 'express-validator';
import { friendController } from '../controllers/friends.controller';
import { validateRequest } from '../middleware/validate';

export const friendsRouter = Router();

// Envoyer une demande d'ami
friendsRouter.post('/requests',
  body('fromUserId').isUUID(),
  body('toUserId').isUUID(),
  validateRequest,
  friendController.sendRequest.bind(friendController)
);

// Accepter une demande
friendsRouter.post('/requests/:requestId/accept',
  param('requestId').isUUID(),
  validateRequest,
  friendController.acceptRequest.bind(friendController)
);

// Refuser une demande
friendsRouter.post('/requests/:requestId/reject',
  param('requestId').isUUID(),
  validateRequest,
  friendController.rejectRequest.bind(friendController)
);

// Récupérer les demandes en attente
friendsRouter.get('/users/:userId/requests',
  param('userId').isUUID(),
  validateRequest,
  friendController.getPendingRequests.bind(friendController)
);

// Récupérer la liste d'amis
friendsRouter.get('/users/:userId',
  param('userId').isUUID(),
  validateRequest,
  friendController.getFriends.bind(friendController)
);

// Supprimer un ami
friendsRouter.delete('/users/:userId/friends/:friendId',
  param('userId').isUUID(),
  param('friendId').isUUID(),
  validateRequest,
  friendController.removeFriend.bind(friendController)
);

// Bloquer un utilisateur
friendsRouter.post('/block',
  body('userId').isUUID(),
  body('blockedUserId').isUUID(),
  validateRequest,
  friendController.blockUser.bind(friendController)
);

// Débloquer un utilisateur
friendsRouter.delete('/users/:userId/blocked/:blockedUserId',
  param('userId').isUUID(),
  param('blockedUserId').isUUID(),
  validateRequest,
  friendController.unblockUser.bind(friendController)
);

// Récupérer les utilisateurs bloqués
friendsRouter.get('/users/:userId/blocked',
  param('userId').isUUID(),
  validateRequest,
  friendController.getBlockedUsers.bind(friendController)
);

// Vérifier si deux utilisateurs sont amis
friendsRouter.get('/check/:userId1/:userId2',
  param('userId1').isUUID(),
  param('userId2').isUUID(),
  validateRequest,
  friendController.checkFriendship.bind(friendController)
);

// Vérifier le statut de blocage
friendsRouter.get('/block-status/:userId/:otherId',
  param('userId').isUUID(),
  param('otherId').isUUID(),
  validateRequest,
  friendController.getBlockStatus.bind(friendController)
);
