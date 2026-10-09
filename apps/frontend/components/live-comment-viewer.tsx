'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { io, type Socket } from 'socket.io-client';

type Theme = 'sidewalk-cafe' | 'tea-room' | 'beach-bar';

function hasCafeEvents(theme: Theme) {
  return theme === 'sidewalk-cafe' || theme === 'beach-bar';
}
type LivePlatform = 'tiktok' | 'youtube';
type ViewMode = 'desktop' | 'phone';
type Status = { state: 'connected' | 'connecting' | 'disconnected'; message: string; username?: string };
type User = { id: string; name: string; email: string };
type AudioOrderMode = 'manual' | 'random' | 'name' | 'createdAt';
type AudioTrack = { id: string; name: string; url: string; mimeType: string; size: number; createdAt: string };
type Room = { id: string; name: string; theme: Theme; platform?: LivePlatform; tiktokUsername: string; youtubeLiveId?: string; createdAt: string; audio?: { trackIds: string[]; orderMode: AudioOrderMode } };
type Guest = { id: string; username: string; nickname: string; avatar: string; seat: number; joinedAt: number; isVirtual?: boolean };
type Comment = { id: string; guestId: string; username: string; nickname: string; avatar: string; comment: string; timestamp: number };
type Gift = { id: string; guestId: string; username: string; nickname: string; avatar: string; giftId: string; giftName: string; giftImage: string; count: number; diamonds: number; timestamp: number };
type Supporter = { guestId: string; username: string; nickname: string; avatar: string; gifts: number; diamonds: number; likes: number };
type Leaderboard = { gifters: Supporter[]; likers: Supporter[] };
type BoardPlacement = { x: number; y: number; scale: number };
type LeaderboardLayout = Record<ViewMode, { gifters: BoardPlacement; likers: BoardPlacement }>;
type RoomPresentation = { viewMode: ViewMode; virtualGuestsEnabled: boolean; seatSpacing: number; isRaining: boolean; leaderboardLayout: LeaderboardLayout; kidnapping: KidnappingEvent };
type Snapshot = { status: Status; guests: Guest[]; comments: Comment[]; gifts: Gift[]; leaderboard?: Leaderboard; viewers: number | null; presentation?: RoomPresentation };
type Reply<T = undefined> = { ok: boolean; message?: string; data?: T };
type RainSettings = { automatic: boolean; maxDelayMinutes: number; durationSeconds: number };
type KidnappingSettings = { automatic: boolean; maxDelayMinutes: number };
type KidnappingPhase = 'idle' | 'arriving' | 'rescue' | 'saved' | 'abducted';
type KidnappingEvent = { phase: KidnappingPhase; hostages: Guest[]; deadline: number | null; rescuer?: string };

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
const MAX_AUDIO_FILE_SIZE = 100 * 1024 * 1024;
const emptyStatus: Status = { state: 'disconnected', message: 'Chưa kết nối LIVE' };
const emptyLeaderboard = (): Leaderboard => ({ gifters: [], likers: [] });
const defaultLeaderboardLayout = (): LeaderboardLayout => ({
  desktop: { gifters: { x: 74, y: 3, scale: 100 }, likers: { x: 74, y: 24, scale: 100 } },
  phone: { gifters: { x: 51, y: 9, scale: 100 }, likers: { x: 51, y: 29, scale: 100 } },
});
const defaultPresentation = (): RoomPresentation => ({
  viewMode: 'desktop', virtualGuestsEnabled: true, seatSpacing: 100, isRaining: false,
  leaderboardLayout: defaultLeaderboardLayout(),
  kidnapping: { phase: 'idle', hostages: [], deadline: null },
});

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
        <p>Người xem bước vào, chọn ghế và trò chuyện. Mỗi bình luận TikTok hoặc YouTube trở thành một câu chuyện ngay trong quán của bạn.</p>
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
  { id: 'beach-bar', icon: '🏖️', title: 'Quán nước bãi biển', description: 'Quầy nước nhiệt đới, cát vàng và sóng biển.' },
  { id: 'tea-room', icon: '♫', title: 'Phòng trà', description: 'Ánh đèn ấm, sân khấu nhỏ và nhạc nhẹ.' },
];

