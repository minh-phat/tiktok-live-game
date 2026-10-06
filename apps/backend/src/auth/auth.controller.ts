import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, sessionToken } from './session';
import { LiveGateway } from '../live/live.gateway';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly gateway: LiveGateway) {}

  private setCookie(response: Response, token: string) {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Post('register')
  async register(@Body() body: { email?: string; name?: string; password?: string }, @Res({ passthrough: true }) response: Response) {
    const user = await this.auth.register(body);
    this.setCookie(response, await this.auth.createSession(user));
    return this.auth.publicUser(user);
  }

  @Post('login')
  async login(@Body() body: { email?: string; password?: string }, @Res({ passthrough: true }) response: Response) {
    const user = await this.auth.login(body);
    this.setCookie(response, await this.auth.createSession(user));
    return this.auth.publicUser(user);
  }

  @Get('me')
  async me(@Req() request: Request) {
    return this.auth.publicUser(await this.auth.requireUser(sessionToken(request.headers.cookie)));
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = sessionToken(request.headers.cookie);
    await this.auth.logout(token);
    this.gateway.disconnectSession(token);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }
}
