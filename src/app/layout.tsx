import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Telegram Time Tracker',
  description: 'Telegram bot for employee time tracking',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
