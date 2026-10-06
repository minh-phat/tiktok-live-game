import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StoreService } from '../auth/store.service';
import type { AudioOrderMode, LiveRoom, RoomTheme } from './live.types';

@Injectable()
export class RoomsService {
  constructor(private readonly store: StoreService) {}

  async list(ownerId: string) {
    return this.store.rooms.find({ ownerId }).project<LiveRoom>({ _id: 0 }).sort({ createdAt: -1 }).toArray();
  }

  async get(ownerId: string, id: string) {
    const room = await this.store.rooms.findOne({ id, ownerId }, { projection: { _id: 0 } });
    if (!room) throw new NotFoundException('Không tìm thấy phòng.');
    return room;
  }

  async create(ownerId: string, input: { name?: string; theme?: RoomTheme; tiktokUsername?: string }) {
    const name = String(input?.name ?? '').trim();
    const theme = input?.theme;
    const tiktokUsername = this.cleanUsername(input?.tiktokUsername);
    if (name.length < 3 || name.length > 80) throw new BadRequestException('Tên phòng cần từ 3 đến 80 ký tự.');
    if (theme !== 'sidewalk-cafe' && theme !== 'tea-room') throw new BadRequestException('Chủ đề phòng không hợp lệ.');
    if (!tiktokUsername) throw new BadRequestException('Username TikTok không hợp lệ.');
    if (await this.store.rooms.countDocuments({ ownerId }) >= 20) throw new BadRequestException('Mỗi tài khoản được tạo tối đa 20 phòng.');
    const room: LiveRoom = { id: randomUUID(), ownerId, name, theme, tiktokUsername, createdAt: new Date().toISOString(), audio: { trackIds: [], orderMode: 'manual' } };
    await this.store.rooms.insertOne(room);
    return room;
  }

  async updateAudio(ownerId: string, id: string, input: { trackIds?: unknown; orderMode?: unknown }) {
    await this.get(ownerId, id);
    const trackIds = Array.isArray(input?.trackIds) ? [...new Set(input.trackIds.map(String))] : [];
    const orderMode = input?.orderMode as AudioOrderMode;
    if (!['manual', 'random', 'name', 'createdAt'].includes(orderMode)) throw new BadRequestException('Kiểu sắp xếp âm thanh không hợp lệ.');
    const ownedCount = await this.store.audioTracks.countDocuments({ ownerId, id: { $in: trackIds } });
    if (ownedCount !== trackIds.length) throw new BadRequestException('Danh sách có âm thanh không thuộc tài khoản này.');
    await this.store.rooms.updateOne({ id, ownerId }, { $set: { audio: { trackIds, orderMode } } });
    return this.get(ownerId, id);
  }

  cleanUsername(value?: string) {
    const input = String(value ?? '').trim();
    const match = input.match(/^(?:(?:https?:\/\/)?(?:www\.)?tiktok\.com\/)?@?([\w.]{2,64})(?:\/live)?\/?$/i);
    return match?.[1] ?? '';
  }
}
