import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

  app.enableCors({ origin: frontendUrl, credentials: true });
  await app.listen(Number(process.env.PORT) || 3001);

  console.log(`NestJS backend đang chạy tại ${await app.getUrl()}`);
}

void bootstrap();
