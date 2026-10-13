import type { NextConfig } from 'next';
const config: NextConfig = { env: { NEXT_PUBLIC_INVENTORY_BACKEND: 'neon' }, outputFileTracingRoot: process.cwd(), trailingSlash: true, images: { unoptimized: true } }; export default config;
