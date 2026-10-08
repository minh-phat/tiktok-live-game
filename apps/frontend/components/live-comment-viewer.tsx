'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';

type Theme = 'sidewalk-cafe' | 'tea-room';
type ViewMode = 'desktop' | 'phone';
type Status = { state: 'connected' | 'connecting' | 'disconnected'; message: string; username?: string };
type User = { id: string; name: string; email: string };
type AudioOrderMode = 'manual' | 'random' | 'name' | 'createdAt';
type AudioTrack = { id: string; name: string; url: string; mimeType: string; size: number; createdAt: string };
type Room = { id: string; name: string; theme: Theme; tiktokUsername: string; createdAt: string; audio?: { trackIds: string[]; orderMode: AudioOrderMode } };
type Guest = { id: string; username: string; nickname: string; avatar: string; seat: number; joinedAt: number };
type Comment = { id: string; guestId: string; username: string; nickname: string; avatar: string; comment: string; timestamp: number };
type Gift = { id: string; guestId: string; username: string; nickname: string; avatar: string; giftId: string; giftName: string; giftImage: string; count: number; diamonds: number; timestamp: number };
type Snapshot = { status: Status; guests: Guest[]; comments: Comment[]; gifts: Gift[]; viewers: number | null };
type Reply<T = undefined> = { ok: boolean; message?: string; data?: T };
type RainSettings = { automatic: boolean; maxDelayMinutes: number; durationSeconds: number };

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
const MAX_AUDIO_FILE_SIZE = 100 * 1024 * 1024;
const emptyStatus: Status = { state: 'disconnected', message: 'Chưa kết nối TikTok LIVE' };

async function api<T>(path: string, method = 'GET', body?: object | FormData): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(`${backendUrl}${path}`, {
    method, credentials: 'include',
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new Error(message || 'Không thể kết nối server.');
  }
  return data as T;
}

export function LiveCommentViewer() {
  const [user, setUser] = useState<User | null | undefined>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<User>('/auth/me').then(async (account) => {
      setUser(account);
      try { setRooms(await api<Room[]>('/rooms')); }
      catch (cause) { setError((cause as Error).message); }
    }).catch(() => setUser(null));
  }, []);

  async function logout() {
    try { await api('/auth/logout', 'POST'); } catch { /* vẫn thoát trên trình duyệt */ }
    setActiveRoom(null);
    setRooms([]);
    setUser(null);
  }

  if (user === undefined) return <div className="loading-screen">Đang mở quán…</div>;
  if (!user) return <AuthScreen onSuccess={async (account) => {
    setUser(account);
    setError('');
    try { setRooms(await api<Room[]>('/rooms')); } catch (cause) { setError((cause as Error).message); }
  }} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => setActiveRoom(null)} type="button"><span className="logo-icon">☕</span> LIVE QUÁN</button>
        <div className="account"><span>Xin chào, <strong>{user.name}</strong></span><button className="text-button" onClick={logout}>Đăng xuất</button></div>
      </header>
      {error && <p className="notice error" role="alert">{error}</p>}
      {activeRoom
        ? <RoomScreen key={activeRoom.id} room={activeRoom} onBack={() => setActiveRoom(null)} />
        : <Dashboard rooms={rooms} onOpen={setActiveRoom} onCreated={(room) => {
          setRooms((current) => [room, ...current]);
          setActiveRoom(room);
        }} />}
    </div>
  );
}

