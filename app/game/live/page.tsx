import type { Metadata } from 'next';
import { LiveApp } from '@/components/game/LiveApp';

export const metadata: Metadata = {
  title: 'RUNWAY — live week playtest',
  description: 'Playtest prototype: every week is a workday across London.',
  robots: { index: false, follow: false },
};

export default function LiveGamePage() {
  return <LiveApp />;
}
