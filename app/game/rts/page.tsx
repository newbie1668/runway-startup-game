import type { Metadata } from 'next';
import { RtsApp } from '@/components/rts/RtsApp';

export const metadata: Metadata = {
  title: 'RUNWAY: London Live (prototype)',
  description: 'Map-based startup sim prototype: send your team around London to build, sell, hire and raise.',
  robots: { index: false, follow: false },
};

export default function RtsPage() {
  return <RtsApp />;
}
