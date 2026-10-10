import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { LiveChat, NotLiveError, RateLimitError, ScrapeError, type ChatItem } from 'youtube-chat-next';
import type { Server } from 'socket.io';
import type { LiveGift, LiveRoom, LiveStatus, LiveSupporter, RoomSnapshot } from './live.types';
import { youtubeLiveId } from './youtube-source';

interface YouTubeSession {
  connection: LiveChat | null;
  snapshot: RoomSnapshot;
  supporters: Map<string, LiveSupporter>;
  seen: Set<string>;
}

@Injectable()
export class YouTubeLiveService implements OnModuleDestroy {
  private readonly logger = new Logger(YouTubeLiveService.name);
  private readonly sessions = new Map<string, YouTubeSession>();
  private server: Server | null = null;

  setServer(server: Server) { this.server = server; }

  private session(roomId: string): YouTubeSession {
    let session = this.sessions.get(roomId);
    if (!session) {
      session = {
        connection: null, supporters: new Map(), seen: new Set(),
        snapshot: {
          status: { state: 'disconnected', message: 'Chưa kết nối YouTube LIVE' },
          guests: [], comments: [], gifts: [], leaderboard: { gifters: [], likers: [] }, viewers: null,
        },
      };
      this.sessions.set(roomId, session);
    }
    return session;
  }

  snapshot(roomId: string): RoomSnapshot {
    const data = this.session(roomId).snapshot;
    return {
      ...data,
      guests: [...data.guests],
      comments: [...data.comments],
      gifts: [...data.gifts],
      leaderboard: { gifters: data.leaderboard.gifters.map((entry) => ({ ...entry })), likers: [] },
    };
  }

  private emit(roomId: string, event: string, payload: unknown) {
    this.server?.to(`room:${roomId}`).emit(event, payload);
  }

  private setStatus(roomId: string, status: LiveStatus) {
    this.session(roomId).snapshot.status = status;
    this.emit(roomId, 'live:status', status);
  }

  disconnect(roomId: string, reason = 'Đã ngắt kết nối YouTube LIVE') {
    const session = this.session(roomId);
    const connection = session.connection;
    // Invalidate before stop(), which emits end synchronously.
    session.connection = null;
    connection?.stop();
    session.seen.clear();
    session.supporters.clear();
    Object.assign(session.snapshot, { guests: [], comments: [], gifts: [], leaderboard: { gifters: [], likers: [] }, viewers: null });
    this.setStatus(roomId, { state: 'disconnected', message: reason });
    this.emit(roomId, 'live:reset', { guests: [], comments: [], gifts: [], leaderboard: { gifters: [], likers: [] }, viewers: null });
  }

  private receive(roomId: string, item: ChatItem) {
    const session = this.session(roomId);
    const message = item.message.map((part) => 'text' in part ? part.text : part.emojiText || part.alt).join('').trim();
    const comment = message || (item.superchat ? `Đã gửi Super Chat ${item.superchat.amount}` : '');
    if (!comment || !item.author.channelId || session.seen.has(item.id)) return;
    session.seen.add(item.id);
    if (session.seen.size > 2000) session.seen.delete(session.seen.values().next().value!);
    const data = session.snapshot;
    const id = `youtube:${item.author.channelId}`;
    let guest = data.guests.find((entry) => entry.id === id);
    if (!guest) {
      if (data.guests.length >= 200) {
        const departed = data.guests.shift()!;
        this.emit(roomId, 'live:guest-left', { id: departed.id });
      }
      const usedSeats = new Set(data.guests.map((entry) => entry.seat));
      guest = {
        id, username: item.author.channelId, nickname: item.author.name,
        avatar: item.author.thumbnail?.url ?? '',
        seat: Array.from({ length: 200 }, (_, seat) => seat).find((seat) => !usedSeats.has(seat)) ?? 0,
        joinedAt: Date.now(),
      };
      data.guests.push(guest);
      this.emit(roomId, 'live:guest-joined', guest);
    }
    const timestamp = item.timestamp.getTime();
    const entry = {
      id: `youtube:${item.id}`, guestId: guest.id, username: guest.username,
      nickname: item.author.name, avatar: item.author.thumbnail?.url ?? '', comment,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    };
    data.comments.unshift(entry);
    data.comments = data.comments.slice(0, 100);
    this.emit(roomId, 'live:comment', entry);
    if (item.superchat) {
      const gift: LiveGift = {
        id: `youtube:gift:${item.id}`, guestId: guest.id, username: guest.username,
        nickname: guest.nickname, avatar: guest.avatar, giftId: 'youtube-superchat',
        giftName: `Super Chat ${item.superchat.amount}`,
        giftImage: item.superchat.sticker?.url ?? '', count: 1, diamonds: 0,
        timestamp: entry.timestamp,
      };
      data.gifts.unshift(gift);
      data.gifts = data.gifts.slice(0, 20);
      const supporter = session.supporters.get(guest.id) ?? {
        guestId: guest.id, username: guest.username, nickname: guest.nickname, avatar: guest.avatar,
        gifts: 0, diamonds: 0, likes: 0,
      };
      session.supporters.set(guest.id, { ...supporter, gifts: supporter.gifts + 1 });
      data.leaderboard = {
        gifters: [...session.supporters.values()]
          .sort((a, b) => b.gifts - a.gifts)
          .slice(0, 3).map((supporterEntry) => ({ ...supporterEntry })),
        likers: [],
      };
      this.emit(roomId, 'live:leaderboard', data.leaderboard);
      this.emit(roomId, 'live:gift', gift);
    }
  }

