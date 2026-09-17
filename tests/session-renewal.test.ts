import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions } from '@/lib/db/schema'
import { RENEW_WHEN_LEFT_UNDER_DAYS, SESSION_DAYS } from '@/lib/auth/lifetime'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

const DAY = 86_400_000

describe('session lifetime', () => {
  it('renews well before it lapses', () => {
    // Otherwise a session is only renewed once it is nearly gone, and somebody
    // who opens the app weekly still gets signed out.
    expect(RENEW_WHEN_LEFT_UNDER_DAYS).toBeLessThan(SESSION_DAYS)
    expect(SESSION_DAYS - RENEW_WHEN_LEFT_UNDER_DAYS).toBeLessThanOrEqual(14)
  })

  it('still lets an untouched session lapse within the month', () => {
    expect(SESSION_DAYS).toBeLessThanOrEqual(31)
  })
})

describe.skipIf(!hasDatabase)('reading a session', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  /** What `getActor` does to the row, without the cookie machinery. */
  async function readAndRenew(sessionId: string) {
    const { getActor } = await import('@/lib/auth/session')
    void getActor
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    if (!row || row.expiresAt.getTime() < Date.now()) return null
    const left = row.expiresAt.getTime() - Date.now()
    if (left < RENEW_WHEN_LEFT_UNDER_DAYS * DAY) {
      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * DAY) })
        .where(eq(sessions.id, sessionId))
    }
    return row
  }

  async function sessionExpiringIn(days: number) {
    const user = await createUser('student')
    const [row] = await db
      .insert(sessions)
      .values({ userId: user.id, expiresAt: new Date(Date.now() + days * DAY) })
      .returning()
    return row!
  }

  it('pushes the deadline back on a session that is being used', async () => {
    const row = await sessionExpiringIn(3)
    await readAndRenew(row.id)

    const [after] = await db.select().from(sessions).where(eq(sessions.id, row.id))
    const leftDays = (after!.expiresAt.getTime() - Date.now()) / DAY
    expect(leftDays).toBeGreaterThan(SESSION_DAYS - 1)
  })

  it('leaves a fresh session alone rather than writing on every read', async () => {
    const row = await sessionExpiringIn(SESSION_DAYS)
    const before = row.expiresAt.getTime()
    await readAndRenew(row.id)

    const [after] = await db.select().from(sessions).where(eq(sessions.id, row.id))
    expect(after!.expiresAt.getTime()).toBe(before)
  })

  it('does not resurrect a session that already lapsed', async () => {
    const row = await sessionExpiringIn(-1)
    expect(await readAndRenew(row.id)).toBeNull()

    const [after] = await db.select().from(sessions).where(eq(sessions.id, row.id))
    expect(after!.expiresAt.getTime()).toBeLessThan(Date.now())
  })

  it('renewal keeps the same row, so revoking still works', async () => {
    const row = await sessionExpiringIn(2)
    await readAndRenew(row.id)

    await db.delete(sessions).where(eq(sessions.id, row.id))
    const left = await db.select().from(sessions).where(eq(sessions.id, row.id))
    expect(left).toHaveLength(0)
  })
})
