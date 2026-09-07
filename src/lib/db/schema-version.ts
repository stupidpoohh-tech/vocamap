import { sql } from 'drizzle-orm'
import type { Db } from './index'
import { db as defaultDb } from './index'

/**
 * Does the live database have everything this build needs?
 *
 * Checked against the actual schema rather than Drizzle's journal, because
 * migrations here are usually applied by pasting the .sql into a web console,
 * which updates the schema without touching the bookkeeping. A journal-based
 * check would then report a migration as missing forever after it had been
 * correctly applied.
 *
 * Add a row whenever a migration adds something the code depends on.
 */
const REQUIREMENTS: Array<{ migration: string; table: string; column: string }> = [
  { migration: '0001_bookmarks', table: 'user_vocabulary_state', column: 'bookmarked_at' },
]

export type SchemaStatus = {
  upToDate: boolean
  /** Migrations whose columns are not present, oldest first. */
  missing: string[]
}

export async function schemaStatus(db: Db = defaultDb): Promise<SchemaStatus> {
  if (!REQUIREMENTS.length) return { upToDate: true, missing: [] }

  const rows = await db.execute<{ table_name: string; column_name: string }>(
    sql`select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and column_name in ${sql.raw(
            `(${REQUIREMENTS.map((r) => `'${r.column}'`).join(', ')})`,
          )}`,
  )

  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`))
  const missing = REQUIREMENTS.filter(
    (req) => !present.has(`${req.table}.${req.column}`),
  ).map((req) => req.migration)

  return { upToDate: missing.length === 0, missing: [...new Set(missing)] }
}
