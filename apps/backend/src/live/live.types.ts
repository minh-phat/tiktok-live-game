export interface LiveStatus {
  state: 'connected' | 'connecting' | 'disconnected';
  message: string;
  username?: string;
  roomId?: string;
}

export interface LiveComment {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  comment: string;
  timestamp: number;
}

export interface ConnectPayload {
  username?: string;
}

export interface SocketReply {
  ok: boolean;
  message?: string;
}
