import { describe, expect, it, vi } from 'vitest'

/**
 * Guards the two properties Cloudflare Workers require of the database module.
 * Both were broken at some point during the Cloudflare port and both fail
 * silently in production — as an isolate-startup crash and as a hung request —
 * so they are pinned here rather than left to a deploy to discover.
 */
describe('database client lifecycle', () => {
  it('does not connect at import time', async () => {
    // A module-level `postgres(...)` call would throw here, because Workers
    // forbid I/O during module evaluation and expose env only per request.
    vi.resetModules()
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      await expect(import('@/lib/db')).resolves.toHaveProperty('db')
    } finally {
      if (saved) process.env.DATABASE_URL = saved
    }
  })

  it('reports a missing connection string on first use, not at import', async () => {
    vi.resetModules()
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      const { db } = await import('@/lib/db')
      expect(() => db.select()).toThrow(/DATABASE_URL is not set/)
    } finally {
      if (saved) process.env.DATABASE_URL = saved
    }
  })
})
