import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans'
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono'
});

export const metadata = {
  title: 'DTS Pipeline — Ops',
  description: 'Live status and control for the DTS dashboard automation + WhatsApp delivery pipeline'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
