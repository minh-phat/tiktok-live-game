import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import type { LiveRoom } from '../live/live.types';
import { StoreService, type StoredUser } from '../auth/store.service';

interface LegacySession {
  tokenHash: string;
  userId: string;
  expiresAt: number;
}

interface LegacyData {
  users: StoredUser[];
  sessions: LegacySession[];
  rooms: LiveRoom[];
}

async function main() {
  ConfigModule.forRoot({ envFilePath: ['apps/backend/.env', '.env'] });
  const file = resolve(process.env.DATA_FILE ?? './data/app.json');
  if (!existsSync(file)) throw new Error(`Không tìm thấy file JSON cũ: ${file}`);
  const data = JSON.parse(readFileSync(file, 'utf8')) as LegacyData;
  if (!Array.isArray(data.users) || !Array.isArray(data.sessions) || !Array.isArray(data.rooms)) {
    throw new Error('File JSON cũ không đúng định dạng users/sessions/rooms.');
  }

  const store = new StoreService();
  await store.onModuleInit();
  const imported = { users: 0, sessions: 0, rooms: 0 };
  try {
    for (const user of data.users) {
      const result = await store.users.updateOne({ id: user.id }, { $setOnInsert: user }, { upsert: true });
      imported.users += result.upsertedCount;
    }
    for (const room of data.rooms) {
      const result = await store.rooms.updateOne({ id: room.id }, { $setOnInsert: room }, { upsert: true });
      imported.rooms += result.upsertedCount;
    }
    for (const session of data.sessions) {
      if (session.expiresAt <= Date.now()) continue;
      const result = await store.sessions.updateOne(
        { tokenHash: session.tokenHash },
        { $setOnInsert: { ...session, expiresAt: new Date(session.expiresAt) } },
        { upsert: true },
      );
      imported.sessions += result.upsertedCount;
    }
    console.log(`Đã nhập MongoDB: ${imported.users} tài khoản, ${imported.rooms} phòng, ${imported.sessions} phiên còn hạn.`);
    console.log(`File gốc vẫn được giữ tại ${file}`);
  } finally {
    await store.onModuleDestroy();
  }
}

void main().catch((error: unknown) => {
  console.error('Chuyển dữ liệu JSON sang MongoDB thất bại:', error);
  process.exitCode = 1;
});
