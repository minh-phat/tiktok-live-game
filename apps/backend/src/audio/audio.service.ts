import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { StoreService } from '../auth/store.service';
import type { AudioTrack } from '../live/live.types';
import { R2Service } from './r2.service';

type Upload = { originalname: string; mimetype: string; size: number; buffer: Buffer };

const MAX_AUDIO_FILE_SIZE = 100 * 1024 * 1024;

@Injectable()
export class AudioService {
  constructor(private readonly store: StoreService, private readonly r2: R2Service) {}

  list(ownerId: string) {
    return this.store.audioTracks.find({ ownerId }).project<AudioTrack>({ _id: 0 }).sort({ createdAt: -1 }).toArray();
  }

  async upload(ownerId: string, files: Upload[]) {
    if (!files?.length) throw new BadRequestException('Hãy chọn ít nhất một file âm thanh.');
    if (files.length > 20) throw new BadRequestException('Mỗi lần chỉ được tải tối đa 20 file.');
    const results: AudioTrack[] = [];
    for (const file of files) {
      if (!file.mimetype.startsWith('audio/')) throw new BadRequestException(`${file.originalname} không phải file âm thanh.`);
      if (file.size > MAX_AUDIO_FILE_SIZE) throw new BadRequestException(`${file.originalname} vượt quá 100 MB.`);
      const id = randomUUID();
      const extension = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
      const objectKey = `audio/${ownerId}/${id}${extension}`;
      const url = await this.r2.put(objectKey, file.buffer, file.mimetype);
      const track: AudioTrack = { id, ownerId, name: file.originalname.slice(0, 180), objectKey, url, mimeType: file.mimetype, size: file.size, createdAt: new Date().toISOString() };
      await this.store.audioTracks.insertOne(track);
      results.push(track);
    }
    return results;
  }
}
