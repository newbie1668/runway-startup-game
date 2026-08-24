import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  transpilePackages: ['three'],
  // Do not trace OSM GeoJSON (full or simplified) into serverless.
  outputFileTracingExcludes: {
    '*': ['./data/**/*.geojson', './data/.cache/**'],
  },
};

export default nextConfig;
