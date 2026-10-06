import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { MongoServerError } from 'mongodb';
import { StoreService, type StoredUser } from './store.service';

const scrypt = promisify(scryptCallback);
const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(private readonly store: StoreService) {}

  publicUser(user: StoredUser) {
    return { id: user.id, email: user.email, name: user.name };
  }

  async register(input: { email?: string; name?: string; password?: string }) {
    const email = String(input?.email ?? '').trim().toLowerCase();
    const name = String(input?.name ?? '').trim();
    const password = String(input?.password ?? '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new BadRequestException('Email không hợp lệ.');
    }
    if (name.length < 2 || name.length > 60) {
      throw new BadRequestException('Tên cần từ 2 đến 60 ký tự.');
    }
    if (password.length < 8 || password.length > 128) {
      throw new BadRequestException('Mật khẩu cần từ 8 đến 128 ký tự.');
    }
    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64) as Buffer;
    const user: StoredUser = {
      id: randomUUID(), email, name,
      passwordHash: `${salt}:${key.toString('hex')}`,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.store.users.insertOne(user);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ConflictException('Email này đã được đăng ký.');
      }
      throw error;
    }
    return user;
  }

  async login(input: { email?: string; password?: string }) {
    const email = String(input?.email ?? '').trim().toLowerCase();
    const password = String(input?.password ?? '');
    const user = await this.store.users.findOne({ email });
    if (!user) throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    const [salt, hash] = user.passwordHash.split(':');
    const expected = Buffer.from(hash, 'hex');
    const actual = await scrypt(password, salt, expected.length) as Buffer;
    if (!timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    }
    return user;
  }

  async createSession(user: StoredUser) {
    const token = randomBytes(32).toString('hex');
    await this.store.sessions.insertOne({
      tokenHash: this.hash(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_LIFETIME),
    });
    return token;
  }

  async getUser(token?: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.store.sessions.findOne({ tokenHash: this.hash(token), expiresAt: { $gt: new Date() } });
    return session ? await this.store.users.findOne({ id: session.userId }) : null;
  }

  async requireUser(token?: string) {
    const user = await this.getUser(token);
    if (!user) throw new UnauthorizedException('Vui lòng đăng nhập.');
    return user;
  }

  async logout(token?: string) {
    if (!token) return;
    await this.store.sessions.deleteOne({ tokenHash: this.hash(token) });
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
}
