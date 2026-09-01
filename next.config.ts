import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: false,
  experimental: {
    // Server Actions are used for every mutation; keep the payload small.
    serverActions: { bodySizeLimit: '1mb' },
  },
}

export default nextConfig
