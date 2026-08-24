import type { Metadata } from 'next';
import { SimApp } from '@/components/sim/SimApp';

export const metadata: Metadata = {
  title: 'Central London map',
  description:
    'A Three.js mesh of central London extruded from OpenStreetMap building footprints and street centre-lines. Hyde Park to Docklands, including the eight RUNWAY hubs plus the City and Westminster.',
  robots: { index: false, follow: false },
};

export default function SimPage() {
  return <SimApp />;
}
