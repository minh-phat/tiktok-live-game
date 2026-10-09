import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit,
  SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { sessionToken } from '../auth/session';
import { RoomsService } from './rooms.service';
import { TikTokLiveService } from './tiktok-live.service';
import { YouTubeLiveService } from './youtube-live.service';
import type { KidnappingPhase, LeaderboardLayout, LiveGuest, RoomJoinSnapshot, RoomPresentation, SocketReply, ViewMode } from './live.types';

const defaultLeaderboardLayout = (): LeaderboardLayout => ({
  desktop: { gifters: { x: 74, y: 3, scale: 100 }, likers: { x: 74, y: 24, scale: 100 } },
  phone: { gifters: { x: 51, y: 9, scale: 100 }, likers: { x: 51, y: 29, scale: 100 } },
});

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class LiveGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly presentations = new Map<string, RoomPresentation>();

  constructor(
    private readonly auth: AuthService,
    private readonly rooms: RoomsService,
    private readonly tikTokLive: TikTokLiveService,
    private readonly youTubeLive: YouTubeLiveService,
  ) {}

  afterInit(server: Server) {
    this.tikTokLive.setServer(server);
    this.youTubeLive.setServer(server);
  }

  private provider(room: { platform?: string }) {
    return room.platform === 'youtube' ? this.youTubeLive : this.tikTokLive;
  }

  disconnectSession(token?: string) {
    if (!token || !this.server) return;
    for (const client of this.server.sockets.sockets.values()) {
      if (sessionToken(client.handshake.headers.cookie) === token) client.disconnect(true);
    }
  }

  async handleConnection(client: Socket) {
    try {
      if (!await this.auth.getUser(sessionToken(client.handshake.headers.cookie))) client.disconnect(true);
    } catch {
      client.disconnect(true);
    }
  }

  private async ownedRoom(client: Socket, roomId: string) {
    const user = await this.auth.getUser(sessionToken(client.handshake.headers.cookie));
    if (!user) return null;
    try { return await this.rooms.get(user.id, roomId); } catch { return null; }
  }

  private presentationUpdate(current: RoomPresentation | undefined, value: unknown): RoomPresentation {
    const defaults: RoomPresentation = {
      viewMode: 'desktop', virtualGuestsEnabled: true, virtualConversationEnabled: true, seatSpacing: 100, isRaining: false,
      leaderboardLayout: defaultLeaderboardLayout(),
      kidnapping: { phase: 'idle', hostages: [], deadline: null },
    };
    const previous = current ?? defaults;
    const update = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const viewMode = update.viewMode === 'phone' || update.viewMode === 'desktop' ? update.viewMode : previous.viewMode;
    const spacing = Number(update.seatSpacing);
    return {
      viewMode,
      virtualGuestsEnabled: typeof update.virtualGuestsEnabled === 'boolean' ? update.virtualGuestsEnabled : previous.virtualGuestsEnabled,
      virtualConversationEnabled: typeof update.virtualConversationEnabled === 'boolean' ? update.virtualConversationEnabled : (previous.virtualConversationEnabled ?? true),
      seatSpacing: Number.isFinite(spacing) ? Math.min(100, Math.max(40, spacing)) : previous.seatSpacing,
      isRaining: typeof update.isRaining === 'boolean' ? update.isRaining : previous.isRaining,
      leaderboardLayout: this.leaderboardLayoutUpdate(previous.leaderboardLayout, update.leaderboardLayout),
      kidnapping: this.kidnappingUpdate(previous.kidnapping, update.kidnapping),
    };
  }

  private leaderboardLayoutUpdate(current: LeaderboardLayout | undefined, value: unknown): LeaderboardLayout {
    const previous = current ?? defaultLeaderboardLayout();
    if (!value || typeof value !== 'object') return previous;
    const update = value as Partial<Record<ViewMode, unknown>>;
    const placement = (fallback: LeaderboardLayout[ViewMode]['gifters'], candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object') return fallback;
      const item = candidate as Record<string, unknown>;
      const clamp = (input: unknown, minimum: number, maximum: number, oldValue: number) => {
        const numeric = Number(input);
        return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : oldValue;
      };
      return {
        x: clamp(item.x, 0, 92, fallback.x),
        y: clamp(item.y, 0, 92, fallback.y),
        scale: clamp(item.scale, 50, 180, fallback.scale),
      };
    };
    const mode = (viewMode: ViewMode) => {
      const candidate = update[viewMode];
      const item = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
      return {
        gifters: placement(previous[viewMode].gifters, item.gifters),
        likers: placement(previous[viewMode].likers, item.likers),
      };
    };
    return { desktop: mode('desktop'), phone: mode('phone') };
  }

  private kidnappingUpdate(current: RoomPresentation['kidnapping'], value: unknown): RoomPresentation['kidnapping'] {
    if (!value || typeof value !== 'object') return current;
    const update = value as Record<string, unknown>;
    const phases: KidnappingPhase[] = ['idle', 'arriving', 'rescue', 'saved', 'abducted'];
    const phase = phases.includes(update.phase as KidnappingPhase) ? update.phase as KidnappingPhase : current.phase;
    const hostages = Array.isArray(update.hostages)
      ? update.hostages.filter((guest): guest is LiveGuest => Boolean(guest) && typeof guest === 'object')
      : current.hostages;
    const numericDeadline = Number(update.deadline);
    const deadline = update.deadline === null ? null : Number.isFinite(numericDeadline) ? numericDeadline : current.deadline;
    const rescuer = typeof update.rescuer === 'string' ? update.rescuer.slice(0, 100) : undefined;
    return { phase, hostages, deadline, ...(rescuer ? { rescuer } : {}) };
  }

  @SubscribeMessage('room:join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() payload: { roomId?: string } = {}): Promise<SocketReply<RoomJoinSnapshot>> {
    const roomId = String(payload?.roomId ?? '');
    const room = await this.ownedRoom(client, roomId);
    if (!room) return { ok: false, message: 'Bạn không có quyền vào phòng này.' };
    await client.join(`room:${roomId}`);
    return { ok: true, data: { ...this.provider(room).snapshot(roomId), presentation: this.presentations.get(roomId) } };
  }

  @SubscribeMessage('room:leave')
  async leave(@ConnectedSocket() client: Socket, @MessageBody() payload: { roomId?: string } = {}): Promise<SocketReply> {
    await client.leave(`room:${String(payload?.roomId ?? '')}`);
    return { ok: true };
  }

  @SubscribeMessage('room:presentation:update')
  async updatePresentation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId?: string; presentation?: unknown } = {},
  ): Promise<SocketReply<RoomPresentation>> {
    const roomId = String(payload?.roomId ?? '');
    if (!await this.ownedRoom(client, roomId)) return { ok: false, message: 'Bạn không có quyền điều khiển phòng này.' };
    const presentation = this.presentationUpdate(this.presentations.get(roomId), payload.presentation);
    this.presentations.set(roomId, presentation);
    this.server.to(`room:${roomId}`).emit('room:presentation', presentation);
    return { ok: true, data: presentation };
  }

  @SubscribeMessage('live:connect')
  async connect(@ConnectedSocket() client: Socket, @MessageBody() payload: { roomId?: string } = {}): Promise<SocketReply> {
    const room = await this.ownedRoom(client, String(payload?.roomId ?? ''));
    if (!room) return { ok: false, message: 'Bạn không có quyền điều khiển phòng này.' };
    try {
      await this.provider(room).connect(room);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: this.provider(room).publicError(error) };
    }
  }

  @SubscribeMessage('live:disconnect')
  async disconnect(@ConnectedSocket() client: Socket, @MessageBody() payload: { roomId?: string } = {}): Promise<SocketReply> {
    const roomId = String(payload?.roomId ?? '');
    const room = await this.ownedRoom(client, roomId);
    if (!room) return { ok: false, message: 'Bạn không có quyền điều khiển phòng này.' };
    this.provider(room).disconnect(roomId);
    return { ok: true };
  }
}
