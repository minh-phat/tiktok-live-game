import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { TikTokLiveConnection, ClientEventMap } from 'tiktok-live-connector' with { "resolution-mode": "import" };
import type { Server } from 'socket.io';
import type { LiveComment, LiveGift, LiveGuest, LiveRoom, LiveStatus, RoomSnapshot } from './live.types';

interface LiveSession {
  connection: TikTokLiveConnection | null;
  attempt: number;
  status: LiveStatus;
  guests: LiveGuest[];
  comments: LiveComment[];
  gifts: LiveGift[];
  viewers: number | null;
}

// Connector 2.5's typed-emitter default import loses its inherited methods under
// Node16 resolution. Retain the library's event map for the runtime on() method.
type LiveConnection = TikTokLiveConnection & {
  on<E extends keyof ClientEventMap>(event: E, listener: ClientEventMap[E]): unknown;
};

const MAX_GUESTS = 200;
const MAX_COMMENTS = 100;
const MAX_GIFTS = 20;

@Injectable()
export class TikTokLiveService implements OnModuleDestroy {
  private readonly logger = new Logger(TikTokLiveService.name);
  private readonly sessions = new Map<string, LiveSession>();
  private server: Server | null = null;

  setServer(server: Server) { this.server = server; }

  private session(roomId: string): LiveSession {
    let session = this.sessions.get(roomId);
    if (!session) {
      session = {
        connection: null, attempt: 0,
        status: { state: 'disconnected', message: 'Chưa kết nối TikTok LIVE' },
        guests: [], comments: [], gifts: [], viewers: null,
      };
      this.sessions.set(roomId, session);
    }
    return session;
  }

  snapshot(roomId: string): RoomSnapshot {
    const session = this.session(roomId);
    return {
      status: session.status,
      guests: [...session.guests],
      comments: [...session.comments],
      gifts: [...session.gifts],
      viewers: session.viewers,
    };
  }

  private emit(roomId: string, event: string, payload: unknown) {
    this.server?.to(`room:${roomId}`).emit(event, payload);
  }

  private setStatus(roomId: string, status: LiveStatus) {
    this.session(roomId).status = status;
    this.emit(roomId, 'live:status', status);
  }

  private upsertGuest(roomId: string, user: { userId?: string | number | bigint | null; uniqueId?: string | null; displayId?: string | null; nickname?: string | null; profilePictureUrl?: string | null; avatarThumb?: { urlList?: string[] } | null }): LiveGuest | null {
    const session = this.session(roomId);
    const username = String(user.uniqueId ?? user.displayId ?? '').trim();
    const id = String(user.userId ?? username).trim();
    if (!id) return null;
    const existing = session.guests.find((guest) => guest.id === id);
    if (existing) return existing;
    const usedSeats = new Set(session.guests.map((guest) => guest.seat));
    if (session.guests.length >= MAX_GUESTS) {
      const departed = session.guests.shift();
      if (departed) {
        usedSeats.delete(departed.seat);
        this.emit(roomId, 'live:guest-left', { id: departed.id });
      }
    }
    const seat = Array.from({ length: MAX_GUESTS }, (_, index) => index).find((index) => !usedSeats.has(index)) ?? 0;
    const guest: LiveGuest = {
      id,
      username: username || 'viewer',
      nickname: String(user.nickname ?? username ?? 'Khách ghé quán'),
      avatar: String(user.profilePictureUrl ?? user.avatarThumb?.urlList?.[0] ?? ''),
      seat,
      joinedAt: Date.now(),
    };
    session.guests.push(guest);
    this.emit(roomId, 'live:guest-joined', guest);
    return guest;
  }

  disconnect(roomId: string, reason = 'Đã ngắt kết nối') {
    const session = this.session(roomId);
    session.attempt += 1;
    const connection = session.connection;
    session.connection = null;
    if (connection) {
      try { connection.disconnect(); } catch { /* đã đóng */ }
    }
    session.guests = [];
    session.comments = [];
    session.gifts = [];
    session.viewers = null;
    this.setStatus(roomId, { state: 'disconnected', message: reason });
    this.emit(roomId, 'live:reset', { guests: [], comments: [], gifts: [], viewers: null });
  }

