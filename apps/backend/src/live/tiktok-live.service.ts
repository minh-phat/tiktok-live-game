import { Injectable, Logger } from '@nestjs/common';
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import type { Server } from 'socket.io';

@Injectable()
export class TikTokLiveService {
  private readonly logger = new Logger(TikTokLiveService.name);
  private liveConnection: TikTokLiveConnection | null = null;
  private connectedUsername = '';
  private connectionAttempt = 0;
  private server: Server | null = null;

  setServer(server: Server) {
    this.server = server;
  }

  getStatus() {
    return this.connectedUsername
      ? { state: 'connected' as const, username: this.connectedUsername, message: `Đã kết nối @${this.connectedUsername}` }
      : { state: 'disconnected' as const, message: 'Chưa kết nối phòng LIVE' };
  }

  cleanUsername(value = '') {
    const match = String(value).trim().match(/(?:tiktok\.com\/@)?@?([\w.-]+)/i);
    return match?.[1]?.slice(0, 64) ?? '';
  }

  publicError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/offline|not live|room.*not found/i.test(message)) {
      return 'Tài khoản này hiện không phát LIVE hoặc không tìm thấy phòng.';
    }
    return 'Không thể kết nối TikTok LIVE. Hãy kiểm tra username và thử lại.';
  }

  async disconnect(reason = 'Đã ngắt kết nối') {
    this.connectionAttempt += 1;
    if (this.liveConnection) {
      try {
        this.liveConnection.disconnect();
      } catch {
        // Kết nối đã được đóng.
      }
    }
    this.liveConnection = null;
    this.connectedUsername = '';
    this.server?.emit('live:status', { state: 'disconnected', message: reason });
  }

  async connect(rawUsername: string) {
    const username = this.cleanUsername(rawUsername);
    if (!username) throw new Error('Username TikTok không hợp lệ.');

    await this.disconnect('Đang chuyển phòng LIVE...');
    const attempt = this.connectionAttempt;
    const connection = new TikTokLiveConnection(username, {
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
    });
    this.liveConnection = connection;

    connection.on(WebcastEvent.CHAT, (data) => {
      const user = data.user ?? data;
      const comment = data.content ?? data.comment ?? data.text ?? '';
      if (!comment) {
        this.logger.warn(`Nhận chat event không có nội dung: ${Object.keys(data).join(', ')}`);
        return;
      }

      this.server?.emit('live:comment', {
        id: String(data.common?.msgId ?? data.msgId ?? `${Date.now()}-${Math.random()}`),
        username: user.displayId ?? user.uniqueId ?? data.uniqueId ?? 'user',
        nickname: user.nickname ?? data.nickname ?? user.displayId ?? user.uniqueId ?? 'TikTok user',
        avatar: user.profilePictureUrl ?? user.avatarThumb?.urlList?.[0] ?? '',
        comment,
        timestamp: Date.now(),
      });
    });

    connection.on(WebcastEvent.ROOM_USER, (data) => {
      this.server?.emit('live:stats', { viewers: data.viewerCount ?? data.topViewers?.length ?? null });
    });
    connection.on(WebcastEvent.STREAM_END, () => void this.disconnect('Phiên LIVE đã kết thúc.'));
    connection.on(ControlEvent.DISCONNECTED, () => {
      if (attempt === this.connectionAttempt) {
        this.server?.emit('live:status', { state: 'disconnected', message: 'Mất kết nối với phòng LIVE.' });
      }
    });
    connection.on(ControlEvent.ERROR, (error) => this.logger.error('Lỗi kết nối TikTok', error));

    const state = await connection.connect();
    if (attempt !== this.connectionAttempt) return;
    this.connectedUsername = username;
    this.server?.emit('live:status', {
      state: 'connected',
      username,
      roomId: String(state.roomId ?? ''),
      message: `Đã kết nối @${username}`,
    });
  }
}
