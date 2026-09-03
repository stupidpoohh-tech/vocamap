'use server'

import { redirect } from 'next/navigation'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { createSession, destroySession } from '@/lib/auth/session'
import { isConnectionFailure } from '@/lib/db/errors'

export type AuthFormState = { error?: string }

/**
 * Where to land after signing in.
 *
 * Only a path within this app is accepted — a `next` that starts with `//` or
 * carries a scheme is somebody else's site, and following it would turn the
 * sign-in screen into an open redirect. Anything suspect falls back to the
 * reader's own home screen.
 */
function destinationFrom(formData: FormData, role: string): string {
  const next = String(formData.get('next') ?? '')
  if (next.startsWith('/') && !next.startsWith('//')) return next
  return role === 'student' ? '/study' : '/teacher'
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  if (!email || !password) return { error: '이메일과 비밀번호를 입력해 주세요.' }

  let destination: string
  // Everything that can fail lives in here; `redirect` throws a control-flow
  // signal that must not be swallowed, so it stays outside.
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)

    // Same message either way: distinguishing them tells an attacker which
    // addresses are registered.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return { error: '이메일 또는 비밀번호가 올바르지 않습니다.' }
    }

    await createSession(user.id)
    destination = destinationFrom(formData, user.role)
  } catch (error) {
    return { error: describeFailure(error, 'signIn') }
  }

  redirect(destination)
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const displayName = String(formData.get('displayName') ?? '').trim()
  const role = String(formData.get('role') ?? 'student')

  if (!email.includes('@')) return { error: '올바른 이메일을 입력해 주세요.' }
  if (password.length < 8) return { error: '비밀번호는 8자 이상이어야 합니다.' }
  if (!displayName) return { error: '이름을 입력해 주세요.' }
  if (role !== 'student' && role !== 'teacher') return { error: '역할이 올바르지 않습니다.' }

  let destination: string
  try {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
    if (existing) return { error: '이미 가입된 이메일입니다.' }

    const [created] = await db
      .insert(users)
      .values({
        email,
        displayName,
        role,
        passwordHash: await hashPassword(password),
      })
      .returning({ id: users.id, role: users.role })
    if (!created) return { error: '가입에 실패했습니다. 다시 시도해 주세요.' }

    await createSession(created.id)
    destination = destinationFrom(formData, created.role)
  } catch (error) {
    return { error: describeFailure(error, 'signUp') }
  }

  redirect(destination)
}

export async function signOut(): Promise<void> {
  await destroySession()
  // Back to the app, not to the login form. There is no landing page any more,
  // and signing out should not look like an invitation to sign straight back
  // in — the word list reads perfectly well as a guest.
  redirect('/')
}

/**
 * Turns an unexpected failure into something the person in front of the screen
 * can act on, and puts the real cause in the Worker log.
 *
 * Without this the action simply throws, Next.js redacts it in production, and
 * the browser shows an unexplained 500 — which is exactly how a database that
 * was never reachable looked like a broken sign-up form.
 */
function describeFailure(error: unknown, where: string): string {
  console.error(`[auth:${where}]`, error)

  if (isConnectionFailure(error)) {
    return '데이터베이스에 연결하지 못했습니다. 관리자는 /api/health 에서 상태를 확인해 주세요.'
  }
  return '처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'
}
