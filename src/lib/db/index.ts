import { cache } from 'react'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = PostgresJsDatabase<typeof schema>

declare global {
  // eslint-disable-next-line no-var
  var __vocamapDb: Db | undefined
}

/**
 * True inside a Cloudflare Worker. `postgres` ships a `workerd` build that
 * speaks Postgres over Cloudflare's TCP socket API, so the driver needs no
 * changes — but its lifecycle does. See `resolve()`.
 */
const isWorkerd =
  typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres instance.',
    )
  }
  return url
}

function create(): Db {
  const client = postgres(connectionString(), {
    // On a Worker this caps concurrency *within a single request*, which is
    // what our `Promise.all` reads need — not a long-lived pool.
    max: isWorkerd ? 3 : process.env.NODE_ENV === 'production' ? 10 : 3,
    // Let sockets retire on their own; nothing closes them explicitly once the
    // request that owns them is gone.
    idle_timeout: isWorkerd ? 10 : undefined,
    prepare: false, // required for transaction-pooled connections (Neon/PgBouncer)
  })
  return drizzle(client, { schema, casing: 'snake_case' })
}

/**
 * Request-scoped on Workers. React's `cache()` memoises per request, so one
 * request shares one client and the next request gets a fresh one.
 */
const perRequest = cache(create)

function resolve(): Db {
  // Cloudflare forbids using an I/O object created by one request from another
  // request. A module-level pool therefore serves the first request and then
  // hangs every request after it — silently, as a timeout rather than an error.
  // (Verified: caching across requests made the second login hang.)
  if (isWorkerd) return perRequest()

  // In Node a long-lived pool is correct, and caching it on globalThis stops
  // dev hot-reloads from leaking connections.
  if (globalThis.__vocamapDb) return globalThis.__vocamapDb
  const instance = create()
  globalThis.__vocamapDb = instance
  return instance
}

/**
 * Initialised on first use, not at import: Workers populate `process.env` from
 * bindings per request and forbid I/O during module evaluation, so connecting
 * at module scope throws at isolate startup.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, property, receiver) {
    const instance = resolve()
    const value = Reflect.get(instance, property, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

export { schema }
