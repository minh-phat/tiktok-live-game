# TikTok LIVE Comment Viewer

Ứng dụng NestJS + Next.js hiển thị comment từ một phòng TikTok LIVE theo thời gian thực.

## Chạy dự án

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm run dev
```

Mở `http://localhost:3000`, nhập username (không cần dấu `@`) hoặc link LIVE. Backend mặc định chạy tại `http://localhost:3001`.

## Kiến trúc

- Frontend: Next.js, React, TypeScript
- Backend: NestJS, WebSocket Gateway, Socket.IO
- TikTok: `tiktok-live-connector`

## Biến môi trường

- Backend: `PORT` (mặc định `3001`), `FRONTEND_URL` (mặc định `http://localhost:3000`)
- Frontend: `NEXT_PUBLIC_BACKEND_URL` (mặc định `http://localhost:3001`)

## Các lệnh

```bash
npm run dev             # chạy frontend và backend
npm run build           # build production
npm run start           # chạy production sau khi build
npm run check           # kiểm tra TypeScript
```

> `tiktok-live-connector` là thư viện không chính thức, dựa trên cơ chế Webcast nội bộ của TikTok. TikTok có thể thay đổi cơ chế này bất kỳ lúc nào. Chỉ dùng phù hợp với điều khoản của TikTok.
