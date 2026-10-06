const socket = io();
const form = document.querySelector('#connect-form');
const input = document.querySelector('#username');
const button = document.querySelector('#connect-button');
const status = document.querySelector('#status');
const comments = document.querySelector('#comments');
const emptyState = document.querySelector('#empty-state');
const countLabel = document.querySelector('#comment-count');
const clearButton = document.querySelector('#clear-button');
const template = document.querySelector('#comment-template');
let count = 0;

function setStatus(data) {
  status.dataset.state = data.state;
  status.querySelector('b').textContent = data.message;
  const busy = data.state === 'connecting';
  button.disabled = busy;
  button.textContent = busy ? 'Đang nối...' : 'Kết nối';
}

function addComment(data) {
  if (!data?.comment) return;

  const item = template.content.firstElementChild.cloneNode(true);
  const avatar = item.querySelector('.avatar');
  const image = avatar.querySelector('img');
  const fallback = avatar.querySelector('span');
  fallback.textContent = (data.nickname || data.username || '?')[0].toUpperCase();
  if (data.avatar) {
    image.src = data.avatar;
    image.hidden = false;
    image.addEventListener('error', () => { image.hidden = true; });
  }
  item.querySelector('strong').textContent = `${data.nickname}  ·  @${data.username}`;
  item.querySelector('small').textContent = new Date(data.timestamp).toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
  item.querySelector('p').textContent = data.comment;
  comments.prepend(item);
  while (comments.children.length > 200) comments.lastElementChild.remove();
  count += 1;
  countLabel.textContent = `${count} bình luận`;
  emptyState.hidden = true;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('live:connect', { username: input.value }, (result) => {
    if (!result?.ok) setStatus({ state:'disconnected', message:result?.message || 'Kết nối thất bại.' });
  });
});

clearButton.addEventListener('click', () => {
  comments.replaceChildren();
  count = 0;
  countLabel.textContent = '0 bình luận';
  emptyState.hidden = false;
});

socket.on('live:status', setStatus);
socket.on('live:comment', addComment);
socket.on('connect_error', () => setStatus({ state:'disconnected', message:'Không kết nối được server.' }));
