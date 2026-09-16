import { asc, eq, ne } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import { sessions, users } from '@/lib/db/schema'
import {
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
} from '@/lib/auth/password'
import { ForbiddenError, NotFoundError } from './errors'

/**
 * Accounts an admin can issue a temporary password for.
 *
 * Admins are not in the list. An admin who can reset another admin's password
 * can take that account over, and there is nothing above them to notice — so
 * the one account type that cannot be recovered from this screen is the one
 * that would be worth stealing. An admin who is locked out is recovered out of
 * band, by whoever holds the database.
 */
export async function listResettableAccounts(limit = 200, db: Db = defaultDb) {
  return db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      mustChangePasswordAt: users.mustChangePasswordAt,
    })
    .from(users)
    .where(ne(users.role, 'admin'))
    .orderBy(asc(users.displayName))
    .limit(limit)
}

/**
 * Replaces an account's password with a fresh one-off, and returns it once.
 *
 * Three things happen together and all three matter:
 *
 *  - the old password stops working, because a person who cannot sign in is
 *    usually a person whose password someone else may also have guessed;
 *  - `must_change_password_at` is stamped, so the password the admin just read
 *    out cannot quietly become the account's permanent one;
 *  - every session of that account is deleted, so a browser that was already
 *    signed in does not sail past the change screen.
 *
 * The plaintext is returned, not stored. It exists in the admin's screen and
 * nowhere else; losing it means issuing another one, which is cheap.
 */
export async function issueTemporaryPassword(
  { userId, issuedBy }: { userId: string; issuedBy: string },
  db: Db = defaultDb,
): Promise<{ password: string; displayName: string; email: string }> {
  if (userId === issuedBy) {
    throw new ForbiddenError('An admin cannot issue a temporary password to themselves')
  }

  const [target] = await db
    .select({ id: users.id, role: users.role, displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!target) throw new NotFoundError('No such account')
  if (target.role === 'admin') throw new ForbiddenError('Admin passwords are not reset from here')

  const password = generateTemporaryPassword()
  const passwordHash = await hashPassword(password)

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePasswordAt: new Date(), passwordResetBy: issuedBy })
      .where(eq(users.id, userId))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
  })

  return { password, displayName: target.displayName, email: target.email }
}

/**
 * The owner replacing their own password.
 *
 * The current password is required even when the account is on a temporary
 * one: the point of the change screen is that the person at the keyboard is
 * the person the password was handed to, and skipping the check would turn any
 * unattended signed-in browser into a way to take the account.
 *
 * Clearing `must_change_password_at` is what ends the forced-change state, and
 * it only ever happens here — an admin cannot mark it done on someone's behalf.
 */
export async function changeOwnPassword(
  { userId, current, next }: { userId: string; current: string; next: string },
  db: Db = defaultDb,
): Promise<{ ok: true } | { ok: false; reason: 'wrong-current' | 'too-short' | 'same' }> {
  if (next.length < 8) return { ok: false, reason: 'too-short' }

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) throw new NotFoundError('No such account')

  if (!(await verifyPassword(current, row.passwordHash))) return { ok: false, reason: 'wrong-current' }
  if (await verifyPassword(next, row.passwordHash)) return { ok: false, reason: 'same' }

  const passwordHash = await hashPassword(next)
  await db
    .update(users)
    .set({ passwordHash, mustChangePasswordAt: null, passwordResetBy: null })
    .where(eq(users.id, userId))

  return { ok: true }
}

/**
 * Ends every session of an account.
 *
 * Used on both sides of a password change: when an admin issues a temporary
 * one, and when the owner replaces it. A password is changed partly because
 * somebody else may have been using the old one, and leaving their browser
 * signed in would make the change cosmetic. The person doing the changing gets
 * a fresh session immediately afterwards, so they are not signed out of their
 * own screen.
 */
export async function endAllSessions(userId: string, db: Db = defaultDb): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}
