import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TikTokLiveService } from './tiktok-live.service';
import type { ConnectPayload, SocketReply } from './live.types';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class LiveGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly tikTokLive: TikTokLiveService) {}

  afterInit(server: Server) {
    this.tikTokLive.setServer(server);
  }

  handleConnection(client: Socket) {
    client.emit('live:status', this.tikTokLive.getStatus());
  }

  @SubscribeMessage('live:connect')
  async connect(@MessageBody() payload: ConnectPayload = {}): Promise<SocketReply> {
    const username = this.tikTokLive.cleanUsername(payload.username);
    if (!username) return { ok: false, message: 'Hãy nhập username TikTok hợp lệ.' };

    this.server.emit('live:status', {
      state: 'connecting',
      username,
      message: `Đang kết nối @${username}...`,
    });

    try {
      await this.tikTokLive.connect(username);
      return { ok: true };
    } catch (error) {
      const message = this.tikTokLive.publicError(error);
      await this.tikTokLive.disconnect(message);
      return { ok: false, message };
    }
  }

  @SubscribeMessage('live:disconnect')
  async disconnect(@ConnectedSocket() _client: Socket): Promise<SocketReply> {
    await this.tikTokLive.disconnect();
    return { ok: true };
  }
}
