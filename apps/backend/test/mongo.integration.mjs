import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';
import { MongoClient } from 'mongodb';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const database = `live_test_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
process.env.MONGODB_DB = database;
const { AppModule } = require('../dist/app.module.js');
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
let app;

async function request(base, path, method = 'GET', body, cookie) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}

async function connectSocket(base, cookie) {
  const socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

async function join(socket, roomId) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit('room:join', { roomId }, (error, reply) => error ? reject(error) : resolve(reply));
  });
}

async function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (error, reply) => error ? reject(error) : resolve(reply));
  });
}

try {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const email = `owner-${randomUUID()}@example.com`;
  const owner = await request(base, '/auth/register', 'POST', { name: 'Chủ quán', email, password: 'password123' });
  assert.equal(owner.status, 201);
  assert.ok(owner.cookie);

  const duplicate = await request(base, '/auth/register', 'POST', { name: 'Chủ quán', email, password: 'password123' });
  assert.equal(duplicate.status, 409);

  const created = await request(base, '/rooms', 'POST', {
    name: 'Quán thử nghiệm', theme: 'sidewalk-cafe', tiktokUsername: 'tiktok.com/@demo_user/live',
  }, owner.cookie);
  assert.equal(created.status, 201);
  assert.equal(created.data.tiktokUsername, 'demo_user');
  const roomId = created.data.id;

  const youtube = await request(base, '/rooms', 'POST', {
    name: 'Quán YouTube', theme: 'sidewalk-cafe', platform: 'youtube',
    youtubeLiveId: 'https://www.youtube.com/live/abcdefgh_-1?si=share',
  }, owner.cookie);
  assert.equal(youtube.status, 201);
  assert.equal(youtube.data.platform, 'youtube');
  assert.equal(youtube.data.youtubeLiveId, 'abcdefgh_-1');
  assert.equal((await request(base, '/rooms', 'POST', {
    name: 'Quán lỗi', theme: 'sidewalk-cafe', platform: 'youtube', youtubeLiveId: 'invalid',
  }, owner.cookie)).status, 400);

  const other = await request(base, '/auth/register', 'POST', {
    name: 'Khách khác', email: `other-${randomUUID()}@example.com`, password: 'password123',
  });
  assert.equal((await request(base, `/rooms/${roomId}`, 'GET', undefined, other.cookie)).status, 404);
  assert.equal((await request(base, `/rooms/${youtube.data.id}`, 'GET', undefined, other.cookie)).status, 404);

  const ownerSocket = await connectSocket(base, owner.cookie);
  const otherSocket = await connectSocket(base, other.cookie);
  try {
    assert.equal((await join(ownerSocket, roomId)).ok, true);
    assert.equal((await join(otherSocket, roomId)).ok, false);
    const youtubeSnapshot = await join(ownerSocket, youtube.data.id);
    assert.equal(youtubeSnapshot.ok, true);
    assert.match(youtubeSnapshot.data.status.message, /YouTube/);
    assert.equal((await join(otherSocket, youtube.data.id)).ok, false);
    const presentationEvent = new Promise((resolve) => ownerSocket.once('room:presentation', resolve));
    const presentation = {
      viewMode: 'phone', virtualGuestsEnabled: false, seatSpacing: 65, isRaining: true,
      kidnapping: { phase: 'idle', hostages: [], deadline: null },
    };
    const updatedPresentation = await emit(ownerSocket, 'room:presentation:update', { roomId, presentation });
    assert.equal(updatedPresentation.ok, true);
    assert.deepEqual(updatedPresentation.data, presentation);
    assert.deepEqual(await presentationEvent, presentation);
    assert.deepEqual((await join(ownerSocket, roomId)).data.presentation, presentation);
    assert.equal((await emit(otherSocket, 'room:presentation:update', { roomId, presentation })).ok, false);
    const disconnected = new Promise((resolve) => ownerSocket.once('disconnect', resolve));
    assert.equal((await request(base, '/auth/logout', 'POST', undefined, owner.cookie)).status, 201);
    await disconnected;
    assert.equal((await request(base, '/auth/me', 'GET', undefined, owner.cookie)).status, 401);
  } finally {
    ownerSocket.disconnect();
    otherSocket.disconnect();
  }

  const login = await request(base, '/auth/login', 'POST', { email, password: 'password123' });
  assert.equal(login.status, 201);
  const rooms = await request(base, '/rooms', 'GET', undefined, login.cookie);
  assert.equal(rooms.data.length, 2);
  assert.ok(rooms.data.some((room) => room.id === roomId));
  assert.equal(rooms.data.find((room) => room.id === youtube.data.id).youtubeLiveId, 'abcdefgh_-1');
  console.log('MongoDB integration: đăng ký, phòng, phân quyền, đăng xuất và đăng nhập lại đều thành công.');
} finally {
  if (app) await app.close();
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    await client.db(database).dropDatabase();
  } finally {
    await client.close();
  }
}
