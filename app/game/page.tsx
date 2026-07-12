import type { Metadata } from 'next';
import { GameApp } from '@/components/game/GameApp';

export const metadata: Metadata = {
  title: 'Play RUNWAY',
  description:
    'Found a startup on a living map of London. Work the events scene, out-raise your rivals, and reach a $1B valuation before the money runs out.',
  robots: { index: false, follow: false },
};

export default function GamePage() {
  return <GameApp />;
}
