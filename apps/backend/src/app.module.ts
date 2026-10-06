import { Module } from '@nestjs/common';
import { LiveGateway } from './live/live.gateway';
import { TikTokLiveService } from './live/tiktok-live.service';

@Module({
  providers: [LiveGateway, TikTokLiveService],
})
export class AppModule {}
