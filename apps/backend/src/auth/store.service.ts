import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, MongoClient } from 'mongodb';
import type { AudioTrack, LiveRoom } from '../live/live.types';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

export interface StoredSession {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export const mongodbUri = () => process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
export const mongodbDatabase = () => process.env.MONGODB_DB ?? 'live_quan';

@Injectable()
export class StoreService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new MongoClient(mongodbUri(), { serverSelectionTimeoutMS: 5000 });
  readonly users: Collection<StoredUser> = this.client.db(mongodbDatabase()).collection('users');
  readonly sessions: Collection<StoredSession> = this.client.db(mongodbDatabase()).collection('sessions');
  readonly rooms: Collection<LiveRoom> = this.client.db(mongodbDatabase()).collection('rooms');
  readonly audioTracks: Collection<AudioTrack> = this.client.db(mongodbDatabase()).collection('audio_tracks');

  async onModuleInit() {
    await this.client.connect();
    await Promise.all([
      this.users.createIndex({ id: 1 }, { unique: true }),
      this.users.createIndex({ email: 1 }, { unique: true }),
      this.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
      this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.rooms.createIndex({ id: 1 }, { unique: true }),
      this.rooms.createIndex({ ownerId: 1, createdAt: -1 }),
      this.audioTracks.createIndex({ id: 1 }, { unique: true }),
      this.audioTracks.createIndex({ ownerId: 1, createdAt: -1 }),
    ]);
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
