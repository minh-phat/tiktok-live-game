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
import type { SocketReply, RoomSnapshot } from './live.types';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class LiveGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server: Server;

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

  @SubscribeMessage('room:join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() payload: { roomId?: string } = {}): Promise<SocketReply<RoomSnapshot>> {
    const roomId = String(payload?.roomId ?? '');
    const room = await this.ownedRoom(client, roomId);
    if (!room) return { ok: false, message: 'Bạn không có quyền vào phòng này.' };
    await client.join(`room:${roomId}`);
    return { ok: true, data: this.provider(room).snapshot(roomId) };
  }

  @SubscribeMessage('room:leave')
  async leave(@ConnectedSocket() client: Socket, @MessageBody() payload: { roomId?: string } = {}): Promise<SocketReply> {
    await client.leave(`room:${String(payload?.roomId ?? '')}`);
    return { ok: true };
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
