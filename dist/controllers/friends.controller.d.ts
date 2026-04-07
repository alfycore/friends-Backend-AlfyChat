import { Request, Response } from 'express';
export declare class FriendController {
    sendRequest(req: Request, res: Response): Promise<void>;
    acceptRequest(req: Request, res: Response): Promise<void>;
    rejectRequest(req: Request, res: Response): Promise<void>;
    removeFriend(req: Request, res: Response): Promise<void>;
    blockUser(req: Request, res: Response): Promise<void>;
    unblockUser(req: Request, res: Response): Promise<void>;
    getFriends(req: Request, res: Response): Promise<void>;
    getPendingRequests(req: Request, res: Response): Promise<void>;
    getBlockedUsers(req: Request, res: Response): Promise<void>;
    checkFriendship(req: Request, res: Response): Promise<void>;
}
export declare const friendController: FriendController;
//# sourceMappingURL=friends.controller.d.ts.map