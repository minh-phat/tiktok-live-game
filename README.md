# LIVE Quán

Ứng dụng NestJS + Next.js biến bình luận TikTok LIVE thành một quán 2D. Người dùng đăng ký tài khoản, tạo phòng theo chủ đề, nhập TikTok username đang phát LIVE và xem khách ghé quán, ngồi ghế, trò chuyện.

## Chạy dự án

Yêu cầu Node.js 20 trở lên và một MongoDB đang chạy. Mặc định backend kết nối `mongodb://127.0.0.1:27017`, database `live_quan`.

```bash
npm install
npm run dev
```

Mở `http://localhost:3000`. Đăng ký tài khoản, tạo phòng **Cà phê vỉa hè** hoặc **Phòng trà**, nhập username TikTok (có thể dùng link `tiktok.com/@username/live`) rồi mở phòng. Backend mặc định chạy tại `http://localhost:3001`.

Khi TikTok phát sự kiện người xem vào LIVE, nhân vật sẽ đi xuống quán và ngồi vào ghế. Bình luận hiện trong bong bóng trên nhân vật và trong bảng chat. Nếu sự kiện vào phòng không được phát nhưng người xem bình luận, nhân vật vẫn được tạo từ sự kiện bình luận đó.

## Kiến trúc

- Frontend: Next.js, React, TypeScript
- Backend: NestJS, REST API cho tài khoản/phòng, Socket.IO cho LIVE
- TikTok: `tiktok-live-connector`

Tài khoản, phiên đăng nhập và cấu hình phòng được lưu trong ba collection MongoDB: `users`, `sessions`, `rooms`. Mật khẩu được băm bằng `scrypt`, phiên đăng nhập dùng cookie HttpOnly và có chỉ mục tự hết hạn trong MongoDB. Mỗi phòng có một kết nối TikTok riêng và chỉ chủ phòng đã đăng nhập được xem hoặc điều khiển phòng. Danh sách nhân vật và comment gần đây chỉ nằm trong bộ nhớ, sẽ mất khi backend khởi động lại. Hiện quán hiển thị tối đa 12 nhân vật gần nhất; thư viện TikTok không cung cấp sự kiện rời phòng ổn định nên ghế được thay bằng khách mới khi đủ chỗ.

### Chuyển dữ liệu JSON cũ

Nếu đã dùng phiên bản lưu trong `apps/backend/data/app.json`, hãy dừng backend rồi chạy một lần:

```bash
npm run migrate:json
```

Lệnh này chỉ thêm tài khoản, phòng và phiên đăng nhập còn hạn chưa có trong MongoDB. Có thể chạy lại mà không tạo bản ghi trùng; file JSON gốc vẫn được giữ để dự phòng. Nếu file cũ nằm nơi khác, đặt `DATA_FILE` khi chạy lệnh.

## Biến môi trường

Backend tự đọc `apps/backend/.env`. Ví dụ:

```env
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=live_quan
PORT=3001
FRONTEND_URL=http://localhost:3000
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=your_bucket
R2_PUBLIC_URL=https://media.example.com
```

- Backend: `PORT` (mặc định `3001`), `FRONTEND_URL` (mặc định `http://localhost:3000`)
- Backend: `MONGODB_URI` (mặc định `mongodb://127.0.0.1:27017`), `MONGODB_DB` (mặc định `live_quan`)
- Cloudflare R2: 5 biến `R2_*` ở trên. Bật public access/custom domain cho bucket và cấu hình CORS cho phép domain frontend đọc file âm thanh.
- Chỉ cho lệnh chuyển dữ liệu: `DATA_FILE` (mặc định `./data/app.json` tính từ `apps/backend`)
- Frontend: `NEXT_PUBLIC_BACKEND_URL` (mặc định `http://localhost:3001`)

Nếu triển khai qua HTTPS, dùng cùng site cho frontend/backend để cookie phiên và Socket.IO hoạt động. Khi chạy nhiều backend replica, cần thêm bộ chia sẻ trạng thái Socket.IO và kết nối TikTok giữa các tiến trình; hiện trạng thái LIVE vẫn nằm trong bộ nhớ một tiến trình.

## Các lệnh

```bash
npm run dev             # chạy frontend và backend
npm run build           # build production
npm run start           # chạy production sau khi build
npm run check           # kiểm tra TypeScript
npm run test:integration # kiểm tra API và Socket.IO với MongoDB cục bộ (database thử tự xóa)
```

> `tiktok-live-connector` là thư viện không chính thức, dựa trên cơ chế Webcast nội bộ của TikTok. TikTok có thể thay đổi cơ chế này bất kỳ lúc nào. Chỉ dùng phù hợp với điều khoản của TikTok.
