import type { NextConfig } from 'next';
const config: NextConfig = { output: 'export', outputFileTracingRoot: process.cwd(), trailingSlash: true, images: { unoptimized: true } }; export default config;
