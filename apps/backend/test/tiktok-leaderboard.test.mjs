import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { TikTokLiveService } = require('../dist/live/tiktok-live.service.js');

const guest = (id, nickname = id) => ({
  id, username: id, nickname, avatar: `${id}.png`, seat: 0, joinedAt: Date.now(),
});

test('aggregates and ranks TikTok gifters and likers for the current session', () => {
  const service = new TikTokLiveService();
  const events = [];
  service.setServer({ to: () => ({ emit: (event, data) => events.push({ event, data }) }) });

  service.addSupport('room', guest('an', 'An'), { gifts: 2, diamonds: 20 });
  service.addSupport('room', guest('binh', 'Bình'), { gifts: 1, diamonds: 50, likes: 4 });
  service.addSupport('room', guest('an', 'An'), { likes: 12 });
  service.addSupport('room', guest('chi', 'Chi'), { likes: 7 });

  const board = service.snapshot('room').leaderboard;
  assert.deepEqual(board.gifters.map((entry) => entry.guestId), ['binh', 'an']);
  assert.deepEqual(board.likers.map((entry) => entry.guestId), ['an', 'chi', 'binh']);
  assert.equal(board.gifters[1].gifts, 2);
  assert.equal(board.likers[0].likes, 12);
  assert.ok(events.some((entry) => entry.event === 'live:leaderboard'));

  service.disconnect('room');
  assert.deepEqual(service.snapshot('room').leaderboard, { gifters: [], likers: [] });
});
