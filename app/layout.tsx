import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const SITE_NAME = 'RUNWAY';
const DESCRIPTION =
  'A playable London startup strategy game. Pick a hub, grow your company, out-raise rivals, and try to reach unicorn status before the runway runs out.';

export const metadata: Metadata = {
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
    <html lang="en-GB" className={`${geistSans.variable} h-full antialiased`}>
      <body className="h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