function Dashboard({ rooms, onOpen, onCreated }: { rooms: Room[]; onOpen: (room: Room) => void; onCreated: (room: Room) => void }) {
  const [theme, setTheme] = useState<Theme>('sidewalk-cafe');
  const [name, setName] = useState('Cà phê vỉa hè');
  const [platform, setPlatform] = useState<LivePlatform>('tiktok');
  const [tiktokUsername, setTiktokUsername] = useState('');
  const [youtubeLiveId, setYoutubeLiveId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const room = await api<Room>('/rooms', 'POST', { theme, name, platform, ...(platform === 'youtube' ? { youtubeLiveId } : { tiktokUsername }) });
      onCreated(room);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <main className="dashboard">
      <section className="dashboard-intro"><span className="eyebrow">BẢNG ĐIỀU KHIỂN</span><h1>Mở quán, bật LIVE,<br /><em>mọi người sẽ ghé.</em></h1><p>Chọn không gian cho buổi phát và kết nối phiên TikTok hoặc YouTube đang LIVE.</p></section>
      <section className="create-panel">
        <div className="section-heading"><div><span className="eyebrow">01 / KHÔNG GIAN</span><h2>Tạo phòng LIVE mới</h2></div><span className="step-badge">Không giới hạn số phòng</span></div>
        <form onSubmit={create}>
          <div className="theme-grid">
            {themeOptions.map((option) => <button key={option.id} type="button" className={`theme-card ${theme === option.id ? 'selected' : ''}`} onClick={() => { setTheme(option.id); setName(option.title); }}><span className="theme-icon">{option.icon}</span><strong>{option.title}</strong><small>{option.description}</small><span className="theme-check">{theme === option.id ? '✓' : ''}</span></button>)}
          </div>
          <div className="form-grid">
            <label>Tên phòng <input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={80} required placeholder="Đặt tên quán của bạn" /></label>
            <label>Nền tảng LIVE <select value={platform} onChange={(event) => { setPlatform(event.target.value as LivePlatform); setError(''); }} disabled={busy}><option value="tiktok">TikTok LIVE</option><option value="youtube">YouTube LIVE</option></select></label>
            {platform === 'youtube'
              ? <label>Link hoặc video ID YouTube LIVE <input value={youtubeLiveId} onChange={(event) => setYoutubeLiveId(event.target.value)} required placeholder="https://www.youtube.com/watch?v=..." /><small>Nhập link phiên đang phát công khai, có bật chat. Khách xuất hiện khi gửi bình luận.</small></label>
              : <label>TikTok username hoặc link LIVE <input value={tiktokUsername} onChange={(event) => setTiktokUsername(event.target.value)} required placeholder="@username hoặc tiktok.com/@username/live" /></label>}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-footer"><p>Phòng được lưu vào tài khoản của bạn. Kết nối bắt đầu khi bạn mở phòng.</p><button className="primary-button" disabled={busy} type="submit">{busy ? 'Đang tạo…' : 'Tạo & mở phòng →'}</button></div>
        </form>
      </section>
      <section className="saved-rooms"><div className="section-heading"><div><span className="eyebrow">02 / PHÒNG CỦA BẠN</span><h2>Quán đã tạo</h2></div><span className="step-badge">{rooms.length} phòng</span></div>
        {rooms.length === 0 ? <div className="empty-rooms">Chưa có phòng nào. Chọn một không gian ở trên để bắt đầu.</div> : <div className="room-grid">{rooms.map((room) => <button className="room-card" key={room.id} onClick={() => onOpen(room)}><span className="room-art">{themeOptions.find((option) => option.id === room.theme)?.icon}</span><span className="room-info"><strong>{room.name}</strong><small>{room.platform === 'youtube' ? `YouTube · ${room.youtubeLiveId}` : `TikTok · @${room.tiktokUsername}`} · {themeOptions.find((option) => option.id === room.theme)?.title}</small></span><span className="room-arrow">↗</span></button>)}</div>}
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
  const [leaderboard, setLeaderboard] = useState<Leaderboard>(emptyLeaderboard);
  const [viewers, setViewers] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('desktop');
  const [virtualGuestsEnabled, setVirtualGuestsEnabled] = useState(true);
  const [seatSpacing, setSeatSpacing] = useState(100);
  const [leaderboardLayout, setLeaderboardLayout] = useState<LeaderboardLayout>(defaultLeaderboardLayout);
  const [leaderboardEditing, setLeaderboardEditing] = useState(false);
  const [rainSettings, setRainSettings] = useState<RainSettings>({ automatic: true, maxDelayMinutes: 3, durationSeconds: 45 });
  const [isRaining, setIsRaining] = useState(false);
  const [kidnappingSettings, setKidnappingSettings] = useState<KidnappingSettings>({ automatic: true, maxDelayMinutes: 5 });
  const [kidnapping, setKidnapping] = useState<KidnappingEvent>({ phase: 'idle', hostages: [], deadline: null });
  const [presentationReady, setPresentationReady] = useState(false);
  const stageWindowRef = useRef<Window | null>(null);
  const nextRainTimer = useRef<number | null>(null);
  const rainEndTimer = useRef<number | null>(null);
  const rainSettingsSaveSkipped = useRef(false);
  const kidnappingSettingsSaveSkipped = useRef(false);
  const nextKidnappingTimer = useRef<number | null>(null);
  const kidnappingTimers = useRef<number[]>([]);

  const clearNextKidnapping = useCallback(() => {
    if (nextKidnappingTimer.current !== null) window.clearTimeout(nextKidnappingTimer.current);
    nextKidnappingTimer.current = null;
  }, []);

  const clearKidnappingTimers = useCallback(() => {
    kidnappingTimers.current.forEach((timer) => window.clearTimeout(timer));
    kidnappingTimers.current = [];
  }, []);

  const scheduleKidnappingTimer = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    kidnappingTimers.current.push(timer);
    return timer;
  }, []);

  const startKidnapping = useCallback(() => {
    if (!hasCafeEvents(room.theme) || guests.length < 2 || kidnapping.phase !== 'idle') return;
    clearNextKidnapping();
    clearKidnappingTimers();
    const hostages = [...guests].sort(() => Math.random() - 0.5).slice(0, 2);
    setKidnapping({ phase: 'arriving', hostages, deadline: null });
    scheduleKidnappingTimer(() => {
      setKidnapping({ phase: 'rescue', hostages, deadline: Date.now() + 20_000 });
      scheduleKidnappingTimer(() => {
        setKidnapping((current) => current.phase === 'rescue' ? { ...current, phase: 'abducted', deadline: null } : current);
      }, 20_000);
    }, 2_400);
  }, [clearKidnappingTimers, clearNextKidnapping, guests, kidnapping.phase, room.theme, scheduleKidnappingTimer]);

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
    try {
      const savedSpacing = window.localStorage.getItem(`live-room-seat-spacing-${room.id}`);
      const spacing = savedSpacing === null ? 100 : Number(savedSpacing);
      if (Number.isFinite(spacing)) setSeatSpacing(Math.min(100, Math.max(40, spacing)));
    } catch { /* dùng khoảng cách mặc định nếu trình duyệt chặn lưu trữ */ }
    const savedRain = window.localStorage.getItem(`live-room-rain-${room.id}`);
    if (savedRain) {
      try { setRainSettings((current) => ({ ...current, ...JSON.parse(savedRain) })); } catch { /* dùng cấu hình mặc định */ }
    }
    const savedKidnapping = window.localStorage.getItem(`live-room-kidnapping-${room.id}`);
    if (savedKidnapping) {
      try { setKidnappingSettings((current) => ({ ...current, ...JSON.parse(savedKidnapping) })); } catch { /* dùng cấu hình mặc định */ }
    }
    const savedLeaderboard = window.localStorage.getItem(`live-room-leaderboard-${room.id}`);
    if (savedLeaderboard) {
      try { setLeaderboardLayout(JSON.parse(savedLeaderboard) as LeaderboardLayout); } catch { /* dùng vị trí mặc định */ }
    }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(`live-room-leaderboard-${room.id}`, JSON.stringify(leaderboardLayout)); }
    catch { /* vẫn giữ bố cục trong phiên hiện tại */ }
  }, [leaderboardLayout, room.id]);

  useEffect(() => {
    if (!rainSettingsSaveSkipped.current) {
      rainSettingsSaveSkipped.current = true;
      return;
    }
    if (!hasCafeEvents(room.theme)) return;
    window.localStorage.setItem(`live-room-rain-${room.id}`, JSON.stringify(rainSettings));
  }, [rainSettings, room.id, room.theme]);

  useEffect(() => {
    if (!kidnappingSettingsSaveSkipped.current) {
      kidnappingSettingsSaveSkipped.current = true;
      return;
    }
    if (!hasCafeEvents(room.theme)) return;
    window.localStorage.setItem(`live-room-kidnapping-${room.id}`, JSON.stringify(kidnappingSettings));
  }, [kidnappingSettings, room.id, room.theme]);

  useEffect(() => {
    clearNextRain();
    if (!hasCafeEvents(room.theme) || !rainSettings.automatic || isRaining) return clearNextRain;
    const maximum = rainSettings.maxDelayMinutes * 60 * 1000;
    const minimum = Math.min(15_000, maximum);
    const delay = minimum + Math.random() * Math.max(0, maximum - minimum);
    nextRainTimer.current = window.setTimeout(startRain, delay);
    return clearNextRain;
  }, [clearNextRain, isRaining, rainSettings.automatic, rainSettings.maxDelayMinutes, room.theme, startRain]);

  useEffect(() => {
    clearNextKidnapping();
    if (!hasCafeEvents(room.theme) || !kidnappingSettings.automatic || kidnapping.phase !== 'idle' || guests.length < 2) return clearNextKidnapping;
    const maximum = kidnappingSettings.maxDelayMinutes * 60 * 1000;
    const minimum = Math.min(15_000, maximum);
    const delay = minimum + Math.random() * Math.max(0, maximum - minimum);
    nextKidnappingTimer.current = window.setTimeout(() => {
      nextKidnappingTimer.current = null;
      startKidnapping();
    }, delay);
    return clearNextKidnapping;
  }, [clearNextKidnapping, guests.length, kidnapping.phase, kidnappingSettings.automatic, kidnappingSettings.maxDelayMinutes, room.theme, startKidnapping]);

  useEffect(() => clearRainTimers, [clearRainTimers]);
  useEffect(() => () => {
    clearNextKidnapping();
    clearKidnappingTimers();
  }, [clearKidnappingTimers, clearNextKidnapping]);

  useEffect(() => {
    if (kidnapping.phase !== 'abducted') return;
    const timer = scheduleKidnappingTimer(() => {
      const returnedAt = Date.now();
      const returnComments = kidnapping.hostages.map((hostage, index): Comment => ({
        id: `kidnap-return-${hostage.id}-${returnedAt}`,
        guestId: hostage.id,
        username: hostage.username,
        nickname: hostage.nickname,
        avatar: hostage.avatar,
        comment: 'tại sao mọi người không cứu tôi',
        timestamp: returnedAt + index,
      }));
      setComments((current) => [...returnComments, ...current].slice(0, 100));
      setKidnapping({ phase: 'idle', hostages: [], deadline: null });
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [kidnapping.phase, kidnapping.hostages, scheduleKidnappingTimer]);

  useEffect(() => {
    if (kidnapping.phase !== 'rescue' || comments.length === 0) return;
    if (!kidnapping.deadline) return;
    const rescueWindowStart = kidnapping.deadline - 20_000;
    const rescueComment = comments.find((comment) => {
      if (comment.timestamp < rescueWindowStart || comment.timestamp > kidnapping.deadline!) return false;
      const normalized = comment.comment.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return normalized.split(/[^a-z0-9]+/).includes('giup');
    });
    if (!rescueComment) return;
    clearKidnappingTimers();
    setKidnapping((current) => ({ ...current, phase: 'saved', deadline: null, rescuer: rescueComment.nickname }));
    scheduleKidnappingTimer(() => setKidnapping({ phase: 'idle', hostages: [], deadline: null }), 3_800);
  }, [clearKidnappingTimers, comments, kidnapping.deadline, kidnapping.phase, scheduleKidnappingTimer]);

  useEffect(() => {
    const connection = io(backendUrl, { withCredentials: true });
    connection.on('connect', () => {
      setPresentationReady(false);
      connection.emit('room:join', { roomId: room.id }, (reply: Reply<Snapshot>) => {
        if (!reply.ok || !reply.data) { setError(reply.message ?? 'Không vào được phòng.'); return; }
        setStatus(reply.data.status);
        setGuests(reply.data.guests);
        setComments(reply.data.comments);
        setGifts(reply.data.gifts ?? []);
        setLeaderboard(reply.data.leaderboard ?? emptyLeaderboard());
        setViewers(reply.data.viewers);
        if (reply.data.presentation) {
          setViewMode(reply.data.presentation.viewMode);
          setVirtualGuestsEnabled(reply.data.presentation.virtualGuestsEnabled);
          setSeatSpacing(reply.data.presentation.seatSpacing);
          setIsRaining(reply.data.presentation.isRaining);
          setLeaderboardLayout(reply.data.presentation.leaderboardLayout ?? defaultLeaderboardLayout());
          setKidnapping(reply.data.presentation.kidnapping);
        }
        setPresentationReady(true);
        if (reply.data.status.state === 'disconnected') {
          connection.emit('live:connect', { roomId: room.id }, (result: Reply) => {
            if (!result.ok) setError(result.message ?? 'Kết nối LIVE thất bại.');
          });
        }
      });
    });
    connection.on('live:status', (next: Status) => setStatus(next));
    connection.on('live:guest-joined', (guest: Guest) => setGuests((current) => [...current.filter((item) => item.id !== guest.id), guest]));
    connection.on('live:guest-left', ({ id }: { id: string }) => setGuests((current) => current.filter((guest) => guest.id !== id)));
    connection.on('live:comment', (comment: Comment) => setComments((current) => [comment, ...current].slice(0, 100)));
    connection.on('live:gift', (gift: Gift) => setGifts((current) => [gift, ...current].slice(0, 20)));
    connection.on('live:leaderboard', (next: Leaderboard) => setLeaderboard(next));
    connection.on('live:stats', ({ viewers: count }: { viewers: number | null }) => setViewers(count));
    connection.on('live:reset', () => {
      clearNextKidnapping();
      clearKidnappingTimers();
      setKidnapping({ phase: 'idle', hostages: [], deadline: null });
      setGuests([]);
      setComments([]);
      setGifts([]);
      setLeaderboard(emptyLeaderboard());
      setViewers(null);
    });
    connection.on('connect_error', () => setError('Không thể kết nối backend.'));
    setSocket(connection);
    return () => { connection.emit('room:leave', { roomId: room.id }); connection.disconnect(); };
  }, [clearKidnappingTimers, clearNextKidnapping, room.id]);

  useEffect(() => {
    if (!socket || !presentationReady) return;
    const timer = window.setTimeout(() => {
      const presentation: RoomPresentation = { viewMode, virtualGuestsEnabled, seatSpacing, isRaining, leaderboardLayout, kidnapping };
      socket.emit('room:presentation:update', { roomId: room.id, presentation }, (reply: Reply) => {
        if (!reply.ok) setError(reply.message ?? 'Không đồng bộ được màn hình phát.');
      });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [isRaining, kidnapping, leaderboardLayout, presentationReady, room.id, seatSpacing, socket, viewMode, virtualGuestsEnabled]);

  useEffect(() => () => {
    if (stageWindowRef.current && !stageWindowRef.current.closed) stageWindowRef.current.close();
  }, []);

  function reconnect() {
    setError('');
    socket?.emit('live:connect', { roomId: room.id }, (reply: Reply) => {
      if (!reply.ok) setError(reply.message ?? 'Kết nối LIVE thất bại.');
    });
  }

  function disconnect() { socket?.emit('live:disconnect', { roomId: room.id }); }

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    window.localStorage.setItem('live-room-view-mode', mode);
  }

  function changeSeatSpacing(spacing: number) {
    setSeatSpacing(spacing);
    try { window.localStorage.setItem(`live-room-seat-spacing-${room.id}`, String(spacing)); }
    catch { /* vẫn áp dụng khoảng cách cho phiên hiện tại */ }
  }

  function changeBoardPlacement(board: 'gifters' | 'likers', placement: BoardPlacement) {
    const approximateWidth = viewMode === 'phone' ? 46 : 23;
    const maximumX = Math.max(0, 100 - approximateWidth * placement.scale / 100);
    const bounded = { ...placement, x: Math.min(maximumX, Math.max(0, placement.x)), y: Math.min(92, Math.max(0, placement.y)) };
    setLeaderboardLayout((current) => ({
      ...current,
      [viewMode]: { ...current[viewMode], [board]: bounded },
    }));
  }

  function resetLeaderboardLayout() {
    setLeaderboardLayout((current) => ({ ...current, [viewMode]: defaultLeaderboardLayout()[viewMode] }));
  }

  const editableBoards: Array<'gifters' | 'likers'> = room.platform === 'youtube' ? ['gifters'] : ['gifters', 'likers'];

  function openPresentationWindow() {
    const width = window.screen.availWidth;
    const height = window.screen.availHeight;
    const popup = window.open(
      `/stage/${encodeURIComponent(room.id)}`,
      `live-stage-${room.id}`,
      `popup=yes,left=0,top=0,width=${width},height=${height}`,
    );
    if (!popup) {
      setError('Trình duyệt đã chặn cửa sổ màn hình phát. Hãy cho phép popup cho trang này rồi thử lại.');
      return;
    }
    stageWindowRef.current = popup;
    popup.focus();
  }

  return (
    <main className="room-page">
      <div className="room-titlebar"><div><button className="back-button" onClick={onBack}>← Tất cả phòng</button><span className="eyebrow">{themeOptions.find((option) => option.id === room.theme)?.title.toLocaleUpperCase('vi-VN')} / {room.platform === 'youtube' ? `YouTube · ${room.youtubeLiveId}` : `TikTok · @${room.tiktokUsername}`}</span><h1>{room.name}</h1></div><div className="room-actions"><div className="view-mode-switch" role="group" aria-label="Chế độ hiển thị"><button type="button" className={viewMode === 'phone' ? 'active' : ''} onClick={() => changeViewMode('phone')} aria-pressed={viewMode === 'phone'}>▯ Điện thoại</button><button type="button" className={viewMode === 'desktop' ? 'active' : ''} onClick={() => changeViewMode('desktop')} aria-pressed={viewMode === 'desktop'}>▭ Desktop</button></div><div className="room-controls"><span className={`live-pill ${status.state}`}><span />{status.state === 'connected' ? 'ĐANG LIVE' : status.state === 'connecting' ? 'ĐANG KẾT NỐI' : 'CHƯA LIVE'}</span>{status.state === 'connected' ? <button className="secondary-button" onClick={disconnect}>Ngắt kết nối</button> : <button className="primary-button" disabled={status.state === 'connecting'} onClick={reconnect}>Kết nối lại</button>}</div></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <AudioManager room={room} onError={setError} />
      <section className="weather-controls" aria-label="Bố trí chỗ ngồi">
        <div className="weather-heading"><span className="weather-icon" aria-hidden="true">🪑</span><div><span className="eyebrow">CHỖ NGỒI</span><strong>Điều chỉnh khoảng cách giữa các khách</strong></div></div>
        <label className="seat-spacing-control" htmlFor="seat-spacing">Khoảng cách
          <input id="seat-spacing" type="range" min="40" max="100" step="5" value={seatSpacing} onChange={(event) => changeSeatSpacing(Number(event.target.value))} aria-valuetext={`${seatSpacing}% khoảng cách ban đầu`} />
          <output htmlFor="seat-spacing">{seatSpacing}%</output>
          <span className="muted">Kéo sang trái để ngồi gần hơn</span>
        </label>
        <button type="button" className="secondary-button" onClick={() => changeSeatSpacing(100)}>Mặc định</button>
      </section>
      <section className={`leaderboard-controls ${leaderboardEditing ? 'editing' : ''}`} aria-label="Điều chỉnh bảng top">
        <div className="weather-heading"><span className="weather-icon" aria-hidden="true">🏆</span><div><span className="eyebrow">BẢNG TOP</span><strong>{leaderboardEditing ? 'Kéo từng bảng ngay trên background' : `Bố cục riêng cho ${viewMode === 'phone' ? 'điện thoại' : 'desktop'}`}</strong></div></div>
        {editableBoards.map((board) => <label className="leaderboard-size" key={board}>{board === 'gifters' ? '🎁 Quà' : '♥ Tim'}
          <input type="range" min="50" max="180" step="5" value={leaderboardLayout[viewMode][board].scale} onChange={(event) => changeBoardPlacement(board, { ...leaderboardLayout[viewMode][board], scale: Number(event.target.value) })} />
          <output>{leaderboardLayout[viewMode][board].scale}%</output>
        </label>)}
        <button type="button" className={`secondary-button ${leaderboardEditing ? 'active' : ''}`} onClick={() => setLeaderboardEditing((current) => !current)}>{leaderboardEditing ? '✓ Xong kéo thả' : '✥ Kéo thả vị trí'}</button>
        <button type="button" className="secondary-button" onClick={resetLeaderboardLayout}>Đặt lại</button>
      </section>
      <section className="weather-controls" aria-label="Khách ảo trong quán">
        <div className="weather-heading"><span className="weather-icon" aria-hidden="true">☕</span><div><span className="eyebrow">KHÁCH ẢO</span><strong>10 khách trò chuyện tự động trong quán</strong></div></div>
        <label className="weather-toggle"><input type="checkbox" checked={virtualGuestsEnabled} onChange={(event) => setVirtualGuestsEnabled(event.target.checked)} /><span /> Bật khách ảo</label>
      </section>
      {hasCafeEvents(room.theme) && <section className="weather-controls" aria-label="Điều khiển thời tiết">
        <div className="weather-heading"><span className={`weather-icon ${isRaining ? 'raining' : ''}`}>{isRaining ? '🌧' : '☁'}</span><div><span className="eyebrow">THỜI TIẾT QUÁN</span><strong>{isRaining ? 'Đang mưa · bạt đã được kéo ra' : rainSettings.automatic ? `Mưa ngẫu nhiên trong tối đa ${rainSettings.maxDelayMinutes} phút` : 'Mưa tự động đang tắt'}</strong></div></div>
        <label className="weather-toggle"><input type="checkbox" checked={rainSettings.automatic} onChange={(event) => setRainSettings((current) => ({ ...current, automatic: event.target.checked }))} /><span /> Mưa tự động</label>
        <label>Tối đa <input type="number" min="0.25" max="30" step="0.25" value={rainSettings.maxDelayMinutes} onChange={(event) => setRainSettings((current) => ({ ...current, maxDelayMinutes: Math.min(30, Math.max(0.25, Number(event.target.value) || 3)) }))} /> phút</label>
        <label>Kéo dài <input type="number" min="10" max="300" step="5" value={rainSettings.durationSeconds} onChange={(event) => setRainSettings((current) => ({ ...current, durationSeconds: Math.min(300, Math.max(10, Number(event.target.value) || 45)) }))} /> giây</label>
        <button type="button" className="secondary-button weather-button" onClick={() => isRaining ? stopRain() : startRain()}>{isRaining ? 'Tạnh mưa' : 'Cho mưa ngay'}</button>
      </section>}
      {hasCafeEvents(room.theme) && <section className="kidnap-controls" aria-label="Điều khiển sự kiện bắt cóc">
        <div className="kidnap-control-copy"><span className="kidnap-control-icon">🚨</span><div><span className="eyebrow">SỰ KIỆN QUÁN</span><strong>{kidnapping.phase === 'idle' ? (guests.length < 2 ? 'Cần ít nhất 2 khách để bắt đầu' : 'Bắt cóc 2 khách ngẫu nhiên') : 'Sự kiện bắt cóc đang diễn ra'}</strong></div></div>
        <label className="weather-toggle"><input type="checkbox" checked={kidnappingSettings.automatic} onChange={(event) => setKidnappingSettings((current) => ({ ...current, automatic: event.target.checked }))} /><span /> Tự động</label>
        <label>Tối đa <input type="number" min="0.25" max="30" step="0.25" value={kidnappingSettings.maxDelayMinutes} onChange={(event) => setKidnappingSettings((current) => ({ ...current, maxDelayMinutes: Math.min(30, Math.max(0.25, Number(event.target.value) || 5)) }))} /> phút</label>
        <button type="button" className="danger-button" disabled={kidnapping.phase !== 'idle' || guests.length < 2} onClick={startKidnapping}>{room.theme === 'beach-bar' ? '🚤' : '🚐'} Bắt cóc ngay</button>
      </section>}
      <div className={`room-layout ${viewMode}-view`}>
        <div className="scene-column"><div className="stream-stage"><Scene theme={room.theme} guests={guests} comments={comments} gifts={gifts} leaderboard={leaderboard} leaderboardLayout={leaderboardLayout} leaderboardEditing={leaderboardEditing} onLeaderboardPlacementChange={changeBoardPlacement} viewMode={viewMode} isRaining={isRaining} kidnapping={kidnapping} showYouTubeJoinNotice={room.platform === 'youtube'} virtualGuestsEnabled={virtualGuestsEnabled} seatSpacing={seatSpacing} /></div><div className="scene-footer"><span><i className="status-dot" />{status.message}</span><span>{room.platform === 'youtube' ? 'YouTube LIVE' : `${viewers === null ? '—' : viewers.toLocaleString('vi-VN')} người xem TikTok`} · {guests.length} khách LIVE{virtualGuestsEnabled ? ' · 10 khách ảo' : ''}</span><button type="button" className="fullscreen-button" onClick={openPresentationWindow}>⛶ Mở màn hình LIVE</button></div></div>
        <aside className="chat-panel"><div className="chat-head"><div><span className="eyebrow">CUỘC TRÒ CHUYỆN</span><h2>Bình luận LIVE</h2></div><span className="chat-count">{comments.length}</span></div><div className="chat-list">{comments.length ? comments.map((comment) => <div className="chat-line" key={comment.id}><Avatar avatar={comment.avatar} name={comment.nickname} /><div><div className="chat-meta"><strong>{comment.nickname}</strong><time>{new Date(comment.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{comment.comment}</p></div></div>) : <div className="chat-empty"><span>💬</span><strong>Chưa có lời nhắn</strong><p>Khi có bình luận, bong bóng chat sẽ hiện trên nhân vật trong quán.</p></div>}</div><div className="chat-foot">Tin nhắn được lấy trực tiếp từ {room.platform === 'youtube' ? 'YouTube' : 'TikTok'} LIVE</div></aside>
      </div>
    </main>
  );
}

export function LiveStageViewer({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [leaderboard, setLeaderboard] = useState<Leaderboard>(emptyLeaderboard);
  const [presentation, setPresentation] = useState<RoomPresentation>(defaultPresentation);
  const [error, setError] = useState('');
  const [needsFullscreen, setNeedsFullscreen] = useState(false);

  const enterFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      setNeedsFullscreen(false);
    } catch {
      setNeedsFullscreen(true);
    }
  }, []);

  useEffect(() => {
    document.body.classList.add('presentation-body');
    document.title = 'Màn hình LIVE';
    const fullscreenChanged = () => setNeedsFullscreen(!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    try {
      if (window.opener) {
        window.moveTo(0, 0);
        window.resizeTo(window.screen.availWidth, window.screen.availHeight);
      }
    } catch { /* trình duyệt có thể không cho phép thay đổi kích thước popup */ }
    const timer = window.setTimeout(() => { void enterFullscreen(); }, 100);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      document.body.classList.remove('presentation-body');
    };
  }, [enterFullscreen]);

  useEffect(() => {
    api<Room>(`/rooms/${encodeURIComponent(roomId)}`).then((data) => {
      setRoom(data);
      document.title = `${data.name} · Màn hình LIVE`;
    }).catch((cause) => setError((cause as Error).message));
  }, [roomId]);

  useEffect(() => {
    const connection = io(backendUrl, { withCredentials: true });
    connection.on('connect', () => {
      connection.emit('room:join', { roomId }, (reply: Reply<Snapshot>) => {
        if (!reply.ok || !reply.data) {
          setError(reply.message ?? 'Không mở được màn hình phát.');
          return;
        }
        setGuests(reply.data.guests);
        setComments(reply.data.comments);
        setGifts(reply.data.gifts ?? []);
        setLeaderboard(reply.data.leaderboard ?? emptyLeaderboard());
        if (reply.data.presentation) setPresentation(reply.data.presentation);
      });
    });
    connection.on('room:presentation', (next: RoomPresentation) => setPresentation(next));
    connection.on('live:guest-joined', (guest: Guest) => setGuests((current) => [...current.filter((item) => item.id !== guest.id), guest]));
    connection.on('live:guest-left', ({ id }: { id: string }) => setGuests((current) => current.filter((guest) => guest.id !== id)));
    connection.on('live:comment', (comment: Comment) => setComments((current) => [comment, ...current].slice(0, 100)));
    connection.on('live:gift', (gift: Gift) => setGifts((current) => [gift, ...current].slice(0, 20)));
    connection.on('live:leaderboard', (next: Leaderboard) => setLeaderboard(next));
    connection.on('live:reset', () => { setGuests([]); setComments([]); setGifts([]); setLeaderboard(emptyLeaderboard()); });
    connection.on('connect_error', () => setError('Mất kết nối với máy chủ.'));
    return () => { connection.emit('room:leave', { roomId }); connection.disconnect(); };
  }, [roomId]);

  if (error) return <main className="presentation-message" role="alert"><strong>Không thể mở màn hình LIVE</strong><span>{error}</span></main>;
  if (!room) return <main className="presentation-message">Đang chuẩn bị màn hình LIVE…</main>;

  return <main className={`presentation-page ${presentation.viewMode}-view`}>
    <div className="stream-stage presentation-stream-stage">
      <Scene theme={room.theme} guests={guests} comments={comments} gifts={gifts} leaderboard={leaderboard} leaderboardLayout={presentation.leaderboardLayout ?? defaultLeaderboardLayout()} viewMode={presentation.viewMode} isRaining={presentation.isRaining} kidnapping={presentation.kidnapping} showYouTubeJoinNotice={room.platform === 'youtube'} virtualGuestsEnabled={presentation.virtualGuestsEnabled} seatSpacing={presentation.seatSpacing} />
    </div>
    {needsFullscreen && <button type="button" className="enter-fullscreen-button" onClick={() => void enterFullscreen()}><span>⛶</span><strong>Vào toàn màn hình</strong><small>Trình duyệt cần bạn xác nhận một lần</small></button>}
  </main>;
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

function getSeatPosition(seat: number, viewMode: ViewMode, seatSpacing: number, theme: Theme) {
  const columns = viewMode === 'phone' ? 10 : 20;
  const rows = MAX_SCENE_GUESTS / columns;
  const slot = ((seat % MAX_SCENE_GUESTS) * 73 + 19) % MAX_SCENE_GUESTS;
  const column = slot % columns;
  const row = Math.floor(slot / columns);
  const leftMin = viewMode === 'phone' ? 7 : 5;
  const leftMax = viewMode === 'phone' ? 93 : 95;
  // Keep the bottom of every character above the curb. The desktop guest box
  // extends ~12% below its center; on mobile it extends ~5.5% below.
  const topMin = theme === 'beach-bar' ? (viewMode === 'phone' ? 40 : 43) : (viewMode === 'phone' ? 48 : 54);
  const topMax = theme === 'beach-bar' ? (viewMode === 'phone' ? 66 : 55) : (viewMode === 'phone' ? 79 : 70);
  // Compress seat coordinates around the seating area's center, preserving
  // character size, seat order, and the original safe bounds in both views.
  const scale = seatSpacing / 100;
  return {
    left: (leftMin + leftMax) / 2 + ((column + 0.5) / columns - 0.5) * (leftMax - leftMin) * scale,
    top: (topMin + topMax) / 2 + ((row + 0.5) / rows - 0.5) * (topMax - topMin) * scale,
    depth: row,
  };
}

function getGuestSize(viewMode: ViewMode, theme: Theme) {
  // Keep guests in the same coordinate system as the scene instead of using
  // viewport-independent pixels. Both dimensions must be explicit because
  // every child inside this absolutely positioned box is also absolute;
  // `height: auto` would therefore collapse the character box to zero. These
  // sizes stay constant regardless of crowd density, so a busy room overlaps
  // characters instead of shrinking them.
  return {
    width: viewMode === 'phone' ? '14%' : '10%',
    height: theme === 'beach-bar' ? (viewMode === 'phone' ? '8.7%' : '20%') : (viewMode === 'phone' ? '10.75%' : '24.35%'),
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

const beachGuestStyles = [
  'bikini xanh ngọc', 'bikini san hô và khăn sarong', 'đồ bơi liền mảnh và mũ rộng vành',
  'váy hoa mùa hè', 'áo khoác crochet bohemian', 'sơ mi Hawaii xanh',
  'áo mở và quần lướt sóng', 'sơ mi linen và mũ cói', 'đồ bơi thể thao rashguard',
  'áo ba lỗ nhiệt đới và kính râm',
].map((label, atlasIndex) => ({ src: '/characters/beach-atlas.png', label, atlasIndex }));

type CharacterStyle = { src: string; label: string; atlasIndex?: number };

function CharacterSprite({ character, label }: { character: CharacterStyle; label: string }) {
  const clipId = useId();
  if (character.atlasIndex === undefined) return <img src={character.src} alt={label} />;
  // Crop the atlas at render time, preserving the original transparent bitmap.
  const columns = [0, 334, 635, 942, 1244, 1536];
  const rows = [0, 344, 680, 1024];
  const column = character.atlasIndex % 5;
  const row = Math.floor(character.atlasIndex / 5);
  return <svg className="beach-character" role="img" aria-label={label} viewBox={`${columns[column]} ${rows[row]} ${columns[column + 1] - columns[column]} ${rows[row + 1] - rows[row]}`} preserveAspectRatio="xMidYMax meet">
    <defs><clipPath id={clipId}><rect x={columns[column]} y={rows[row]} width={columns[column + 1] - columns[column]} height={rows[row + 1] - rows[row]} /></clipPath></defs>
    <image href={character.src} width="1536" height="1024" clipPath={`url(#${clipId})`} />
  </svg>;
}

function getGuestStyle(guest: Guest, theme: Theme): CharacterStyle {
  const styles = theme === 'beach-bar' ? beachGuestStyles : guestStyles;
  // Ten demo guests showcase all ten outfits; LIVE guests keep a stable style.
  if (theme === 'beach-bar' && guest.isVirtual) return styles[Number(guest.id.split(':')[1]) % styles.length];
  const key = `${guest.id}:${guest.joinedAt}`;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return styles[(hash >>> 0) % styles.length];
}

const staffDialogues = [
  { speaker: 'owner', name: 'Cô chủ Hương', message: 'Lan ơi, mang cà phê sữa đá ra bàn mới nhé!' },
  { speaker: 'maid', name: 'Lan', message: 'Dạ cô, cà phê phin vừa nhỏ xong đây ạ!' },
  { speaker: 'executive', name: 'Minh', message: 'Bàn bên kia cần thêm trà đá, để tôi lo.' },
  { speaker: 'owner', name: 'Cô chủ Hương', message: 'Nhớ kê ghế gọn cho khách mới vào nha.' },
  { speaker: 'maid', name: 'Lan', message: 'Em mời cả nhà dùng cà phê, ngồi sát vào cho vui!' },
  { speaker: 'executive', name: 'Minh', message: 'Cà phê đen ít đường của anh đây. Chúc anh ngon miệng.' },
] as const;

const beachStaffDialogues = [
  { speaker: 'owner', name: 'Cô chủ Hương', message: 'Lan ơi, mang nước dừa mát ra cho khách nhé!' },
  { speaker: 'maid', name: 'Lan', message: 'Dạ, nước dừa và nước ép thơm sẵn sàng đây ạ!' },
  { speaker: 'executive', name: 'Minh', message: 'Mời cả nhà uống nước, ngắm sóng biển nhé!' },
  { speaker: 'owner', name: 'Cô chủ Hương', message: 'Nhớ xếp ghế trên cát cho khách mới nha.' },
  { speaker: 'maid', name: 'Lan', message: 'Sinh tố xoài mát lạnh của chị đây ạ!' },
  { speaker: 'executive', name: 'Minh', message: 'Gió biển mát quá, cả nhà ngồi chơi thêm nhé!' },
] as const;

const virtualGuests: Guest[] = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khoa', 'Linh', 'Nam', 'Thảo', 'Vy'].map((name, index) => ({
  id: `virtual:${index}`, username: `khach_ao_${index + 1}`, nickname: name,
  // Half slots sit between LIVE seats, keeping all ten guests scattered in the
  // same area without moving anyone when real viewers arrive, even at capacity.
  avatar: '', seat: index * 19 + 0.5, joinedAt: 0, isVirtual: true,
}));

// Keep each exchange together so replies follow the same topic.
const virtualConversations = [
  ['Nãy tính ghé mười phút thôi á.', 'Rồi giờ ngồi bao lâu rồi?', 'Thôi đừng hỏi giờ, đang vui mà.'],
  ['Ủa mình để điện thoại đâu rồi ta?', 'Cái đang cầm trên tay đó hả?', 'À… coi như chưa nghe gì nha.'],
  ['Tối nay ăn gì đây?', 'Câu này khó hơn đi làm nữa.', 'Hay cứ quán quen?', 'Nãy giờ suy nghĩ cuối cùng vẫn vậy ha.'],
  ['Hôm qua thức khuya, giờ hơi đơ rồi.', 'Lại xem thêm đúng một tập chứ gì?', 'Ừ, mà một tập hơi nhiều lần.'],
  ['Cho mình ngồi ké chỗ này nha.', 'Ngồi đi, đang tám chuyện linh tinh thôi.', 'Vậy đúng sở trường rồi.'],
  ['Định cuối tuần dọn phòng.', 'Nghe quen quen, tuần trước cũng nói vậy.', 'Thì mình đang lên kế hoạch kỹ mà.'],
  ['Có ai thấy đói không?', 'Vừa ăn xong mà?', 'Đó là chuyện của nửa tiếng trước.'],
  ['Bữa nay đường đông ghê.', 'Ừ, mình đứng đèn đỏ mấy lượt mới qua.', 'Tới đây ngồi được là không muốn về nữa.'],
  ['Chụp giùm mình tấm hình đi.', 'Rồi, cười tự nhiên coi.', 'Nói vậy tự nhiên quên cách cười luôn.'],
  ['Mình mới mua cuốn sách hay lắm.', 'Đọc tới đâu rồi?', 'Tới đoạn bóc bọc nilon.'],
  ['Sáng nay báo thức reo mà tưởng trong mơ.', 'Rồi có dậy không?', 'Có, dậy tắt báo thức.'],
  ['Ngồi đây gió mát ha.', 'Ừ, để điện thoại xuống chút cũng dễ chịu.', 'Lâu lâu ngồi không vậy mà thích.'],
  ['Nãy thấy con mèo nằm ngủ ngoài cửa.', 'Nó chọn chỗ mát giỏi thật.', 'Ước gì chiều nay mình cũng được ngủ như nó.'],
  ['Mai mình thử dậy sớm đi bộ.', 'Mấy giờ?', 'Để coi mai thức lúc nào đã.'],
  ['Ê, ly của ai bên này vậy?', 'Của mình á, đưa giùm với.', 'Đây, tưởng ai bỏ quên.'],
  ['Lâu rồi mới ngồi nói chuyện thoải mái vầy.', 'Ừ, mọi bữa cứ vội vội vàng vàng.', 'Hôm nay ngồi thêm chút đi.'],
];

function useVirtualConversation(enabled: boolean) {
  const [comment, setComment] = useState<Comment | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let timer: number;
    let remaining: number[] = [];
    let previousTopic = -1;
    let lines: string[] = [];
    let speakers: Guest[] = [];
    let lineIndex = 0;
    let sequence = 0;
    const speak = () => {
      if (lineIndex >= lines.length) {
        if (!remaining.length) remaining = virtualConversations.map((_, index) => index);
        const choices = remaining.filter((index) => index !== previousTopic);
        const topic = choices[Math.floor(Math.random() * choices.length)];
        remaining = remaining.filter((index) => index !== topic);
        previousTopic = topic;
        lines = virtualConversations[topic];
        const first = Math.floor(Math.random() * virtualGuests.length);
        const second = (first + 1 + Math.floor(Math.random() * (virtualGuests.length - 1))) % virtualGuests.length;
        speakers = [virtualGuests[first], virtualGuests[second]];
        lineIndex = 0;
      }
      const speaker = speakers[lineIndex % speakers.length];
      const message = lines[lineIndex++];
      setComment({
        id: `virtual-chat:${++sequence}`, guestId: speaker.id,
        username: speaker.username, nickname: speaker.nickname, avatar: '',
        comment: message, timestamp: Date.now(),
      });
      // Brief pauses between replies; a longer quiet moment between topics.
      const delay = lineIndex === lines.length
        ? 12000 + Math.random() * 10000
        : 3500 + message.length * 25 + Math.random() * 1800;
      timer = window.setTimeout(speak, delay);
    };
    setComment(null);
    timer = window.setTimeout(speak, 1500 + Math.random() * 2500);
    return () => window.clearTimeout(timer);
  }, [enabled]);
  return enabled ? comment : null;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function LeaderboardGroup({ icon, title, entries, metric, editing }: { icon: string; title: string; entries: Supporter[]; metric: 'gift' | 'like'; editing: boolean }) {
  return <section className="support-leaderboard-group">
    <h3><span aria-hidden="true">{icon}</span>{title}</h3>
    {entries.length > 0 ? <ol>
      {entries.map((entry, index) => <li key={entry.guestId}>
        <span className={`support-rank rank-${index + 1}`}>{index + 1}</span>
        <Avatar avatar={entry.avatar} name={entry.nickname} />
        <strong>{entry.nickname}</strong>
        <span className="support-score">{metric === 'like'
          ? `${compactNumber(entry.likes)} ♥`
          : entry.diamonds > 0 ? `${compactNumber(entry.diamonds)} 💎` : `${compactNumber(entry.gifts)} 🎁`}</span>
      </li>)}
    </ol> : editing ? <div className="support-empty">✥ Kéo bảng này</div> : null}
  </section>;
}

function PositionedLeaderboard({ board, placement, entries, editing, onChange }: { board: 'gifters' | 'likers'; placement: BoardPlacement; entries: Supporter[]; editing: boolean; onChange?: (board: 'gifters' | 'likers', placement: BoardPlacement) => void }) {
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number; width: number; height: number; maxX: number; maxY: number } | null>(null);
  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!editing || !onChange) return;
    const scene = event.currentTarget.closest('.scene');
    if (!(scene instanceof HTMLElement)) return;
    const bounds = scene.getBoundingClientRect();
    const boardBounds = event.currentTarget.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      x: placement.x, y: placement.y, width: bounds.width, height: bounds.height,
      maxX: Math.max(0, 100 - boardBounds.width / bounds.width * 100),
      maxY: Math.max(0, 100 - boardBounds.height / bounds.height * 100),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const origin = drag.current;
    if (!origin || origin.pointerId !== event.pointerId || !onChange) return;
    onChange(board, {
      ...placement,
      x: Math.min(origin.maxX, Math.max(0, origin.x + ((event.clientX - origin.clientX) / origin.width) * 100)),
      y: Math.min(origin.maxY, Math.max(0, origin.y + ((event.clientY - origin.clientY) / origin.height) * 100)),
    });
  }
  function stopDrag(event: ReactPointerEvent<HTMLElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }
  const title = board === 'gifters' ? 'TOP TẶNG QUÀ' : 'TOP THẢ TIM';
  return <aside
    className={`support-leaderboard ${editing ? 'is-editing' : ''}`}
    style={{ left: `${placement.x}%`, top: `${placement.y}%`, '--board-scale': placement.scale / 100 } as CSSProperties}
    aria-label={title}
    onPointerDown={startDrag}
    onPointerMove={moveDrag}
    onPointerUp={stopDrag}
    onPointerCancel={stopDrag}
  >
    <LeaderboardGroup icon={board === 'gifters' ? '🎁' : '♥'} title={title} entries={entries} metric={board === 'gifters' ? 'gift' : 'like'} editing={editing} />
  </aside>;
}

