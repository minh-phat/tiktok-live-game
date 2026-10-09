import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test, mock, afterEach } from 'node:test';

const require = createRequire(import.meta.url);
const { LiveChat, NotLiveError, RateLimitError } = require('youtube-chat-next');
const { YouTubeLiveService } = require('../dist/live/youtube-live.service.js');
const { youtubeLiveId } = require('../dist/live/youtube-source.js');
const { RoomsService } = require('../dist/live/rooms.service.js');
const { LiveGateway } = require('../dist/live/live.gateway.js');
const room = { id: 'room-yt', platform: 'youtube', youtubeLiveId: 'abcdefgh_-1' };
afterEach(() => mock.restoreAll());

function setup(start) {
  const connections = [];
  mock.method(LiveChat.prototype, 'start', function () {
    connections.push(this);
    return start ? start.call(this) : Promise.resolve().then(() => { this.emit('start', this.liveId); return true; });
  });
  mock.method(LiveChat.prototype, 'stop', function () { this.emit('end'); });
  const service = new YouTubeLiveService();
  const events = [];
  service.setServer({ to: (target) => ({ emit: (event, data) => events.push({ target, event, data }) }) });
  return { service, events, connections };
}

function chat(id = 'msg-1', channelId = 'UC-viewer') {
  return {
    id, author: { channelId, name: 'Khách YouTube', thumbnail: { url: 'https://example.com/avatar', alt: '' } },
    message: [{ text: 'Xin chào ' }, { emojiText: '☕', alt: 'coffee', url: '', isCustomEmoji: false }],
    timestamp: new Date('2026-10-08T00:00:00Z'),
  };
}

test('accepts broadcast links and rejects unrelated hosts, handles and malformed IDs', () => {
  for (const value of [room.youtubeLiveId, `https://www.youtube.com/watch?v=${room.youtubeLiveId}&feature=share`,
    `youtube.com/live/${room.youtubeLiveId}?si=abc`, `https://youtu.be/${room.youtubeLiveId}?t=10`,
    `https://m.youtube.com/watch?v=${room.youtubeLiveId}`, `https://www.youtube.com/embed/${room.youtubeLiveId}`]) {
    assert.equal(youtubeLiveId(value), room.youtubeLiveId);
  }
  for (const value of [undefined, {}, 'abc', '@channel', 'https://youtube.com/@channel/live',
    `https://youtube.com.evil.test/watch?v=${room.youtubeLiveId}`, `https://evil.test/${room.youtubeLiveId}`,
    `https://youtube.com@evil.test/watch?v=${room.youtubeLiveId}`, `ftp://youtube.com/watch?v=${room.youtubeLiveId}`]) {
    assert.equal(youtubeLiveId(value), '');
  }
});

test('creates YouTube rooms and preserves the legacy TikTok input', async () => {
  const stored = [];
  const rooms = new RoomsService({ rooms: { countDocuments: async () => 0, insertOne: async (value) => stored.push(value) } });
  const base = { name: 'Quán thử', theme: 'sidewalk-cafe' };
  const youtube = await rooms.create('owner', { ...base, platform: 'youtube', youtubeLiveId: `https://youtu.be/${room.youtubeLiveId}` });
  assert.equal(youtube.youtubeLiveId, room.youtubeLiveId);
  assert.equal(youtube.platform, 'youtube');
  assert.equal(youtube.tiktokUsername, '');
  const tiktok = await rooms.create('owner', { ...base, tiktokUsername: 'tiktok.com/@demo_user/live' });
  assert.equal(tiktok.platform, 'tiktok');
  assert.equal(tiktok.tiktokUsername, 'demo_user');
  await assert.rejects(rooms.create('owner', { ...base, platform: 'youtube', youtubeLiveId: 'invalid' }));
  await assert.rejects(rooms.create('owner', { ...base, platform: 'invalid', tiktokUsername: 'demo_user' }));
  assert.equal(stored.length, 2);
});

