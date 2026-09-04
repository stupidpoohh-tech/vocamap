import { cache } from 'react'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { normaliseConnectionString } from './connection-string'

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

/**
 * Cloudflare's per-request context, which OpenNext parks on a well-known global
 * symbol. Read directly rather than through `getCloudflareContext()` so this
 * module keeps working unchanged under Node, where the symbol is simply absent.
 */
function cloudflareEnv(): Record<string, unknown> | undefined {
  const context = (globalThis as Record<symbol, unknown>)[
    Symbol.for('__cloudflare-context__')
  ] as { env?: Record<string, unknown> } | undefined
  return context?.env
}

/**
 * Hyperdrive's local connection string, when the binding is present.
 *
 * A Worker cannot reliably open a raw TCP connection to a database across the
 * public internet — ours timed out against Neon in production while working
 * fine locally. Hyperdrive terminates the connection inside Cloudflare's edge
 * and pools it, which fixes both that and the cost of the per-request client
 * this runtime forces on us.
 */
export function hyperdriveConnectionString(): string | undefined {
  const binding = cloudflareEnv()?.HYPERDRIVE
  if (binding && typeof binding === 'object' && 'connectionString' in binding) {
    const value = (binding as { connectionString?: unknown }).connectionString
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function connectionString(): string {
  // Hyperdrive wins when bound; DATABASE_URL stays the fallback so the app runs
  // unchanged under Node, in tests, and on any host without Hyperdrive.
  const hyperdrive = hyperdriveConnectionString()
  if (hyperdrive) return normaliseConnectionString(hyperdrive)

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres instance.',
    )
  }
  return normaliseConnectionString(url)
}

function create(): Db {
  const client = postgres(connectionString(), {
    // `DB_TRACE=1` logs one line per statement. The app's cost is dominated by
    // the number of round trips it makes, not by how long any one of them
    // takes, and counting them is the only way to see that — a page can look
    // fine locally and be slow in production purely on query count.
    ...(process.env.DB_TRACE === '1'
      ? {
          debug: (_connection: unknown, query: string) => {
            console.log(`[db] ${Date.now()} ${query.replace(/\s+/g, ' ').slice(0, 70)}`)
          },
        }
      : {}),
    // On a Worker this caps concurrency *within a single request*, which is
    // what our `Promise.all` reads need — not a long-lived pool.
    //
    // Three was too few. The word page issues fourteen reads at once and this
    // is what decides how many round trips that becomes: at three it is five
    // waves, at six it is three. Hyperdrive keeps the real pool on Cloudflare's
    // side, so what is opened here is cheap — the number only has to be large
    // enough that a page's own parallel reads are not queued behind each other.
    max: isWorkerd ? 6 : process.env.NODE_ENV === 'production' ? 10 : 3,
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
