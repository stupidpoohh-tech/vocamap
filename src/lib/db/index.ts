import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __vocamapSql: ReturnType<typeof postgres> | undefined
}

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres instance.',
    )
  }
  return url
}

/**
 * One pool per process. Cached on globalThis so Next.js dev hot-reloads do not
 * leak connections — Neon's free tier caps concurrent connections and the
 * pooled endpoint is unforgiving about this.
 */
const client =
  globalThis.__vocamapSql ??
  postgres(connectionString(), {
    max: process.env.NODE_ENV === 'production' ? 10 : 3,
    prepare: false, // required for transaction-pooled connections (Neon/PgBouncer)
  })

if (process.env.NODE_ENV !== 'production') globalThis.__vocamapSql = client

export const db = drizzle(client, { schema, casing: 'snake_case' })
export { schema }
export type Db = typeof db
