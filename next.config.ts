import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // First look is the miniature — hide the Next.js "N" badge (reads as Compass N).
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
  transpilePackages: ['three'],
};

export default nextConfig;