test('maps chat and emoji to guests/comments, deduplicates and isolates rooms', async () => {
  const { service, connections, events } = setup();
  await service.connect(room);
  assert.equal(service.snapshot(room.id).status.state, 'connected');
  connections[0].emit('chat', chat());
  connections[0].emit('chat', chat());
  connections[0].emit('chat', chat('msg-2'));
  const data = service.snapshot(room.id);
  assert.equal(data.guests.length, 1);
  assert.equal(data.comments.length, 2);
  assert.equal(data.comments[0].comment, 'Xin chào ☕');
  assert.equal(data.comments[0].guestId, 'youtube:UC-viewer');
  assert.equal(data.viewers, null);
  assert.deepEqual(data.gifts, []);
  assert.deepEqual(data.leaderboard, { gifters: [], likers: [] });
  assert.ok(events.every((event) => event.target === `room:${room.id}`));
  assert.equal(service.snapshot('other-room').comments.length, 0);
  service.disconnect(room.id);
  connections[0].emit('chat', chat('late-message'));
  assert.equal(service.snapshot(room.id).comments.length, 0);
  assert.equal(service.snapshot(room.id).status.state, 'disconnected');
});

test('maps YouTube Super Chats and stickers to gifts and a gifter leaderboard', async () => {
  const { service, connections, events } = setup();
  await service.connect(room);
  const paid = chat('paid-1', 'paid-viewer');
  paid.message = [];
  paid.superchat = { amount: '₫50.000', color: '#1de9b6', sticker: { url: 'https://example.com/sticker', alt: 'sticker' } };
  connections[0].emit('chat', paid);
  connections[0].emit('chat', paid);
  const second = chat('paid-2', 'paid-viewer');
  second.superchat = { amount: '₫20.000', color: '#00e5ff' };
  connections[0].emit('chat', second);

  const data = service.snapshot(room.id);
  assert.equal(data.gifts.length, 2);
  assert.equal(data.gifts[1].giftImage, 'https://example.com/sticker');
  assert.equal(data.comments[1].comment, 'Đã gửi Super Chat ₫50.000');
  assert.equal(data.leaderboard.gifters[0].gifts, 2);
  assert.deepEqual(data.leaderboard.likers, []);
  assert.ok(events.some((entry) => entry.event === 'live:gift'));
  assert.ok(events.some((entry) => entry.event === 'live:leaderboard'));
});

test('bounds history and reuses seats when new guests arrive', async () => {
  const { service, connections } = setup();
  await service.connect(room);
  for (let i = 0; i < 210; i++) connections[0].emit('chat', chat(`msg-${i}`, `viewer-${i}`));
  const data = service.snapshot(room.id);
  assert.equal(data.comments.length, 100);
  assert.equal(data.guests.length, 200);
  assert.equal(new Set(data.guests.map((guest) => guest.seat)).size, 200);
  service.onModuleDestroy();
  assert.equal(service.snapshot(room.id).status.state, 'disconnected');
});

test('failed start is rejected and produces a disconnected status', async () => {
  const failure = new NotLiveError('offline');
  const { service } = setup(async function () { this.emit('error', failure); return false; });
  await assert.rejects(service.connect(room), failure);
  assert.equal(service.snapshot(room.id).status.state, 'disconnected');
  assert.match(service.snapshot(room.id).status.message, /chưa LIVE/);
});

test('disconnect and reconnect while start is pending stop obsolete connections', async () => {
  const pending = [];
  const { service, connections } = setup(function () {
    return new Promise((resolve) => pending.push(() => { this.emit('start', this.liveId); resolve(true); }));
  });
  const first = service.connect(room);
  service.disconnect(room.id);
  const second = service.connect(room);
  pending[0]();
  await first;
  assert.equal(service.snapshot(room.id).status.state, 'connecting');
  assert.ok(connections[0].stop.mock.calls.some((call) => call.this === connections[0]));
  connections[0].emit('chat', chat('obsolete'));
  pending[1]();
  await second;
  assert.equal(service.snapshot(room.id).status.state, 'connected');
  assert.equal(service.snapshot(room.id).comments.length, 0);
  connections[0].emit('end');
  assert.equal(service.snapshot(room.id).status.state, 'connected');
  service.onModuleDestroy();
});

