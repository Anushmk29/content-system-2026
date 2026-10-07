// Root layout for the host app. The only page that matters is /content.
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Content Studio',
  description: 'Content-to-pipeline engine dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f4f3ee' }}>{children}</body>
    </html>
  );
}
