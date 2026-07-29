import type { Metadata } from 'next';
import { Barlow_Condensed, Geist } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const barlowCondensed = Barlow_Condensed({
  variable: '--font-billboard',
  subsets: ['latin'],
  weight: ['700', '800', '900'],
});

const SITE_NAME = 'RUNWAY';
const DESCRIPTION =
  'A playable London startup strategy game. Pick a hub, grow your company, out-raise rivals, and try to reach unicorn status before the runway runs out.';
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} - the London startup game`,
    template: `%s · ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} - the London startup game`,
    description: DESCRIPTION,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} - the London startup game`,
    description: DESCRIPTION,
  },
  robots: {
    index: false,
    follow: false,
  },
  category: 'game',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-GB"
      className={`${geistSans.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
