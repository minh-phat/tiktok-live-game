'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';

type Theme = 'sidewalk-cafe' | 'tea-room';
type ViewMode = 'desktop' | 'phone';
type Status = { state: 'connected' | 'connecting' | 'disconnected'; message: string; username?: string };
type User = { id: string; name: string; email: string };
type Room = { id: string; name: string; theme: Theme; tiktokUsername: string; createdAt: string };
type Guest = { id: string; username: string; nickname: string; avatar: string; seat: number; joinedAt: number };
type Comment = { id: string; guestId: string; username: string; nickname: string; avatar: string; comment: string; timestamp: number };
type Snapshot = { status: Status; guests: Guest[]; comments: Comment[]; viewers: number | null };
type Reply<T = undefined> = { ok: boolean; message?: string; data?: T };

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';
const emptyStatus: Status = { state: 'disconnected', message: 'Chưa kết nối TikTok LIVE' };

async function api<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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
  const [viewers, setViewers] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('desktop');
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedMode = window.localStorage.getItem('live-room-view-mode');
    if (savedMode === 'desktop' || savedMode === 'phone') setViewMode(savedMode);
  }, []);

  useEffect(() => {
    const connection = io(backendUrl, { withCredentials: true });
    connection.on('connect', () => {
      connection.emit('room:join', { roomId: room.id }, (reply: Reply<Snapshot>) => {
        if (!reply.ok || !reply.data) { setError(reply.message ?? 'Không vào được phòng.'); return; }
        setStatus(reply.data.status);
        setGuests(reply.data.guests);
        setComments(reply.data.comments);
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
    connection.on('live:stats', ({ viewers: count }: { viewers: number | null }) => setViewers(count));
    connection.on('live:reset', () => { setGuests([]); setComments([]); setViewers(null); });
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
      <div className={`room-layout ${viewMode}-view`}>
        <div className="scene-column"><div className="stream-stage" ref={stageRef}><Scene theme={room.theme} guests={guests} comments={comments} viewMode={viewMode} /><div className="stream-hud"><span className={`stream-live ${status.state}`}>● {status.state === 'connected' ? 'LIVE' : 'OFFLINE'}</span><strong>{room.name}</strong><span>{viewers === null ? '—' : viewers.toLocaleString('vi-VN')} người xem</span></div></div><div className="scene-footer"><span><i className="status-dot" />{status.message}</span><span>{viewers === null ? '—' : viewers.toLocaleString('vi-VN')} người xem TikTok · {guests.length} khách trong quán</span><button type="button" className="fullscreen-button" onClick={openFullscreen}>⛶ Toàn màn hình</button></div></div>
        <aside className="chat-panel"><div className="chat-head"><div><span className="eyebrow">CUỘC TRÒ CHUYỆN</span><h2>Bình luận LIVE</h2></div><span className="chat-count">{comments.length}</span></div><div className="chat-list">{comments.length ? comments.map((comment) => <div className="chat-line" key={comment.id}><Avatar avatar={comment.avatar} name={comment.nickname} /><div><div className="chat-meta"><strong>{comment.nickname}</strong><time>{new Date(comment.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{comment.comment}</p></div></div>) : <div className="chat-empty"><span>💬</span><strong>Chưa có lời nhắn</strong><p>Khi có bình luận, bong bóng chat sẽ hiện trên nhân vật trong quán.</p></div>}</div><div className="chat-foot">Tin nhắn được lấy trực tiếp từ TikTok LIVE</div></aside>
      </div>
    </main>
  );
}

function Avatar({ avatar, name }: { avatar: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="mini-avatar">{avatar && !failed ? <img src={avatar} alt="" onError={() => setFailed(true)} /> : name.slice(0, 1).toUpperCase()}</span>;
}

const seatPositions = [
  [19, 62], [35, 58], [67, 58], [82, 62],
  [15, 81], [31, 78], [48, 76], [65, 78], [83, 81],
  [26, 43], [51, 43], [76, 43],
];

const phoneSeatPositions = [
  [18, 54], [50, 54], [82, 54],
  [18, 65], [50, 65], [82, 65],
  [18, 76], [50, 76], [82, 76],
  [18, 87], [50, 87], [82, 87],
];

function Scene({ theme, guests, comments, viewMode }: { theme: Theme; guests: Guest[]; comments: Comment[]; viewMode: ViewMode }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  return <div className={`scene ${theme} scene-${viewMode}`}>
    <div className="scene-sky"><span className="moon" /><span className="star star-one">✦</span><span className="star star-two">✧</span><span className="star star-three">✦</span></div>
    <div className="shop-front"><div className="shop-roof" /><div className="shop-sign">{theme === 'sidewalk-cafe' ? 'CÀ PHÊ · GÓC PHỐ' : 'PHÒNG TRÀ · ĐÊM NAY'}</div><div className="shop-awning" /><div className="shop-window"><span>☕</span></div><div className="shop-door"><div className="door-glow" /></div><div className="shop-window second"><span>{theme === 'sidewalk-cafe' ? '✳' : '♫'}</span></div></div>
    <div className="scene-lamps"><div className="lamp left" /><div className="lamp right" /></div>
    <div className="pavement" /><div className="street-line" />
    <div className="table table-one"><span>☕</span></div><div className="table table-two"><span>☕</span></div><div className="table table-three"><span>☕</span></div>
    {guests.map((guest) => {
      const positions = viewMode === 'phone' ? phoneSeatPositions : seatPositions;
      const [left, top] = positions[guest.seat] ?? positions[0];
      const latest = comments.find((comment) => comment.guestId === guest.id);
      const showBubble = latest && now - latest.timestamp < 7000;
      return <div className={`scene-guest chair-${guest.seat % 2}`} key={guest.id} style={{ left: `${left}%`, top: `${top}%` }} title={`@${guest.username}`}>
        {showBubble && <div className="speech-bubble" key={latest.id}>{latest.comment}</div>}
        <div className="guest-name">{guest.nickname}</div>
        <div className="guest-chair" />
        <div className={`guest-character variant-${guest.seat % 6}`}><div className="guest-head">{guest.avatar ? <Avatar avatar={guest.avatar} name={guest.nickname} /> : <span>{guest.nickname.slice(0, 1).toUpperCase()}</span>}</div><div className="guest-body" /><div className="guest-legs" /></div>
      </div>;
    })}
    {guests.length === 0 && <div className="scene-placeholder"><span>☕</span><strong>Quán đang chờ khách</strong><small>Khách vào LIVE sẽ xuống quán và tìm ghế ngồi.</small></div>}
    <div className="scene-caption">{theme === 'sidewalk-cafe' ? 'Xe cà phê góc phố · Ghế nhựa tự lấy · Đậm chất Việt.' : 'Ánh đèn dịu, âm nhạc và những cuộc trò chuyện.'}</div>
  </div>;
}
