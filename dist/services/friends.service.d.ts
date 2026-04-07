import { Friend, FriendRequest, FriendUser } from '../types/friend';
export declare class FriendService {
    private get db();
    private get redis();
    sendRequest(fromUserId: string, toUserId: string): Promise<FriendRequest>;
    acceptRequest(requestId: string, userId: string): Promise<void>;
    rejectRequest(requestId: string, userId: string): Promise<void>;
    removeFriend(userId: string, friendId: string): Promise<void>;
    blockUser(userId: string, blockedUserId: string): Promise<void>;
    unblockUser(userId: string, blockedUserId: string): Promise<void>;
    getFriends(userId: string): Promise<Friend[]>;
    getPendingRequests(userId: string): Promise<FriendRequest[]>;
    getBlockedUsers(userId: string): Promise<FriendUser[]>;
    areFriends(userId1: string, userId2: string): Promise<boolean>;
    private getUserInfo;
    private invalidateCache;
    private formatFriend;
}
export declare const friendService: FriendService;
//# sourceMappingURL=friends.service.d.ts.map