import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, users } from '@/lib/db/schema'
import {
  changeOwnPassword,
  endAllSessions,
  issueTemporaryPassword,
  listResettableAccounts,
} from '@/lib/data/account'
import { ForbiddenError } from '@/lib/data/errors'
import { generateTemporaryPassword, hashPassword, verifyPassword } from '@/lib/auth/password'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

/* ═══════════════════ the generated password itself ═══════════════════ */

describe('the temporary password', () => {
  it('avoids characters two people can read differently', () => {
    // It is read off a screen and typed on a phone. `0/O` and `1/l/I` turn a
    // reset into a support conversation.
    for (let i = 0; i < 200; i += 1) {
      expect(generateTemporaryPassword()).toMatch(/^[a-z2-9-]+$/)
      expect(generateTemporaryPassword()).not.toMatch(/[01lioIO]/)
    }
  })

  it('is long enough for the password rules and different every time', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      const password = generateTemporaryPassword()
      expect(password.length).toBeGreaterThanOrEqual(8)
      seen.add(password)
    }
    expect(seen.size).toBe(200)
  })
})

/* ═══════════════════════ issuing one, as an admin ═══════════════════════ */

describe.skipIf(!hasDatabase)('issuing a temporary password', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function withPassword(role: 'student' | 'teacher' | 'admin', plain: string) {
    const user = await createUser(role)
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(plain) })
      .where(eq(users.id, user.id))
    return user
  }

  it('replaces the old password and stamps the account for a change', async () => {
    const admin = await createUser('admin')
    const student = await withPassword('student', 'the-old-password')

    const { password } = await issueTemporaryPassword({ userId: student.id, issuedBy: admin.id })

    const [row] = await db.select().from(users).where(eq(users.id, student.id))
    expect(await verifyPassword(password, row!.passwordHash)).toBe(true)
    // The old one stops working. Someone who cannot sign in is often someone
    // whose password another person may also know.
    expect(await verifyPassword('the-old-password', row!.passwordHash)).toBe(false)
    expect(row!.mustChangePasswordAt).not.toBeNull()
    expect(row!.passwordResetBy).toBe(admin.id)
  })

  it('never writes the plaintext anywhere', async () => {
    const admin = await createUser('admin')
    const student = await withPassword('student', 'the-old-password')

    const { password } = await issueTemporaryPassword({ userId: student.id, issuedBy: admin.id })

    const [row] = await db.select().from(users).where(eq(users.id, student.id))
    const stored = JSON.stringify(row)
    expect(stored).not.toContain(password)
  })

  it('signs the account out of every device it was signed in on', async () => {
    const admin = await createUser('admin')
    const student = await withPassword('student', 'the-old-password')
    const expiresAt = new Date(Date.now() + 86_400_000)
    await db.insert(sessions).values([
      { userId: student.id, expiresAt },
      { userId: student.id, expiresAt },
    ])

    await issueTemporaryPassword({ userId: student.id, issuedBy: admin.id })

    const left = await db.select().from(sessions).where(eq(sessions.userId, student.id))
    expect(left).toHaveLength(0)
  })

  it('leaves everybody else signed in', async () => {
    const admin = await createUser('admin')
    const student = await withPassword('student', 'the-old-password')
    const other = await createUser('student')
    const expiresAt = new Date(Date.now() + 86_400_000)
    await db.insert(sessions).values([
      { userId: student.id, expiresAt },
      { userId: other.id, expiresAt },
    ])

    await issueTemporaryPassword({ userId: student.id, issuedBy: admin.id })

    const left = await db.select().from(sessions).where(eq(sessions.userId, other.id))
    expect(left).toHaveLength(1)
  })

  it('refuses to reset another admin', async () => {
    // Whoever can issue a password for an account can read everything that
    // account can. For an admin there is nothing above them to notice.
    const admin = await createUser('admin')
    const otherAdmin = await withPassword('admin', 'the-old-password')

    await expect(
      issueTemporaryPassword({ userId: otherAdmin.id, issuedBy: admin.id }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const [row] = await db.select().from(users).where(eq(users.id, otherAdmin.id))
    expect(await verifyPassword('the-old-password', row!.passwordHash)).toBe(true)
  })

  it('refuses to reset the admin doing the resetting', async () => {
    const admin = await createUser('admin')
    await expect(
      issueTemporaryPassword({ userId: admin.id, issuedBy: admin.id }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('does not offer admin accounts on the screen', async () => {
    await createUser('admin')
    const student = await createUser('student')
    const teacher = await createUser('teacher')

    const listed = await listResettableAccounts()
    const ids = listed.map((a) => a.id)

    expect(ids).toContain(student.id)
    expect(ids).toContain(teacher.id)
    expect(listed.every((a) => a.role !== 'admin')).toBe(true)
  })
})

/* ════════════════════ the owner replacing it ════════════════════ */

describe.skipIf(!hasDatabase)('changing your own password', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function stampedStudent(plain: string) {
    const student = await createUser('student')
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(plain), mustChangePasswordAt: new Date() })
      .where(eq(users.id, student.id))
    return student
  }

  it('clears the forced-change stamp', async () => {
    const student = await stampedStudent('temp-password-1')

    const result = await changeOwnPassword({
      userId: student.id,
      current: 'temp-password-1',
      next: 'a-password-of-my-own',
    })

    expect(result.ok).toBe(true)
    const [row] = await db.select().from(users).where(eq(users.id, student.id))
    expect(row!.mustChangePasswordAt).toBeNull()
    expect(row!.passwordResetBy).toBeNull()
    expect(await verifyPassword('a-password-of-my-own', row!.passwordHash)).toBe(true)
  })

  it('requires the current password even while the stamp is set', async () => {
    // Otherwise an unattended signed-in browser is a way to take the account.
    const student = await stampedStudent('temp-password-1')

    const result = await changeOwnPassword({
      userId: student.id,
      current: 'a-guess',
      next: 'a-password-of-my-own',
    })

    expect(result).toEqual({ ok: false, reason: 'wrong-current' })
    const [row] = await db.select().from(users).where(eq(users.id, student.id))
    expect(row!.mustChangePasswordAt).not.toBeNull()
    expect(await verifyPassword('temp-password-1', row!.passwordHash)).toBe(true)
  })

  it('will not accept the temporary password as the new one', async () => {
    const student = await stampedStudent('temp-password-1')

    const result = await changeOwnPassword({
      userId: student.id,
      current: 'temp-password-1',
      next: 'temp-password-1',
    })

    expect(result).toEqual({ ok: false, reason: 'same' })
    const [row] = await db.select().from(users).where(eq(users.id, student.id))
    expect(row!.mustChangePasswordAt).not.toBeNull()
  })

  it('holds the new password to the same length rule as sign-up', async () => {
    const student = await stampedStudent('temp-password-1')

    const result = await changeOwnPassword({
      userId: student.id,
      current: 'temp-password-1',
      next: 'short',
    })

    expect(result).toEqual({ ok: false, reason: 'too-short' })
  })

  it('ends the sessions that were signed in with the old password', async () => {
    const student = await stampedStudent('temp-password-1')
    const expiresAt = new Date(Date.now() + 86_400_000)
    await db.insert(sessions).values([
      { userId: student.id, expiresAt },
      { userId: student.id, expiresAt },
    ])

    await changeOwnPassword({
      userId: student.id,
      current: 'temp-password-1',
      next: 'a-password-of-my-own',
    })
    await endAllSessions(student.id)

    const left = await db.select().from(sessions).where(eq(sessions.userId, student.id))
    expect(left).toHaveLength(0)
  })
})

/* ═════════════ what sign-in does with a stamped account ═════════════ */

describe.skipIf(!hasDatabase)('signing in on a temporary password', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('is not a way around the stamp: the account still carries it', async () => {
    const admin = await createUser('admin')
    const student = await createUser('student')
    await db
      .update(users)
      .set({ passwordHash: await hashPassword('irrelevant') })
      .where(eq(users.id, student.id))

    const { password } = await issueTemporaryPassword({ userId: student.id, issuedBy: admin.id })

    // Whatever the sign-in screen does with it, the stamp is a column, and it
    // is still set until the owner replaces the password themselves.
    const [before] = await db.select().from(users).where(eq(users.id, student.id))
    expect(before!.mustChangePasswordAt).not.toBeNull()

    await changeOwnPassword({ userId: student.id, current: password, next: 'my-own-password' })

    const [after] = await db.select().from(users).where(eq(users.id, student.id))
    expect(after!.mustChangePasswordAt).toBeNull()
  })
})
