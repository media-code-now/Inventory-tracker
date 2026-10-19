import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

export default function config(phase: string): NextConfig {
  return {
    // Keep production builds from overwriting a running dev server's modules.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    env: { NEXT_PUBLIC_INVENTORY_BACKEND: 'neon' },
    outputFileTracingRoot: process.cwd(),
    trailingSlash: true,
    images: { unoptimized: true },
  };
}
