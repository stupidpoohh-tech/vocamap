import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The migration folder has a second source of truth: `meta/_journal.json`.
 *
 * `drizzle-kit generate` writes both, so they agree — but a migration written
 * by hand is only a file, and the runner reads the journal. A file the journal
 * does not list is skipped in silence: `pnpm db:migrate` reports success and
 * the column is not there. That is how `0002_pronunciation.sql` came to exist
 * for a week without ever having run, and how a database provisioned in that
 * week ended up without `vocabularies.pronunciation`.
 *
 * Nothing about that failure is loud, so it is checked here instead.
 */

type Entry = { idx: number; when: number; tag: string }

const FOLDER = new URL('../drizzle/', import.meta.url)
const journal: { entries: Entry[] } = JSON.parse(
  readFileSync(new URL('meta/_journal.json', FOLDER), 'utf8'),
)
const files = readdirSync(FOLDER).filter((name) => name.endsWith('.sql'))

describe('the migration journal', () => {
  it('lists every migration file, and no file it does not have', () => {
    expect([...journal.entries.map((e) => e.tag)].sort()).toEqual(
      files.map((name) => name.replace(/\.sql$/, '')).sort(),
    )
  })

  it('keeps a snapshot beside every entry, so the next generate diffs from here', () => {
    const snapshots = readdirSync(new URL('meta/', FOLDER)).filter((n) => n.endsWith('_snapshot.json'))
    expect(snapshots).toHaveLength(journal.entries.length)
    for (const entry of journal.entries) {
      expect(snapshots, entry.tag).toContain(`${String(entry.idx).padStart(4, '0')}_snapshot.json`)
    }
  })

  it('orders entries by a strictly rising timestamp', () => {
    // The runner applies everything stamped later than the last row in the
    // database. An entry that does not move forward is never reached.
    const times = journal.entries.map((e) => e.when)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(new Set(times).size).toBe(times.length)
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i))
  })
})
