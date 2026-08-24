import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  transpilePackages: ['three'],
  // Clay-board GeoJSON stays in git for PR #22; do not trace it into serverless.
  outputFileTracingExcludes: {
    '*': ['./data/**/*.geojson', './data/.cache/**'],
  },
};

export default nextConfig;
