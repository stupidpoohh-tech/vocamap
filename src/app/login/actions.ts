'use server'

import { redirect } from 'next/navigation'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { createSession, destroySession } from '@/lib/auth/session'

export type AuthFormState = { error?: string }

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  if (!email || !password) return { error: '이메일과 비밀번호를 입력해 주세요.' }

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
  redirect(user.role === 'student' ? '/study' : '/teacher')
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
  redirect(created.role === 'student' ? '/study' : '/teacher')
}

export async function signOut(): Promise<void> {
  await destroySession()
  redirect('/login')
}