function AuthScreen({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const account = await api<User>(`/auth/${mode}`, 'POST', mode === 'register' ? { name, email, password } : { email, password });
      onSuccess(account);
    } catch (cause) {
      setError((cause as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-layout">
      <div className="auth-hero">
        <span className="eyebrow">LIVE QUÁN · THẾ GIỚI 2D</span>
        <h1>Biến buổi LIVE thành <em>một quán nhỏ.</em></h1>
        <p>Người xem bước vào, chọn ghế và trò chuyện. Mỗi bình luận TikTok trở thành một câu chuyện ngay trong quán của bạn.</p>
        <div className="preview-scene" aria-hidden="true"><span>☕</span><span>🪑</span><span>💬</span></div>
      </div>
      <section className="auth-card">
        <span className="eyebrow">BẮT ĐẦU</span>
        <h2>{mode === 'login' ? 'Chào mừng trở lại' : 'Tạo tài khoản'}</h2>
        <p className="muted">{mode === 'login' ? 'Đăng nhập để mở phòng LIVE của bạn.' : 'Tạo tài khoản để lưu và quản lý phòng.'}</p>
        <form onSubmit={submit} className="stack-form">
          {mode === 'register' && <label> Tên hiển thị <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={60} placeholder="Ví dụ: Minh" required /></label>}
          <label>Email <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ban@example.com" required /></label>
          <label>Mật khẩu <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} placeholder="Ít nhất 8 ký tự" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}</button>
        </form>
        <p className="switch-auth">{mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} type="button">{mode === 'login' ? 'Đăng ký' : 'Đăng nhập'}</button></p>
      </section>
    </main>
  );
}

const themeOptions: { id: Theme; icon: string; title: string; description: string }[] = [
  { id: 'sidewalk-cafe', icon: '☕', title: 'Cà phê vỉa hè', description: 'Ghế nhựa, đèn phố và câu chuyện lúc đêm.' },
  { id: 'tea-room', icon: '♫', title: 'Phòng trà', description: 'Ánh đèn ấm, sân khấu nhỏ và nhạc nhẹ.' },
];

function Dashboard({ rooms, onOpen, onCreated }: { rooms: Room[]; onOpen: (room: Room) => void; onCreated: (room: Room) => void }) {
  const [theme, setTheme] = useState<Theme>('sidewalk-cafe');
  const [name, setName] = useState('Cà phê vỉa hè');
  const [tiktokUsername, setTiktokUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const room = await api<Room>('/rooms', 'POST', { theme, name, tiktokUsername });
      onCreated(room);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <main className="dashboard">
      <section className="dashboard-intro"><span className="eyebrow">BẢNG ĐIỀU KHIỂN</span><h1>Mở quán, bật LIVE,<br /><em>mọi người sẽ ghé.</em></h1><p>Chọn không gian cho buổi phát và kết nối tài khoản TikTok đang LIVE.</p></section>
      <section className="create-panel">
        <div className="section-heading"><div><span className="eyebrow">01 / KHÔNG GIAN</span><h2>Tạo phòng LIVE mới</h2></div><span className="step-badge">Tối đa 20 phòng</span></div>
        <form onSubmit={create}>
          <div className="theme-grid">
            {themeOptions.map((option) => <button key={option.id} type="button" className={`theme-card ${theme === option.id ? 'selected' : ''}`} onClick={() => { setTheme(option.id); setName(option.title); }}><span className="theme-icon">{option.icon}</span><strong>{option.title}</strong><small>{option.description}</small><span className="theme-check">{theme === option.id ? '✓' : ''}</span></button>)}
          </div>
          <div className="form-grid">
            <label>Tên phòng <input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={80} required placeholder="Đặt tên quán của bạn" /></label>
            <label>TikTok username hoặc link LIVE <input value={tiktokUsername} onChange={(event) => setTiktokUsername(event.target.value)} required placeholder="@username hoặc tiktok.com/@username/live" /></label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-footer"><p>Phòng được lưu vào tài khoản của bạn. Kết nối bắt đầu khi bạn mở phòng.</p><button className="primary-button" disabled={busy} type="submit">{busy ? 'Đang tạo…' : 'Tạo & mở phòng →'}</button></div>
        </form>
      </section>
      <section className="saved-rooms"><div className="section-heading"><div><span className="eyebrow">02 / PHÒNG CỦA BẠN</span><h2>Quán đã tạo</h2></div><span className="step-badge">{rooms.length} phòng</span></div>
        {rooms.length === 0 ? <div className="empty-rooms">Chưa có phòng nào. Chọn một không gian ở trên để bắt đầu.</div> : <div className="room-grid">{rooms.map((room) => <button className="room-card" key={room.id} onClick={() => onOpen(room)}><span className="room-art">{room.theme === 'sidewalk-cafe' ? '☕' : '♫'}</span><span className="room-info"><strong>{room.name}</strong><small>@{room.tiktokUsername} · {room.theme === 'sidewalk-cafe' ? 'Cà phê vỉa hè' : 'Phòng trà'}</small></span><span className="room-arrow">↗</span></button>)}</div>}
      </section>
    </main>
  );
}

