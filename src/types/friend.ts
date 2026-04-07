// ==========================================
// ALFYCHAT - TYPES AMIS
// ==========================================

export type FriendStatus = 'pending' | 'accepted' | 'blocked';

export interface Friend {
  id: string;
  userId: string;
  friendId: string;
  status: FriendStatus;
  createdAt: Date;
  friend?: FriendUser;
}

export interface FriendUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  status: string;
  isOnline: boolean;
}

export interface FriendRequest {
  id: string;
  fromUser: FriendUser;
  toUserId: string;
  status: FriendStatus;
  createdAt: Date;
}

export interface CreateFriendRequestDTO {
  fromUserId: string;
  toUserId: string;
}

export interface BlockUserDTO {
  userId: string;
  blockedUserId: string;
}
