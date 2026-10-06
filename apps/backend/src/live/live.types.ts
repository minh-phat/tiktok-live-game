export type RoomTheme = 'sidewalk-cafe' | 'tea-room';
export type AudioOrderMode = 'manual' | 'random' | 'name' | 'createdAt';

export interface AudioTrack {
  id: string;
  ownerId: string;
  name: string;
  objectKey: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface RoomAudioSettings {
  trackIds: string[];
  orderMode: AudioOrderMode;
}

export interface LiveRoom {
  id: string;
  ownerId: string;
  name: string;
  theme: RoomTheme;
  tiktokUsername: string;
  createdAt: string;
  audio?: RoomAudioSettings;
}

export interface LiveStatus {
  state: 'connected' | 'connecting' | 'disconnected';
  message: string;
  username?: string;
  roomId?: string;
}

export interface LiveGuest {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  seat: number;
  joinedAt: number;
}

export interface LiveComment {
  id: string;
  guestId: string;
  username: string;
  nickname: string;
  avatar: string;
  comment: string;
  timestamp: number;
}

export interface RoomSnapshot {
  status: LiveStatus;
  guests: LiveGuest[];
  comments: LiveComment[];
  viewers: number | null;
}

export interface SocketReply<T = undefined> {
  ok: boolean;
  message?: string;
  data?: T;
}
