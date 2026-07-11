import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'playerz.bg',
  description: 'Book a court. Find a game. Multi-sport booking across Bulgaria.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg">
      <body>{children}</body>
    </html>
  );
}
