import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  env: {
    // Cloudflare Workers Builds injects WORKERS_CI_COMMIT_SHA at build time.
    // Baking it in lets /api/health say which commit is actually serving, so
    // "is my fix deployed yet?" stops being guesswork.
    APP_COMMIT: process.env.WORKERS_CI_COMMIT_SHA ?? '',
  },
  typedRoutes: false,
  experimental: {
    // Server Actions are used for every mutation; keep the payload small.
    serverActions: { bodySizeLimit: '1mb' },
  },
}

export default nextConfig
