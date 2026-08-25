import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // First look is the miniature — hide the Next.js "N" badge (reads as Compass N).
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
  transpilePackages: ['three'],
  // Keep docs/stills and any leftover data dumps out of serverless traces.
  // The OSM extract is a public static asset, not a lambda payload.
  outputFileTracingExcludes: {
    '*': ['./docs/**', './data/**', './brag-output*/**'],
  },
  async redirects() {
    return [
      {
        source: '/api/osm-clay',
        destination: '/clay/osm-central-london.geojson',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
