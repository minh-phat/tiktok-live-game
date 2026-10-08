import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LIVE Quán · TikTok & YouTube',
  description: 'Biến bình luận TikTok và YouTube LIVE thành một quán 2D',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
