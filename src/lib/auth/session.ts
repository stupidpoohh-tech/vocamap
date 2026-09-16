import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { sessions, users } from '@/lib/db/schema'
import { SESSION_COOKIE } from './cookie'
import { GUEST_ID } from './guest'

export { SESSION_COOKIE } from './cookie'
export { GUEST_ID } from './guest'
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
 * The cookie carries a signed reference to a `sessions` row *and* the two
 * claims a page needs to start reading: who you are and what you may see.
 *
 * The reference is what makes revocation ("log this student out everywhere") a
 * single DELETE, and it is still checked on every request. The claims are what
 * stop that check from standing in front of everything else — see
 * `readerFromCookie`. Both are signed, so neither can be edited by the holder.
 */
export async function createSession(userId: string, role: Role): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  const [row] = await db.insert(sessions).values({ userId, expiresAt }).returning()
  if (!row) throw new Error('Failed to create session')

  const token = await new SignJWT({ sid: row.id, uid: userId, role })
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

/** Whoever is reading a screen — signed in or not. */
export type Viewer = Actor & { isGuest: boolean }

const GUEST: Viewer = {
  id: GUEST_ID,
  email: '',
  displayName: '',
  role: 'student',
  isGuest: true,
}

/**
 * Who is reading, never null.
 *
 * The screens that only show what a tutor has published — the word list, the
 * maps, a single word — use this instead of `requireActor`, so the app opens
 * without a sign-in wall. Anything that keeps something for you still calls
 * `requireActor`.
 */
export async function getViewer(): Promise<Viewer> {
  const actor = await getActor()
  return actor ? { ...actor, isGuest: false } : GUEST
}

/* ─────────────────── reading the cookie without the database ─────────────────── */

/**
 * Whoever is reading, as the cookie states it — plus the proof, still running.
 *
 * The session row is the authority and is still checked on every request; what
 * changes here is *when*. Awaiting it first put one round trip in front of
 * everything a page reads, and against a database several hops away that round
 * trip is a large share of what a screen costs. So the page starts its reads on
 * the cookie's own claims and awaits `confirm` alongside them: a cookie whose
 * session has been revoked sends the reader to the sign-in page before a single
 * row of it reaches the screen.
 *
 * A cookie issued before the claims existed simply takes the old path.
 */
export type Reader = { id: string; role: Role; isGuest: boolean }

export async function readerFromCookie(): Promise<{
  reader: Reader
  /** Must be awaited before anything read as this reader is rendered. */
  confirm: Promise<void>
}> {
  const claims = await sessionClaims()
  if (!claims) {
    // No cookie, or one from before the claims were embedded in it. Either way
    // the only way to know who this is, is to ask.
    const viewer = await getViewer()
    return {
      reader: { id: viewer.id, role: viewer.role, isGuest: viewer.isGuest },
      confirm: Promise.resolve(),
    }
  }

  const reader: Reader = { id: claims.userId, role: claims.role, isGuest: false }
  const confirm = getActor().then((actual) => {
    // The role is compared too: a cookie signed when this account was a
    // teacher must not keep showing unreviewed drafts after a demotion.
    if (actual?.id !== reader.id || actual.role !== reader.role) redirect('/login')
  })
  return { reader, confirm }
}

/** What the cookie itself says. Signature-checked, but no database read. */
const sessionClaims = cache(async function sessionClaims(): Promise<{
  sid: string
  userId: string
  role: Role
} | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, secret())
    const { sid, uid, role } = payload
    if (typeof sid !== 'string' || typeof uid !== 'string') return null
    if (role !== 'student' && role !== 'teacher' && role !== 'admin') return null
    return { sid, userId: uid, role }
  } catch {
    return null
  }
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