function RoomScreen({ room, onBack }: { room: Room; onBack: () => void }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<Status>(emptyStatus);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [viewers, setViewers] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('desktop');
  const [rainSettings, setRainSettings] = useState<RainSettings>({ automatic: true, maxDelayMinutes: 3, durationSeconds: 45 });
  const [isRaining, setIsRaining] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const nextRainTimer = useRef<number | null>(null);
  const rainEndTimer = useRef<number | null>(null);
  const rainSettingsSaveSkipped = useRef(false);

  const clearRainTimers = useCallback(() => {
    if (nextRainTimer.current !== null) window.clearTimeout(nextRainTimer.current);
    if (rainEndTimer.current !== null) window.clearTimeout(rainEndTimer.current);
    nextRainTimer.current = null;
    rainEndTimer.current = null;
  }, []);

  const clearNextRain = useCallback(() => {
    if (nextRainTimer.current !== null) window.clearTimeout(nextRainTimer.current);
    nextRainTimer.current = null;
  }, []);

  const startRain = useCallback(() => {
    if (nextRainTimer.current !== null) window.clearTimeout(nextRainTimer.current);
    if (rainEndTimer.current !== null) window.clearTimeout(rainEndTimer.current);
    setIsRaining(true);
    rainEndTimer.current = window.setTimeout(() => setIsRaining(false), rainSettings.durationSeconds * 1000);
  }, [rainSettings.durationSeconds]);

  const stopRain = useCallback(() => {
    if (rainEndTimer.current !== null) window.clearTimeout(rainEndTimer.current);
    rainEndTimer.current = null;
    setIsRaining(false);
  }, []);

  useEffect(() => {
    const savedMode = window.localStorage.getItem('live-room-view-mode');
    if (savedMode === 'desktop' || savedMode === 'phone') setViewMode(savedMode);
    const savedRain = window.localStorage.getItem(`live-room-rain-${room.id}`);
    if (savedRain) {
      try { setRainSettings((current) => ({ ...current, ...JSON.parse(savedRain) })); } catch { /* dùng cấu hình mặc định */ }
    }
  }, []);

  useEffect(() => {
    if (!rainSettingsSaveSkipped.current) {
      rainSettingsSaveSkipped.current = true;
      return;
    }
    if (room.theme !== 'sidewalk-cafe') return;
    window.localStorage.setItem(`live-room-rain-${room.id}`, JSON.stringify(rainSettings));
  }, [rainSettings, room.id, room.theme]);

  useEffect(() => {
    clearNextRain();
    if (room.theme !== 'sidewalk-cafe' || !rainSettings.automatic || isRaining) return clearNextRain;
    const maximum = rainSettings.maxDelayMinutes * 60 * 1000;
    const minimum = Math.min(15_000, maximum);
    const delay = minimum + Math.random() * Math.max(0, maximum - minimum);
    nextRainTimer.current = window.setTimeout(startRain, delay);
    return clearNextRain;
  }, [clearNextRain, isRaining, rainSettings.automatic, rainSettings.maxDelayMinutes, room.theme, startRain]);

  useEffect(() => clearRainTimers, [clearRainTimers]);

  useEffect(() => {
    const connection = io(backendUrl, { withCredentials: true });
    connection.on('connect', () => {
      connection.emit('room:join', { roomId: room.id }, (reply: Reply<Snapshot>) => {
        if (!reply.ok || !reply.data) { setError(reply.message ?? 'Không vào được phòng.'); return; }
        setStatus(reply.data.status);
        setGuests(reply.data.guests);
        setComments(reply.data.comments);
        setGifts(reply.data.gifts ?? []);
        setViewers(reply.data.viewers);
        if (reply.data.status.state === 'disconnected') {
          connection.emit('live:connect', { roomId: room.id }, (result: Reply) => {
            if (!result.ok) setError(result.message ?? 'Kết nối TikTok thất bại.');
          });
        }
      });
    });
    connection.on('live:status', (next: Status) => setStatus(next));
    connection.on('live:guest-joined', (guest: Guest) => setGuests((current) => [...current.filter((item) => item.id !== guest.id), guest]));
    connection.on('live:guest-left', ({ id }: { id: string }) => setGuests((current) => current.filter((guest) => guest.id !== id)));
    connection.on('live:comment', (comment: Comment) => setComments((current) => [comment, ...current].slice(0, 100)));
    connection.on('live:gift', (gift: Gift) => setGifts((current) => [gift, ...current].slice(0, 20)));
    connection.on('live:stats', ({ viewers: count }: { viewers: number | null }) => setViewers(count));
    connection.on('live:reset', () => { setGuests([]); setComments([]); setGifts([]); setViewers(null); });
    connection.on('connect_error', () => setError('Không thể kết nối backend.'));
    setSocket(connection);
    return () => { connection.emit('room:leave', { roomId: room.id }); connection.disconnect(); };
  }, [room.id]);

  function reconnect() {
    setError('');
    socket?.emit('live:connect', { roomId: room.id }, (reply: Reply) => {
      if (!reply.ok) setError(reply.message ?? 'Kết nối TikTok thất bại.');
    });
  }

  function disconnect() { socket?.emit('live:disconnect', { roomId: room.id }); }

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    window.localStorage.setItem('live-room-view-mode', mode);
  }

  async function openFullscreen() {
    if (!stageRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stageRef.current.requestFullscreen();
  }

  return (
    <main className="room-page">
      <div className="room-titlebar"><div><button className="back-button" onClick={onBack}>← Tất cả phòng</button><span className="eyebrow">{room.theme === 'sidewalk-cafe' ? 'CÀ PHÊ VỈA HÈ' : 'PHÒNG TRÀ'} / @{room.tiktokUsername}</span><h1>{room.name}</h1></div><div className="room-actions"><div className="view-mode-switch" role="group" aria-label="Chế độ hiển thị"><button type="button" className={viewMode === 'phone' ? 'active' : ''} onClick={() => changeViewMode('phone')} aria-pressed={viewMode === 'phone'}>▯ Điện thoại</button><button type="button" className={viewMode === 'desktop' ? 'active' : ''} onClick={() => changeViewMode('desktop')} aria-pressed={viewMode === 'desktop'}>▭ Desktop</button></div><div className="room-controls"><span className={`live-pill ${status.state}`}><span />{status.state === 'connected' ? 'ĐANG LIVE' : status.state === 'connecting' ? 'ĐANG KẾT NỐI' : 'CHƯA LIVE'}</span>{status.state === 'connected' ? <button className="secondary-button" onClick={disconnect}>Ngắt kết nối</button> : <button className="primary-button" disabled={status.state === 'connecting'} onClick={reconnect}>Kết nối lại</button>}</div></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <AudioManager room={room} onError={setError} />
      {room.theme === 'sidewalk-cafe' && <section className="weather-controls" aria-label="Điều khiển thời tiết">
        <div className="weather-heading"><span className={`weather-icon ${isRaining ? 'raining' : ''}`}>{isRaining ? '🌧' : '☁'}</span><div><span className="eyebrow">THỜI TIẾT QUÁN</span><strong>{isRaining ? 'Đang mưa · bạt đã được kéo ra' : rainSettings.automatic ? `Mưa ngẫu nhiên trong tối đa ${rainSettings.maxDelayMinutes} phút` : 'Mưa tự động đang tắt'}</strong></div></div>
        <label className="weather-toggle"><input type="checkbox" checked={rainSettings.automatic} onChange={(event) => setRainSettings((current) => ({ ...current, automatic: event.target.checked }))} /><span /> Mưa tự động</label>
        <label>Tối đa <input type="number" min="0.25" max="30" step="0.25" value={rainSettings.maxDelayMinutes} onChange={(event) => setRainSettings((current) => ({ ...current, maxDelayMinutes: Math.min(30, Math.max(0.25, Number(event.target.value) || 3)) }))} /> phút</label>
        <label>Kéo dài <input type="number" min="10" max="300" step="5" value={rainSettings.durationSeconds} onChange={(event) => setRainSettings((current) => ({ ...current, durationSeconds: Math.min(300, Math.max(10, Number(event.target.value) || 45)) }))} /> giây</label>
        <button type="button" className="secondary-button weather-button" onClick={() => isRaining ? stopRain() : startRain()}>{isRaining ? 'Tạnh mưa' : 'Cho mưa ngay'}</button>
      </section>}
      <div className={`room-layout ${viewMode}-view`}>
        <div className="scene-column"><div className="stream-stage" ref={stageRef}><Scene theme={room.theme} guests={guests} comments={comments} gifts={gifts} viewMode={viewMode} isRaining={isRaining} /></div><div className="scene-footer"><span><i className="status-dot" />{status.message}</span><span>{viewers === null ? '—' : viewers.toLocaleString('vi-VN')} người xem TikTok · {guests.length} khách trong quán</span><button type="button" className="fullscreen-button" onClick={openFullscreen}>⛶ Toàn màn hình</button></div></div>
        <aside className="chat-panel"><div className="chat-head"><div><span className="eyebrow">CUỘC TRÒ CHUYỆN</span><h2>Bình luận LIVE</h2></div><span className="chat-count">{comments.length}</span></div><div className="chat-list">{comments.length ? comments.map((comment) => <div className="chat-line" key={comment.id}><Avatar avatar={comment.avatar} name={comment.nickname} /><div><div className="chat-meta"><strong>{comment.nickname}</strong><time>{new Date(comment.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{comment.comment}</p></div></div>) : <div className="chat-empty"><span>💬</span><strong>Chưa có lời nhắn</strong><p>Khi có bình luận, bong bóng chat sẽ hiện trên nhân vật trong quán.</p></div>}</div><div className="chat-foot">Tin nhắn được lấy trực tiếp từ TikTok LIVE</div></aside>
      </div>
    </main>
  );
}

function AudioManager({ room, onError }: { room: Room; onError: (message: string) => void }) {
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [selectedIds, setSelectedIds] = useState(room.audio?.trackIds ?? []);
  const [mode, setMode] = useState<AudioOrderMode>(room.audio?.orderMode ?? 'manual');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => { api<AudioTrack[]>('/audio').then(setTracks).catch((cause) => onError((cause as Error).message)); }, [onError]);

  const playlist = useMemo(() => {
    const chosen = selectedIds.map((id) => tracks.find((track) => track.id === id)).filter((track): track is AudioTrack => Boolean(track));
    if (mode === 'name') return [...chosen].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    if (mode === 'createdAt') return [...chosen].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (mode === 'random') return [...chosen].sort(() => Math.random() - 0.5);
    return chosen;
  }, [tracks, selectedIds, mode]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const oversizedFile = Array.from(files).find((file) => file.size > MAX_AUDIO_FILE_SIZE);
    if (oversizedFile) {
      onError(`${oversizedFile.name} vượt quá 100 MB.`);
      return;
    }
    setUploading(true); onError('');
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('files', file));
    try {
      const added = await api<AudioTrack[]>('/audio/upload', 'POST', form);
      setTracks((current) => [...added, ...current]);
    } catch (cause) { onError((cause as Error).message); }
    finally { setUploading(false); }
  }

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function drop(beforeId: string) {
    if (!dragId || dragId === beforeId || mode !== 'manual') return;
    setSelectedIds((current) => {
      const next = current.filter((id) => id !== dragId);
      next.splice(next.indexOf(beforeId), 0, dragId);
      return next;
    });
    setDragId(null);
  }

  async function save() {
    setSaving(true); onError('');
    try { await api(`/rooms/${room.id}/audio`, 'PATCH', { trackIds: selectedIds, orderMode: mode }); }
    catch (cause) { onError((cause as Error).message); }
    finally { setSaving(false); }
  }

  function play(id: string) {
    setCurrentId(id);
    window.setTimeout(() => audioRef.current?.play().catch(() => undefined), 0);
  }

  function playNext() {
    if (!playlist.length) return;
    const index = playlist.findIndex((track) => track.id === currentId);
    play(playlist[(index + 1) % playlist.length].id);
  }

  const current = tracks.find((track) => track.id === currentId);
  return <section className="audio-manager">
    <div className="audio-toolbar">
      <div><span className="eyebrow">ÂM THANH PHÒNG LIVE</span><h2>Playlist phát trong phòng</h2></div>
      <div className="audio-actions">
        <label className={`secondary-button upload-button ${uploading ? 'disabled' : ''}`}>{uploading ? 'Đang tải…' : '＋ Tải nhiều file'}<input type="file" accept="audio/*" multiple disabled={uploading} onChange={(event) => { void upload(event.target.files); event.target.value = ''; }} /></label>
        <select value={mode} onChange={(event) => setMode(event.target.value as AudioOrderMode)} aria-label="Sắp xếp playlist"><option value="manual">Kéo thả thủ công</option><option value="random">Ngẫu nhiên</option><option value="name">Theo tên</option><option value="createdAt">Theo thời gian đăng</option></select>
        <button className="primary-button" type="button" disabled={saving} onClick={save}>{saving ? 'Đang lưu…' : 'Lưu playlist'}</button>
      </div>
    </div>
    {tracks.length === 0 ? <p className="audio-empty">Chưa có âm thanh. Bạn có thể chọn và tải nhiều file cùng lúc (tối đa 100 MB/file).</p> : <div className="audio-content">
      <div className="audio-library"><strong>Thư viện của bạn</strong>{tracks.map((track) => <label key={track.id} className="audio-library-item"><input type="checkbox" checked={selectedIds.includes(track.id)} onChange={() => toggle(track.id)} /><span><b>{track.name}</b><small>{(track.size / 1024 / 1024).toFixed(1)} MB · {new Date(track.createdAt).toLocaleDateString('vi-VN')}</small></span></label>)}</div>
      <div className="playlist"><div className="playlist-title"><strong>Thứ tự phát ({playlist.length})</strong>{playlist.length > 0 && <button type="button" onClick={() => play(playlist[0].id)}>▶ Phát playlist</button>}</div>{playlist.length === 0 ? <span className="muted">Chọn âm thanh từ thư viện.</span> : playlist.map((track, index) => <div key={track.id} className={`playlist-item ${currentId === track.id ? 'playing' : ''}`} draggable={mode === 'manual'} onDragStart={() => setDragId(track.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => drop(track.id)}><span className="drag-handle">{mode === 'manual' ? '⠿' : index + 1}</span><button type="button" onClick={() => play(track.id)}>▶</button><span title={track.name}>{track.name}</span></div>)}</div>
    </div>}
    {current && <div className="audio-player"><span>Đang phát: <strong>{current.name}</strong></span><audio ref={audioRef} src={current.url} controls autoPlay onEnded={playNext} /></div>}
  </section>;
}

function Avatar({ avatar, name }: { avatar: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="mini-avatar">{avatar && !failed ? <img src={avatar} alt="" onError={() => setFailed(true)} /> : name.slice(0, 1).toUpperCase()}</span>;
}

const MAX_SCENE_GUESTS = 200;

function getSeatPosition(seat: number, viewMode: ViewMode) {
  const columns = viewMode === 'phone' ? 10 : 20;
  const rows = MAX_SCENE_GUESTS / columns;
  const slot = ((seat % MAX_SCENE_GUESTS) * 73 + 19) % MAX_SCENE_GUESTS;
  const column = slot % columns;
  const row = Math.floor(slot / columns);
  const leftMin = viewMode === 'phone' ? 7 : 5;
  const leftMax = viewMode === 'phone' ? 93 : 95;
  // Keep the bottom of every character above the curb. The desktop guest box
  // extends ~12% below its center; on mobile it extends ~5.5% below.
  const topMin = viewMode === 'phone' ? 48 : 54;
  const topMax = viewMode === 'phone' ? 79 : 70;
  return {
    left: leftMin + ((column + 0.5) / columns) * (leftMax - leftMin),
    top: topMin + ((row + 0.5) / rows) * (topMax - topMin),
    depth: row,
  };
}

function getGuestSize(viewMode: ViewMode) {
  // Keep guests in the same coordinate system as the scene instead of using
  // viewport-independent pixels. Both dimensions must be explicit because
  // every child inside this absolutely positioned box is also absolute;
  // `height: auto` would therefore collapse the character box to zero. These
  // sizes stay constant regardless of crowd density, so a busy room overlaps
  // characters instead of shrinking them.
  return {
    width: viewMode === 'phone' ? '14%' : '10%',
    height: viewMode === 'phone' ? '10.75%' : '24.35%',
  };
}

function getCrowdDensity(guestCount: number) {
  if (guestCount > 100) return 'packed';
  if (guestCount > 20) return 'busy';
  return 'normal';
}

const guestStyles = [
  { src: '/characters/guest-historical.png', label: 'cổ trang' },
  { src: '/characters/guest-ao-dai.png', label: 'áo dài' },
  { src: '/characters/guest-schoolgirl.png', label: 'nữ sinh' },
  { src: '/characters/guest-student.png', label: 'sinh viên' },
  { src: '/characters/guest-office.png', label: 'công sở' },
  { src: '/characters/guest-streetwear.png', label: 'đường phố' },
  { src: '/characters/guest-retro.png', label: 'bà ba hoài cổ' },
  { src: '/characters/guest-biker.png', label: 'biker' },
  { src: '/characters/guest-artist.png', label: 'nghệ sĩ' },
  { src: '/characters/guest-tourist.png', label: 'du lịch' },
] as const;

function getGuestStyle(guest: Guest) {
  const key = `${guest.id}:${guest.joinedAt}`;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return guestStyles[(hash >>> 0) % guestStyles.length];
}

const staffDialogues = [
  { speaker: 'owner', name: 'Cô chủ Hương', message: 'Lan ơi, mang cà phê sữa đá ra bàn mới nhé!' },
  { speaker: 'maid', name: 'Lan', message: 'Dạ cô, cà phê phin vừa nhỏ xong đây ạ!' },
  { speaker: 'executive', name: 'Minh', message: 'Bàn bên kia cần thêm trà đá, để tôi lo.' },
  { speaker: 'owner', name: 'Cô chủ Hương', message: 'Nhớ kê ghế gọn cho khách mới vào nha.' },
  { speaker: 'maid', name: 'Lan', message: 'Em mời cả nhà dùng cà phê, ngồi sát vào cho vui!' },
  { speaker: 'executive', name: 'Minh', message: 'Cà phê đen ít đường của anh đây. Chúc anh ngon miệng.' },
] as const;

function Scene({ theme, guests, comments, gifts, viewMode, isRaining }: { theme: Theme; guests: Guest[]; comments: Comment[]; gifts: Gift[]; viewMode: ViewMode; isRaining: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const dialogue = staffDialogues[Math.floor(now / 6000) % staffDialogues.length];
  const showStaffBubble = now % 6000 < 5000;
  const crowdDensity = getCrowdDensity(guests.length);
  const guestSize = getGuestSize(viewMode);
  const latestGift = gifts.find((gift) => now - gift.timestamp < 12000);
  return <div className={`scene ${theme} scene-${viewMode} crowd-${crowdDensity}`}>
    <div className="scene-sky"><span className="moon" /><span className="star star-one">✦</span><span className="star star-two">✧</span><span className="star star-three">✦</span></div>
    <div className="shop-front"><div className="shop-roof" /><div className="shop-sign">{theme === 'sidewalk-cafe' ? 'CÀ PHÊ · GÓC PHỐ' : 'PHÒNG TRÀ · ĐÊM NAY'}</div><div className="shop-awning" /><div className="shop-window"><span>☕</span></div><div className="shop-door"><div className="door-glow" /></div><div className="shop-window second"><span>{theme === 'sidewalk-cafe' ? '✳' : '♫'}</span></div></div>
    <div className="scene-lamps"><div className="lamp left" /><div className="lamp right" /></div>
    <div className="pavement" /><div className="street-line" />
    {theme === 'sidewalk-cafe' && isRaining && <div className="rain-weather" aria-label="Trời đang mưa">
      <div className="rain-darkness" />
      <div className="rain-sheet rain-sheet-back" />
      <div className="rain-splashes" />
    </div>}
    <div className="table table-one"><span>☕</span></div><div className="table table-two"><span>☕</span></div><div className="table table-three"><span>☕</span></div>
    {theme === 'sidewalk-cafe' && latestGift && <div className="gift-thank-board" key={latestGift.id} role="status">
      <span className="gift-sparkle">✦</span>
      <Avatar avatar={latestGift.avatar} name={latestGift.nickname} />
      <span className="gift-thank-copy"><small>QUÁN CẢM ƠN</small><strong>{latestGift.nickname}</strong><em>đã tặng {latestGift.giftName}{latestGift.count > 1 ? ` ×${latestGift.count}` : ''}</em></span>
      {latestGift.giftImage ? <img className="gift-image" src={latestGift.giftImage} alt={latestGift.giftName} /> : <span className="gift-fallback">🎁</span>}
    </div>}
    {theme === 'sidewalk-cafe' && <div className="cafe-staff" aria-label="Nhân viên quán cà phê">
      <div className="staff-member staff-owner"><img src="/characters/cafe-owner.png" alt="Cô chủ Hương đang pha cà phê" /></div>
      <div className="staff-member staff-maid"><img src="/characters/maid-server-v2.png" alt="Lan đang phục vụ cà phê" /></div>
      <div className="staff-member staff-executive"><img src="/characters/executive-server-v2.png" alt="Minh đang phục vụ cà phê" /></div>
    </div>}
    {guests.map((guest) => {
      const { left, top, depth } = getSeatPosition(guest.seat, viewMode);
      const guestStyle = getGuestStyle(guest);
      return <div className={`scene-guest chair-${guest.seat % 2}`} key={guest.id} style={{ left: `${left}%`, top: `${top}%`, width: guestSize.width, height: guestSize.height, zIndex: 5 + depth }} title={`@${guest.username}`}>
        <div className="guest-name"><Avatar avatar={guest.avatar} name={guest.nickname} /><span>{guest.nickname}</span></div>
        <div className="guest-chair" />
        <div className="guest-character"><img src={guestStyle.src} alt={`${guest.nickname} trong trang phục ${guestStyle.label}`} /></div>
      </div>;
    })}
    {guests.length === 0 && <div className="scene-placeholder"><span>☕</span><strong>Quán đang chờ khách</strong><small>Khách vào LIVE sẽ xuống quán và tìm ghế ngồi.</small></div>}
    {theme === 'sidewalk-cafe' && isRaining && <div className="cafe-rain-shelter" aria-hidden="true"><div className="tarp"><span className="tarp-seam seam-one" /><span className="tarp-seam seam-two" /><span className="tarp-drip drip-one" /><span className="tarp-drip drip-two" /><span className="tarp-drip drip-three" /></div><span className="tarp-pole pole-left" /><span className="tarp-pole pole-right" /></div>}
    <div className="scene-dialogue-layer">
      {theme === 'sidewalk-cafe' && <>
        <div className="staff-dialogue-anchor staff-owner">{showStaffBubble && dialogue.speaker === 'owner' && <div className="staff-bubble"><strong>{dialogue.name}</strong>{dialogue.message}</div>}</div>
        <div className="staff-dialogue-anchor staff-maid">{showStaffBubble && dialogue.speaker === 'maid' && <div className="staff-bubble"><strong>{dialogue.name}</strong>{dialogue.message}</div>}</div>
        <div className="staff-dialogue-anchor staff-executive">{showStaffBubble && dialogue.speaker === 'executive' && <div className="staff-bubble"><strong>{dialogue.name}</strong>{dialogue.message}</div>}</div>
      </>}
      {guests.map((guest) => {
        const latest = comments.find((comment) => comment.guestId === guest.id);
        if (!latest || now - latest.timestamp >= 7000) return null;
        const { left, top } = getSeatPosition(guest.seat, viewMode);
        return <div className="scene-dialogue-guest" key={latest.id} style={{ left: `${left}%`, top: `${top}%`, width: guestSize.width, height: guestSize.height }}><div className="speech-bubble"><span className="speech-speaker"><strong>{latest.nickname}</strong><small>@{latest.username}</small></span><span className="speech-message">{latest.comment}</span></div></div>;
      })}
    </div>
  </div>;
}
