'use server'

import { redirect } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { createSession } from '@/lib/auth/session'
import { changeOwnPassword, endAllSessions } from '@/lib/data/account'
import { isConnectionFailure } from '@/lib/db/errors'

export type PasswordFormState = { error?: string }

/**
 * The owner replacing their own password.
 *
 * Every session of the account is deleted and a fresh one is issued to this
 * browser. That is what makes the change mean something: a temporary password
 * was, by definition, known to someone else, and anyone still signed in with it
 * is signed out here.
 */
export async function changePassword(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const current = String(formData.get('current') ?? '')
  const next = String(formData.get('next') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  const destination = safeNext(String(formData.get('destination') ?? ''))

  if (!current || !next) return { error: '현재 비밀번호와 새 비밀번호를 입력해 주세요.' }
  if (next !== confirm) return { error: '새 비밀번호가 서로 다릅니다.' }

  try {
    const actor = await requireActor()
    const result = await changeOwnPassword({ userId: actor.id, current, next })
    if (!result.ok) return { error: REASON[result.reason] }

    await endAllSessions(actor.id)
    await createSession(actor.id, actor.role)
  } catch (error) {
    console.error('[account:changePassword]', error)
    if (isConnectionFailure(error)) {
      return { error: '데이터베이스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
    }
    return { error: '처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' }
  }

  redirect(destination)
}

const REASON: Record<'wrong-current' | 'too-short' | 'same', string> = {
  'wrong-current': '현재 비밀번호가 올바르지 않습니다.',
  'too-short': '새 비밀번호는 8자 이상이어야 합니다.',
  same: '지금 쓰고 있는 비밀번호와 같습니다. 다른 비밀번호를 정해 주세요.',
}

/** Same rule as sign-in: a path inside this app, or the student's own home. */
function safeNext(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/study'
}
