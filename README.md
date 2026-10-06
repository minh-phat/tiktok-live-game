# TikTok LIVE Comment Viewer

Website JavaScript hiển thị comment từ một phòng TikTok LIVE theo thời gian thực.

## Chạy dự án

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm start
```

Mở `http://localhost:3000`, nhập username (không cần dấu `@`) hoặc link LIVE.

## Kiến trúc

- Frontend: HTML, CSS, JavaScript thuần
- Backend: Express + Socket.IO
- TikTok: `tiktok-live-connector`

> `tiktok-live-connector` là thư viện không chính thức, dựa trên cơ chế Webcast nội bộ của TikTok. TikTok có thể thay đổi cơ chế này bất kỳ lúc nào. Chỉ dùng phù hợp với điều khoản của TikTok.
