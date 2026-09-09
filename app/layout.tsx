import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

// Cyrillic for the Russian guest site and the admin; Chinese falls through to
// the system's Han font, which is what the lang attribute on the page selects.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'cyrillic'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  // Without this the browser asks for /favicon.ico, gets a 404 and shows a
  // blank tab. A hotel opening the link sees an unnamed page.
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] },
  title: 'MehmonGo — Guest Services',
  description: 'Tours, transport, restaurants and tickets from your hotel room.',
  openGraph: {
    title: 'MehmonGo',
    description: 'Guest services, one scan away.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'MehmonGo guest services' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MehmonGo',
    description: 'Guest services, one scan away.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