  async connect(room: LiveRoom) {
    this.disconnect(room.id, 'Đang chuẩn bị kết nối YouTube...');
    const source = youtubeLiveId(room.youtubeLiveId);
    if (!source) {
      const error = new Error('invalid YouTube source');
      this.disconnect(room.id, this.publicError(error));
      throw error;
    }
    const session = this.session(room.id);
    // Select Live chat rather than YouTube's filtered Top chat.
    const target = source.startsWith('@') ? { handle: source } : { liveId: source };
    const connection = new LiveChat(target, 5000, 'live');
    session.connection = connection;
    const isCurrent = () => session.connection === connection;
    let lastError: unknown;
    this.setStatus(room.id, { state: 'connecting', roomId: source, message: `Đang kết nối YouTube LIVE ${source}...` });
    connection.on('start', (liveId) => {
      // stop() during start() cannot cancel the library's pending page fetch.
      if (!isCurrent()) { connection.stop(); return; }
      this.setStatus(room.id, { state: 'connected', roomId: liveId, message: `Đã kết nối YouTube LIVE ${source}` });
    });
    connection.on('chat', (item) => {
      if (!isCurrent()) return;
      if (lastError) {
        lastError = undefined;
        this.setStatus(room.id, { state: 'connected', roomId: connection.liveId ?? source, message: `Đã kết nối YouTube LIVE ${source}` });
      }
      this.receive(room.id, item);
    });
    connection.on('error', (error) => {
      if (!isCurrent()) return;
      lastError = error;
      this.logger.warn(error instanceof Error ? error.message : String(error));
      if (session.snapshot.status.state === 'connected') {
        this.setStatus(room.id, { state: 'connected', roomId: connection.liveId ?? source, message: `${this.publicError(error)} Đang chờ thư viện thử lại.` });
      }
    });
    connection.on('end', (reason) => {
      if (isCurrent()) this.disconnect(room.id,
        reason === 'Live stream ended' ? 'Phiên YouTube LIVE đã kết thúc.' : lastError ? this.publicError(lastError) : 'Đã ngừng nhận chat YouTube LIVE.');
    });
    try {
      const started = await connection.start();
      if (!isCurrent()) { connection.stop(); return; }
      if (!started) throw lastError ?? new Error('YouTube start failed');
    } catch (error) {
      if (!isCurrent()) { connection.stop(); return; }
      this.disconnect(room.id, this.publicError(error));
      throw error;
    }
  }

  publicError(error: unknown) {
    if (error instanceof NotLiveError) return 'Video YouTube chưa LIVE, đã kết thúc hoặc không có chat trực tiếp công khai.';
    if (error instanceof RateLimitError) return 'YouTube đang giới hạn truy cập. Hãy đợi một lúc rồi kết nối lại.';
    if (error instanceof ScrapeError) return 'Không đọc được chat YouTube. Hãy kiểm tra video công khai và đã bật chat trực tiếp.';
    return 'Không thể kết nối YouTube LIVE. Hãy kiểm tra link, trạng thái phát trực tiếp và thử lại.';
  }

  onModuleDestroy() {
    for (const roomId of this.sessions.keys()) this.disconnect(roomId);
  }
}