function LiveLeaderboard({ leaderboard, layout, viewMode, editing, allowLikes, onChange }: { leaderboard: Leaderboard; layout: LeaderboardLayout; viewMode: ViewMode; editing: boolean; allowLikes: boolean; onChange?: (board: 'gifters' | 'likers', placement: BoardPlacement) => void }) {
  return <>
    {(leaderboard.gifters.length > 0 || editing) && <PositionedLeaderboard board="gifters" placement={layout[viewMode].gifters} entries={leaderboard.gifters} editing={editing} onChange={onChange} />}
    {allowLikes && (leaderboard.likers.length > 0 || editing) && <PositionedLeaderboard board="likers" placement={layout[viewMode].likers} entries={leaderboard.likers} editing={editing} onChange={onChange} />}
  </>;
}

function Scene({ theme, guests, comments, gifts, leaderboard, leaderboardLayout, leaderboardEditing = false, onLeaderboardPlacementChange, viewMode, isRaining, kidnapping, showYouTubeJoinNotice, virtualGuestsEnabled, seatSpacing }: { theme: Theme; guests: Guest[]; comments: Comment[]; gifts: Gift[]; leaderboard: Leaderboard; leaderboardLayout: LeaderboardLayout; leaderboardEditing?: boolean; onLeaderboardPlacementChange?: (board: 'gifters' | 'likers', placement: BoardPlacement) => void; viewMode: ViewMode; isRaining: boolean; kidnapping: KidnappingEvent; showYouTubeJoinNotice: boolean; virtualGuestsEnabled: boolean; seatSpacing: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const dialogues = theme === 'beach-bar' ? beachStaffDialogues : staffDialogues;
  const dialogue = dialogues[Math.floor(now / 6000) % dialogues.length];
  const showStaffBubble = now % 6000 < 5000;
  const sceneGuests = virtualGuestsEnabled ? [...guests, ...virtualGuests] : guests;
  const virtualComment = useVirtualConversation(virtualGuestsEnabled && kidnapping.phase === 'idle');
  const crowdDensity = getCrowdDensity(sceneGuests.length);
  const guestSize = getGuestSize(viewMode, theme);
  const latestGift = gifts.find((gift) => now - gift.timestamp < 12000);
  const hostageIds = new Set(kidnapping.hostages.map((hostage) => hostage.id));
  const hiddenHostages = kidnapping.phase === 'rescue' || kidnapping.phase === 'abducted';
  const secondsLeft = kidnapping.deadline ? Math.max(0, Math.ceil((kidnapping.deadline - now) / 1000)) : 0;
  return <div className={`scene ${theme} scene-${viewMode} crowd-${crowdDensity}`}>
    {showYouTubeJoinNotice && <div className="youtube-join-notice"><span aria-hidden="true">💬</span> bình luận bất kỳ để vào quán</div>}
    {(leaderboard.gifters.length > 0 || leaderboard.likers.length > 0 || leaderboardEditing) && <LiveLeaderboard leaderboard={leaderboard} layout={leaderboardLayout} viewMode={viewMode} editing={leaderboardEditing} allowLikes={!showYouTubeJoinNotice} onChange={onLeaderboardPlacementChange} />}
    <div className="scene-sky"><span className="moon" /><span className="star star-one">✦</span><span className="star star-two">✧</span><span className="star star-three">✦</span></div>
    <div className="shop-front"><div className="shop-roof" /><div className="shop-sign">{theme === 'sidewalk-cafe' ? 'CÀ PHÊ · GÓC PHỐ' : 'PHÒNG TRÀ · ĐÊM NAY'}</div><div className="shop-awning" /><div className="shop-window"><span>☕</span></div><div className="shop-door"><div className="door-glow" /></div><div className="shop-window second"><span>{theme === 'sidewalk-cafe' ? '✳' : '♫'}</span></div></div>
    <div className="scene-lamps"><div className="lamp left" /><div className="lamp right" /></div>
    <div className="pavement" /><div className="street-line" />
    {hasCafeEvents(theme) && isRaining && <div className="rain-weather" aria-label="Trời đang mưa">
      <div className="rain-darkness" />
      <div className="rain-sheet rain-sheet-back" />
      <div className="rain-splashes" />
    </div>}
    <div className="table table-one"><span>{theme === 'beach-bar' ? '🥥' : '☕'}</span></div><div className="table table-two"><span>{theme === 'beach-bar' ? '🍹' : '☕'}</span></div><div className="table table-three"><span>{theme === 'beach-bar' ? '🥥' : '☕'}</span></div>
    {hasCafeEvents(theme) && latestGift && <div className="gift-thank-board" key={latestGift.id} role="status">
      <span className="gift-sparkle">✦</span>
      <Avatar avatar={latestGift.avatar} name={latestGift.nickname} />
      <span className="gift-thank-copy"><small>QUÁN CẢM ƠN</small><strong>{latestGift.nickname}</strong><em>đã tặng {latestGift.giftName}{latestGift.count > 1 ? ` ×${latestGift.count}` : ''}</em></span>
      {latestGift.giftImage ? <img className="gift-image" src={latestGift.giftImage} alt={latestGift.giftName} /> : <span className="gift-fallback">🎁</span>}
    </div>}
    {hasCafeEvents(theme) && <div className="cafe-staff" aria-label={theme === 'beach-bar' ? 'Nhân viên quán nước bãi biển' : 'Nhân viên quán cà phê'}>
      <div className="staff-member staff-owner"><CharacterSprite character={{ src: theme === 'beach-bar' ? '/characters/beach-atlas.png' : '/characters/cafe-owner.png', label: 'Cô chủ Hương', atlasIndex: theme === 'beach-bar' ? 10 : undefined }} label="Cô chủ Hương đang phục vụ đồ uống" /></div>
      <div className="staff-member staff-maid"><CharacterSprite character={{ src: theme === 'beach-bar' ? '/characters/beach-atlas.png' : '/characters/maid-server-v2.png', label: 'Lan', atlasIndex: theme === 'beach-bar' ? 11 : undefined }} label="Lan đang phục vụ đồ uống" /></div>
      <div className="staff-member staff-executive"><CharacterSprite character={{ src: theme === 'beach-bar' ? '/characters/beach-atlas.png' : '/characters/executive-server-v2.png', label: 'Minh', atlasIndex: theme === 'beach-bar' ? 12 : undefined }} label="Minh đang phục vụ đồ uống" /></div>
    </div>}
    {hasCafeEvents(theme) && kidnapping.phase !== 'idle' && <div className={`kidnapping-event ${theme === 'beach-bar' ? 'kidnapping-by-boat' : 'kidnapping-by-van'} phase-${kidnapping.phase}`}>
      <div className="kidnap-alert" role="status" aria-live="assertive">
        {kidnapping.phase === 'arriving' && (theme === 'beach-bar'
          ? <><strong>🚨 THUYỀN LẠ ĐANG ÁP SÁT BỜ!</strong><span>Hai kẻ bịt mặt đang nhảy khỏi thuyền…</span></>
          : <><strong>🚨 XE LẠ ĐANG TIẾN VÀO QUÁN!</strong><span>Hai kẻ bịt mặt đang xuống xe…</span></>)}
        {kidnapping.phase === 'rescue' && <><strong>🆘 GIẢI CỨU CON TIN · {secondsLeft}s</strong><span>Bình luận chữ <b>“giup”</b> để cứu {kidnapping.hostages.map((guest) => guest.nickname).join(' và ')}</span></>}
        {kidnapping.phase === 'saved' && <><strong>✅ CON TIN ĐÃ ĐƯỢC GIẢI CỨU!</strong><span>Cảm ơn {kidnapping.rescuer} đã lên tiếng kịp thời.</span></>}
        {kidnapping.phase === 'abducted' && <><strong>{theme === 'beach-bar' ? '🚤' : '🚐'} CON TIN ĐÃ BỊ ĐƯA ĐI!</strong><span>Không ai giải cứu kịp… họ sẽ quay lại sau 5 giây.</span></>}
      </div>
      <div className="kidnap-vehicle" aria-hidden="true"><img src={theme === 'beach-bar' ? '/kidnapping/speedboat.png' : '/kidnapping/van.png'} alt="" /></div>
      {(kidnapping.phase === 'rescue' || kidnapping.phase === 'abducted') && kidnapping.hostages.map((hostage, index) => {
        const position = getSeatPosition(hostage.seat, viewMode, seatSpacing, theme);
        const hostageStyle = getGuestStyle(hostage, theme);
        return <div className={`kidnap-pursuit pursuit-${index + 1}`} key={hostage.id} style={{ '--target-left': `${position.left}%`, '--target-top': `${position.top}%`, '--pursuit-delay': `${index * 0.28}s` } as CSSProperties}>
          <div className="kidnapper-figure" aria-label={`Kẻ bắt cóc đang tiến tới ${hostage.nickname}`}><img className="kidnapper-pose pose-run" src="/kidnapping/kidnapper-run.png" alt="" /><img className="kidnapper-pose pose-grab" src="/kidnapping/kidnapper-grab.png" alt="" /><img className="kidnapper-pose pose-escort" src="/kidnapping/kidnapper-escort.png" alt="" /></div>
          <div className="captured-guest"><div className="captured-name"><Avatar avatar={hostage.avatar} name={hostage.nickname} /><strong>{hostage.nickname}</strong></div><CharacterSprite character={hostageStyle} label={`${hostage.nickname} bị bắt cóc`} /></div>
        </div>;
      })}
    </div>}
    {sceneGuests.filter((guest) => !(hiddenHostages && hostageIds.has(guest.id))).map((guest) => {
      const { left, top, depth } = getSeatPosition(guest.seat, viewMode, seatSpacing, theme);
      const guestStyle = getGuestStyle(guest, theme);
      return <div className={`scene-guest chair-${Math.floor(guest.seat) % 2}`} key={guest.id} style={{ left: `${left}%`, top: `${top}%`, width: guestSize.width, height: guestSize.height, zIndex: 5 + depth }} title={`@${guest.username}`}>
        <div className="guest-name"><Avatar avatar={guest.avatar} name={guest.nickname} /><span>{guest.nickname}</span></div>
        <div className="guest-chair" />
        <div className="guest-character"><CharacterSprite character={guestStyle} label={`${guest.nickname} trong trang phục ${guestStyle.label}`} /></div>
      </div>;
    })}
    {sceneGuests.length === 0 && <div className="scene-placeholder"><span>☕</span><strong>Quán đang chờ khách</strong><small>Khách vào LIVE sẽ xuống quán và tìm ghế ngồi.</small></div>}
    {hasCafeEvents(theme) && isRaining && <div className="cafe-rain-shelter" aria-hidden="true"><div className="tarp"><span className="tarp-seam seam-one" /><span className="tarp-seam seam-two" /><span className="tarp-drip drip-one" /><span className="tarp-drip drip-two" /><span className="tarp-drip drip-three" /></div><span className="tarp-pole pole-left" /><span className="tarp-pole pole-right" /></div>}
    <div className="scene-dialogue-layer">
      {hasCafeEvents(theme) && <>
        <div className="staff-dialogue-anchor staff-owner">{showStaffBubble && dialogue.speaker === 'owner' && <div className="staff-bubble"><strong>{dialogue.name}</strong>{dialogue.message}</div>}</div>
        <div className="staff-dialogue-anchor staff-maid">{showStaffBubble && dialogue.speaker === 'maid' && <div className="staff-bubble"><strong>{dialogue.name}</strong>{dialogue.message}</div>}</div>
        <div className="staff-dialogue-anchor staff-executive">{showStaffBubble && dialogue.speaker === 'executive' && <div className="staff-bubble"><strong>{dialogue.name}</strong>{dialogue.message}</div>}</div>
      </>}
      {sceneGuests.map((guest) => {
        const latest = guest.isVirtual
          ? (virtualComment?.guestId === guest.id ? virtualComment : null)
          : comments.find((comment) => comment.guestId === guest.id);
        if (!latest || now - latest.timestamp >= 7000) return null;
        const { left, top } = getSeatPosition(guest.seat, viewMode, seatSpacing, theme);
        return <div className="scene-dialogue-guest" key={latest.id} style={{ left: `${left}%`, top: `${top}%`, width: guestSize.width, height: guestSize.height }}><div className="speech-bubble"><span className="speech-speaker"><strong>{latest.nickname}</strong>{!guest.isVirtual && <small>@{latest.username}</small>}</span><span className="speech-message">{latest.comment}</span></div></div>;
      })}
    </div>
  </div>;
}