test('runtime rate limits and terminal errors are surfaced; stream end resets the room', async () => {
  const { service, connections } = setup();
  await service.connect(room);
  connections[0].emit('error', new RateLimitError(429, 30000));
  assert.match(service.snapshot(room.id).status.message, /giới hạn/);
  connections[0].emit('end', 'Stopped after errors');
  assert.equal(service.snapshot(room.id).status.state, 'disconnected');
  assert.match(service.snapshot(room.id).status.message, /giới hạn/);
  await service.connect(room);
  connections[1].emit('chat', chat());
  connections[1].emit('end', 'Live stream ended');
  assert.equal(service.snapshot(room.id).comments.length, 0);
  assert.match(service.snapshot(room.id).status.message, /kết thúc/);
});

test('gateway routes by persisted platform and checks ownership for both providers', async () => {
  const calls = [];
  const provider = (name) => ({
    snapshot: () => ({ provider: name }), connect: async () => calls.push(`${name}:connect`),
    disconnect: () => calls.push(`${name}:disconnect`), publicError: () => 'failed',
  });
  const gateway = new LiveGateway({ getUser: async () => ({ id: 'owner' }) }, {
    get: async (_owner, id) => {
      if (id === 'forbidden') throw new Error('not owned');
      return id === room.id ? room : { id };
    },
  }, provider('tiktok'), provider('youtube'));
  const client = { handshake: { headers: {} }, join: async () => {} };
  for (const [id, expected] of [[room.id, 'youtube'], ['legacy', 'tiktok']]) {
    assert.equal((await gateway.join(client, { roomId: id })).data.provider, expected);
    assert.equal((await gateway.connect(client, { roomId: id })).ok, true);
    assert.equal((await gateway.disconnect(client, { roomId: id })).ok, true);
  }
  for (const method of ['join', 'connect', 'disconnect']) {
    assert.equal((await gateway[method](client, { roomId: 'forbidden' })).ok, false);
  }
  assert.deepEqual(calls, ['youtube:connect', 'youtube:disconnect', 'tiktok:connect', 'tiktok:disconnect']);
});

test('gateway validates presentation customizations before broadcasting them', async () => {
  const provider = { snapshot: () => ({}), connect: async () => {}, disconnect: () => {}, publicError: () => '' };
  const gateway = new LiveGateway({ getUser: async () => ({ id: 'owner' }) }, {
    get: async () => ({ id: 'room', platform: 'tiktok' }),
  }, provider, provider);
  const broadcasts = [];
  gateway.server = { to: () => ({ emit: (_event, data) => broadcasts.push(data) }) };
  const client = { handshake: { headers: {} } };
  const reply = await gateway.updatePresentation(client, {
    roomId: 'room',
    presentation: {
      leaderboardLayout: {
        desktop: { gifters: { x: 999, y: -5, scale: 10 }, likers: { x: 22, y: 33, scale: 140 } },
        phone: { gifters: { x: 44, y: 12, scale: 120 }, likers: { x: 55, y: 40, scale: 90 } },
      },
      beachSign: { text: `  ${'Bãi biển '.repeat(10)}  `, visible: false, scale: 999 },
    },
  });
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.data.leaderboardLayout.desktop.gifters, { x: 92, y: 0, scale: 50 });
  assert.deepEqual(reply.data.leaderboardLayout.desktop.likers, { x: 22, y: 33, scale: 140 });
  assert.equal(reply.data.beachSign.text.length, 40);
  assert.equal(reply.data.beachSign.visible, false);
  assert.equal(reply.data.beachSign.scale, 160);
  assert.equal(broadcasts.length, 1);
});
