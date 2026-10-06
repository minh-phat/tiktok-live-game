import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.static('public'));

let liveConnection = null;
let connectedUsername = '';
let connectionAttempt = 0;

const cleanUsername = (value = '') => {
  const match = String(value).trim().match(/(?:tiktok\.com\/@)?@?([\w.-]+)/i);
  return match?.[1]?.slice(0, 64) ?? '';
};

const publicError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/offline|not live|room.*not found/i.test(message)) {
    return 'Tài khoản này hiện không phát LIVE hoặc không tìm thấy phòng.';
  }
  return 'Không thể kết nối TikTok LIVE. Hãy kiểm tra username và thử lại.';
};

async function disconnectCurrent(reason = 'Đã ngắt kết nối') {
  connectionAttempt += 1;
  if (liveConnection) {
    try { liveConnection.disconnect(); } catch { /* already disconnected */ }
  }
  liveConnection = null;
  connectedUsername = '';
  io.emit('live:status', { state: 'disconnected', message: reason });
}

async function connectToLive(rawUsername) {
  const username = cleanUsername(rawUsername);
  if (!username) throw new Error('Username TikTok không hợp lệ.');

  await disconnectCurrent('Đang chuyển phòng LIVE...');
  const attempt = connectionAttempt;
  const connection = new TikTokLiveConnection(username, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true
  });
  liveConnection = connection;

  connection.on(WebcastEvent.CHAT, (data) => {
    const user = data.user ?? data;
    const comment = data.content ?? data.comment ?? data.text ?? '';

    // TikTok Live Connector 2.x exposes chat text as `content`.
    // Keep the older fallbacks so this app also works across minor API changes.
    if (!comment) {
      console.warn('Received a chat event without text:', Object.keys(data));
      return;
    }

    io.emit('live:comment', {
      id: data.common?.msgId ?? data.msgId ?? `${Date.now()}-${Math.random()}`,
      username: user.displayId ?? user.uniqueId ?? data.uniqueId ?? 'user',
      nickname: user.nickname ?? data.nickname ?? user.displayId ?? user.uniqueId ?? 'TikTok user',
      avatar: user.profilePictureUrl ?? user.avatarThumb?.urlList?.[0] ?? '',
      comment,
      timestamp: Date.now()
    });
  });

  connection.on(WebcastEvent.ROOM_USER, (data) => {
    io.emit('live:stats', { viewers: data.viewerCount ?? data.topViewers?.length ?? null });
  });

  connection.on(WebcastEvent.STREAM_END, () => disconnectCurrent('Phiên LIVE đã kết thúc.'));
  connection.on(ControlEvent.DISCONNECTED, () => {
    if (attempt === connectionAttempt) {
      io.emit('live:status', { state: 'disconnected', message: 'Mất kết nối với phòng LIVE.' });
    }
  });
  connection.on(ControlEvent.ERROR, (error) => console.error('TikTok connection error:', error));

  const state = await connection.connect();
  if (attempt !== connectionAttempt) return;
  connectedUsername = username;
  io.emit('live:status', {
    state: 'connected',
    username,
    roomId: String(state.roomId ?? ''),
    message: `Đã kết nối @${username}`
  });
}

io.on('connection', (socket) => {
  socket.emit('live:status', connectedUsername
    ? { state: 'connected', username: connectedUsername, message: `Đã kết nối @${connectedUsername}` }
    : { state: 'disconnected', message: 'Chưa kết nối phòng LIVE' });

  socket.on('live:connect', async ({ username } = {}, callback = () => {}) => {
    const safeUsername = cleanUsername(username);
    if (!safeUsername) return callback({ ok: false, message: 'Hãy nhập username TikTok hợp lệ.' });
    io.emit('live:status', { state: 'connecting', username: safeUsername, message: `Đang kết nối @${safeUsername}...` });
    try {
      await connectToLive(safeUsername);
      callback({ ok: true });
    } catch (error) {
      console.error('Connect failed:', error);
      if (liveConnection) await disconnectCurrent(publicError(error));
      callback({ ok: false, message: publicError(error) });
    }
  });

  socket.on('live:disconnect', async () => disconnectCurrent());
});

httpServer.listen(port, () => {
  console.log(`TikTok LIVE viewer đang chạy tại http://localhost:${port}`);
});
