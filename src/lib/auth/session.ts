import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, users } from '@/lib/db/schema'
import { SESSION_COOKIE } from './cookie'

export { SESSION_COOKIE } from './cookie'
const SESSION_DAYS = 30

export type Role = 'student' | 'teacher' | 'admin'

export type Actor = {
  id: string
  email: string
  displayName: string
  role: Role
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters.')
  }
  return new TextEncoder().encode(value)
}

/**
 * The cookie carries a signed reference to a `sessions` row, not the user's
 * claims. That costs one indexed lookup per request but makes revocation
 * ("log this student out everywhere") a single DELETE.
 */
export async function createSession(userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  const [row] = await db.insert(sessions).values({ userId, expiresAt }).returning()
  if (!row) throw new Error('Failed to create session')

  const token = await new SignJWT({ sid: row.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret())

  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  store.delete(SESSION_COOKIE)
  if (!token) return
  try {
    const { payload } = await jwtVerify(token, secret())
    const sid = payload.sid
    if (typeof sid === 'string') await db.delete(sessions).where(eq(sessions.id, sid))
  } catch {
    // Already invalid; the cookie is gone either way.
  }
}

/**
 * Returns the signed-in user, or null. Never throws on a bad cookie.
 *
 * Memoised per request. The layout asks who you are and so does every page
 * inside it, which meant two identical session lookups on every single
 * navigation — one round trip to the database, in series, before anything else
 * could start.
 */
export const getActor = cache(async function getActor(): Promise<Actor | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  let sid: string
  try {
    const { payload } = await jwtVerify(token, secret())
    if (typeof payload.sid !== 'string') return null
    sid = payload.sid
  } catch {
    return null
  }

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sid))
    .limit(1)

  if (!row || row.expiresAt.getTime() < Date.now()) return null
  return { id: row.id, email: row.email, displayName: row.displayName, role: row.role }
})

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) throw new AuthError('Not signed in')
  return actor
}

export async function requireRole(...roles: Role[]): Promise<Actor> {
  const actor = await requireActor()
  if (!roles.includes(actor.role)) throw new AuthError('Insufficient permissions')
  return actor
}

export class AuthError extends Error {
  readonly code = 'AUTH'
}
