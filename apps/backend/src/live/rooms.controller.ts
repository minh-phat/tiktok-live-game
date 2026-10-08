import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { sessionToken } from '../auth/session';
import { RoomsService } from './rooms.service';
import type { CreateRoomInput } from './live.types';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly auth: AuthService, private readonly rooms: RoomsService) {}

  @Get()
  async list(@Req() request: Request) {
    const user = await this.auth.requireUser(sessionToken(request.headers.cookie));
    return this.rooms.list(user.id);
  }

  @Get(':id')
  async get(@Req() request: Request, @Param('id') id: string) {
    const user = await this.auth.requireUser(sessionToken(request.headers.cookie));
    return this.rooms.get(user.id, id);
  }

  @Post()
  async create(@Req() request: Request, @Body() body: CreateRoomInput) {
    const user = await this.auth.requireUser(sessionToken(request.headers.cookie));
    return this.rooms.create(user.id, body);
  }

  @Patch(':id/audio')
  async updateAudio(@Req() request: Request, @Param('id') id: string, @Body() body: { trackIds?: unknown; orderMode?: unknown }) {
    const user = await this.auth.requireUser(sessionToken(request.headers.cookie));
    return this.rooms.updateAudio(user.id, id, body);
  }
}
