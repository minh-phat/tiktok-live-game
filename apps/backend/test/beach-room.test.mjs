import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { RoomsService } = require('../dist/live/rooms.service.js');

test('beach rooms persist their theme and support both LIVE platforms', async () => {
  const saved = [];
  const service = new RoomsService({ rooms: { insertOne: async (room) => saved.push(room) } });
  for (const platform of ['tiktok', 'youtube']) {
    const room = await service.create('owner', {
      name: 'Quán nước bãi biển', theme: 'beach-bar', platform,
      tiktokUsername: '@beach_demo', youtubeLiveId: 'https://www.youtube.com/watch?v=abcdefgh_-1',
    });
    assert.equal(room.theme, 'beach-bar');
    assert.equal(room.platform, platform);
    assert.equal(room.ownerId, 'owner');
    assert.deepEqual(room.audio, { trackIds: [], orderMode: 'manual' });
    assert.equal(saved.at(-1), room);
  }
  assert.equal(saved[0].tiktokUsername, 'beach_demo');
  assert.equal(saved[1].youtubeLiveId, 'abcdefgh_-1');
  await assert.rejects(service.create('owner', {
    name: 'Invalid theme', theme: 'unknown', tiktokUsername: 'beach_demo',
  }), /Chủ đề phòng không hợp lệ/);
  assert.equal(saved.length, 2);
});
