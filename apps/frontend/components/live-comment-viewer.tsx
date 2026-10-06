'use client';

import { FormEvent, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type ConnectionState = 'connected' | 'connecting' | 'disconnected';

interface LiveStatus {
  state: ConnectionState;
  message: string;
}

interface LiveComment {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  comment: string;
  timestamp: number;
}

interface SocketReply {
  ok: boolean;
  message?: string;
}

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

export function LiveCommentViewer() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<LiveStatus>({ state: 'disconnected', message: 'Chưa kết nối' });
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [commentCount, setCommentCount] = useState(0);

  useEffect(() => {
    const connection = io(backendUrl);
    connection.on('live:status', (nextStatus: LiveStatus) => setStatus(nextStatus));
    connection.on('live:comment', (comment: LiveComment) => {
      if (!comment?.comment) return;
      setComments((current) => [comment, ...current].slice(0, 200));
      setCommentCount((count) => count + 1);
    });
    connection.on('connect_error', () => {
      setStatus({ state: 'disconnected', message: 'Không kết nối được server.' });
    });
    setSocket(connection);

    return () => {
      connection.disconnect();
    };
  }, []);

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    socket?.emit('live:connect', { username }, (result: SocketReply) => {
      if (!result?.ok) {
        setStatus({ state: 'disconnected', message: result?.message || 'Kết nối thất bại.' });
      }
    });
  }

  function clearComments() {
    setComments([]);
    setCommentCount(0);
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="brand"><span className="brand-mark">T</span> LIVE COMMENT</div>
        <h1>Bắt trọn mọi<br /><span>bình luận LIVE.</span></h1>
        <p>Nhập username của tài khoản đang phát trực tiếp. Comment mới sẽ xuất hiện ngay tại đây.</p>
      </header>

      <section className="panel" aria-labelledby="connect-title">
        <div className="panel-head">
          <div><p className="eyebrow">Kết nối phòng</p><h2 id="connect-title">TikTok LIVE</h2></div>
          <div className="status" data-state={status.state}><span /><b>{status.message}</b></div>
        </div>

        <form className="connect-form" onSubmit={connect}>
          <label htmlFor="username">Username hoặc link LIVE</label>
          <div className="input-row">
            <span className="at">@</span>
            <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" placeholder="username" required />
            <button type="submit" id="connect-button" disabled={status.state === 'connecting'}>
              {status.state === 'connecting' ? 'Đang nối...' : 'Kết nối'}
            </button>
          </div>
          <p className="hint">Ví dụ: <strong>username</strong> hoặc <strong>tiktok.com/@username/live</strong></p>
        </form>
      </section>

      <section className="feed" aria-labelledby="feed-title">
        <div className="feed-head">
          <div><p className="eyebrow">Thời gian thực</p><h2 id="feed-title">Bình luận</h2></div>
          <div className="feed-actions"><span>{commentCount} bình luận</span><button onClick={clearComments} type="button">Xoá</button></div>
        </div>
        <ol className="comments" aria-live="polite">
          {comments.map((item) => <CommentItem key={item.id} item={item} />)}
        </ol>
        {comments.length === 0 && (
          <div className="empty-state">
            <div className="bubble">•••</div>
            <h3>Chưa có bình luận</h3>
            <p>Kết nối một phòng đang LIVE để bắt đầu.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function CommentItem({ item }: { item: LiveComment }) {
  const [imageFailed, setImageFailed] = useState(false);
  const name = item.nickname || item.username || '?';

  return (
    <li className="comment">
      <div className="avatar">
        {item.avatar && !imageFailed
          ? <img src={item.avatar} alt="" onError={() => setImageFailed(true)} />
          : <span>{name[0].toUpperCase()}</span>}
      </div>
      <div className="comment-body">
        <div className="comment-meta">
          <strong>{item.nickname} · @{item.username}</strong>
          <small>{new Date(item.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
        <p>{item.comment}</p>
      </div>
    </li>
  );
}
