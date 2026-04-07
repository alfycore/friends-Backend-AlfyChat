"use strict";
// ==========================================
// ALFYCHAT - ROUTES AMIS
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.friendsRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const friends_controller_1 = require("../controllers/friends.controller");
const validate_1 = require("../middleware/validate");
exports.friendsRouter = (0, express_1.Router)();
// Envoyer une demande d'ami
exports.friendsRouter.post('/requests', (0, express_validator_1.body)('fromUserId').isUUID(), (0, express_validator_1.body)('toUserId').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.sendRequest.bind(friends_controller_1.friendController));
// Accepter une demande
exports.friendsRouter.post('/requests/:requestId/accept', (0, express_validator_1.param)('requestId').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.acceptRequest.bind(friends_controller_1.friendController));
// Refuser une demande
exports.friendsRouter.post('/requests/:requestId/reject', (0, express_validator_1.param)('requestId').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.rejectRequest.bind(friends_controller_1.friendController));
// Récupérer les demandes en attente
exports.friendsRouter.get('/users/:userId/requests', (0, express_validator_1.param)('userId').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.getPendingRequests.bind(friends_controller_1.friendController));
// Récupérer la liste d'amis
exports.friendsRouter.get('/users/:userId', (0, express_validator_1.param)('userId').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.getFriends.bind(friends_controller_1.friendController));
// Supprimer un ami
exports.friendsRouter.delete('/users/:userId/friends/:friendId', (0, express_validator_1.param)('userId').isUUID(), (0, express_validator_1.param)('friendId').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.removeFriend.bind(friends_controller_1.friendController));
// Bloquer un utilisateur
exports.friendsRouter.post('/block', (0, express_validator_1.body)('userId').isUUID(), (0, express_validator_1.body)('blockedUserId').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.blockUser.bind(friends_controller_1.friendController));
// Débloquer un utilisateur
exports.friendsRouter.delete('/users/:userId/blocked/:blockedUserId', (0, express_validator_1.param)('userId').isUUID(), (0, express_validator_1.param)('blockedUserId').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.unblockUser.bind(friends_controller_1.friendController));
// Récupérer les utilisateurs bloqués
exports.friendsRouter.get('/users/:userId/blocked', (0, express_validator_1.param)('userId').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.getBlockedUsers.bind(friends_controller_1.friendController));
// Vérifier si deux utilisateurs sont amis
exports.friendsRouter.get('/check/:userId1/:userId2', (0, express_validator_1.param)('userId1').isUUID(), (0, express_validator_1.param)('userId2').isUUID(), validate_1.validateRequest, friends_controller_1.friendController.checkFriendship.bind(friends_controller_1.friendController));
//# sourceMappingURL=friends.js.map