  async connect(room: LiveRoom) {
    this.disconnect(room.id, 'Đang chuẩn bị kết nối...');
    const session = this.session(room.id);
    const attempt = session.attempt;
    this.setStatus(room.id, { state: 'connecting', username: room.tiktokUsername, message: `Đang kết nối @${room.tiktokUsername}...` });
    // Keep this as a native import(): the connector is ESM, while NestJS runs as CommonJS.
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import('tiktok-live-connector').catch((error) => {
      if (session.attempt === attempt) this.disconnect(room.id, this.publicError(error));
      throw error;
    });
    // A disconnect or newer connect may have happened while loading the module.
    if (session.attempt !== attempt) return;
    const connection = new TikTokLiveConnection(room.tiktokUsername, {
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
    }) as LiveConnection;
    session.connection = connection;
    const isCurrent = () => session.attempt === attempt && session.connection === connection;

    connection.on(WebcastEvent.MEMBER, (data) => {
      if (isCurrent()) this.upsertGuest(room.id, data.user ?? data);
    });
    connection.on(WebcastEvent.CHAT, (data) => {
      if (!isCurrent()) return;
      const comment = String(data.content ?? ('comment' in data ? data.comment : undefined) ?? ('text' in data ? data.text : '')).trim();
      if (!comment) return;
      const user = data.user ?? {};
      const guest = this.upsertGuest(room.id, user);
      if (!guest) return;
      const item: LiveComment = {
        id: String(data.common?.msgId ?? ('msgId' in data ? data.msgId : undefined) ?? `${Date.now()}-${Math.random()}`),
        guestId: guest.id,
        username: guest.username,
        nickname: guest.nickname,
        avatar: guest.avatar,
        comment,
        timestamp: Date.now(),
      };
      session.comments.unshift(item);
      session.comments = session.comments.slice(0, MAX_COMMENTS);
      this.emit(room.id, 'live:comment', item);
    });
    connection.on(WebcastEvent.GIFT, (data) => {
      if (!isCurrent()) return;
      // Combo gifts send an event for every increment; thank once when the streak ends.
      if (data.gift?.combo && data.repeatEnd !== 1) return;
      const guest = this.upsertGuest(room.id, data.user ?? {});
      if (!guest) return;
      const count = Math.max(1, Number(data.repeatCount || data.comboCount || 1));
      const gift: LiveGift = {
        id: String(data.common?.msgId ?? data.logId ?? `${Date.now()}-${Math.random()}`),
        guestId: guest.id,
        username: guest.username,
        nickname: guest.nickname,
        avatar: guest.avatar,
        giftId: String(data.giftId || data.gift?.id || ''),
        giftName: String(data.gift?.name || data.gift?.describe || 'một món quà'),
        giftImage: String(data.gift?.image?.urlList?.[0] ?? data.gift?.icon?.urlList?.[0] ?? ''),
        count,
        diamonds: Math.max(0, Number(data.gift?.diamondCount ?? 0)) * count,
        timestamp: Date.now(),
      };
      session.gifts.unshift(gift);
      session.gifts = session.gifts.slice(0, MAX_GIFTS);
      this.emit(room.id, 'live:gift', gift);
    });
    connection.on(WebcastEvent.ROOM_USER, (data) => {
      if (!isCurrent()) return;
      const viewerCount = 'viewerCount' in data ? data.viewerCount : undefined;
      const topViewers = 'topViewers' in data && Array.isArray(data.topViewers) ? data.topViewers : [];
      session.viewers = Number(viewerCount ?? topViewers.length);
      this.emit(room.id, 'live:stats', { viewers: session.viewers });
    });
    connection.on(WebcastEvent.STREAM_END, () => {
      if (isCurrent()) this.disconnect(room.id, 'Phiên LIVE đã kết thúc.');
    });
    connection.on(ControlEvent.DISCONNECTED, () => {
      if (isCurrent()) this.disconnect(room.id, 'Mất kết nối với phòng LIVE.');
    });
    connection.on(ControlEvent.ERROR, (error) => this.logger.error('Lỗi kết nối TikTok', error));

    try {
      const state = await connection.connect();
      if (!isCurrent()) return;
      this.setStatus(room.id, {
        state: 'connected', username: room.tiktokUsername,
        roomId: String(state.roomId ?? ''),
        message: `Đã kết nối @${room.tiktokUsername}`,
      });
    } catch (error) {
      if (isCurrent()) this.disconnect(room.id, this.publicError(error));
      throw error;
    }
  }

  publicError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/offline|not live|room.*not found/i.test(message)) {
      return 'Tài khoản này hiện không phát LIVE hoặc không tìm thấy phòng.';
    }
    return 'Không thể kết nối TikTok LIVE. Hãy kiểm tra username và thử lại.';
  }

  onModuleDestroy() {
    for (const roomId of this.sessions.keys()) this.disconnect(roomId);
  }
}
