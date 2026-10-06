import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TikTok LIVE Comment',
  description: 'Theo dõi comment TikTok LIVE theo thời gian thực',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
