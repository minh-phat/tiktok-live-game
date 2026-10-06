import { Module } from '@nestjs/common';
import { LiveGateway } from './live/live.gateway';
import { TikTokLiveService } from './live/tiktok-live.service';
import { StoreService } from './auth/store.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { RoomsService } from './live/rooms.service';
import { RoomsController } from './live/rooms.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/backend/.env', '.env'],
    }),
  ],
  controllers: [AuthController, RoomsController],
  providers: [StoreService, AuthService, RoomsService, LiveGateway, TikTokLiveService],
})
export class AppModule {}
