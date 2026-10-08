import { Controller, Get, Post, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { sessionToken } from '../auth/session';
import { AudioService } from './audio.service';

const MAX_AUDIO_FILE_SIZE = 100 * 1024 * 1024;

@Controller('audio')
export class AudioController {
  constructor(private readonly auth: AuthService, private readonly audio: AudioService) {}

  @Get()
  async list(@Req() request: Request) {
    const user = await this.auth.requireUser(sessionToken(request.headers.cookie));
    return this.audio.list(user.id);
  }

  @Post('upload')
  @UseInterceptors(AnyFilesInterceptor({ limits: { files: 20, fileSize: MAX_AUDIO_FILE_SIZE } }))
  async upload(@Req() request: Request, @UploadedFiles() files: Array<{ originalname: string; mimetype: string; size: number; buffer: Buffer }>) {
    const user = await this.auth.requireUser(sessionToken(request.headers.cookie));
    return this.audio.upload(user.id, files);
  }
}
