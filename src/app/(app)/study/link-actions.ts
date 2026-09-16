'use server'

import { revalidatePath } from 'next/cache'
import { requireActor, requireRole } from '@/lib/auth/session'
import {
  acceptTeacherLink,
  approveLinkAsAdmin,
  revokeTeacherLink,
} from '@/lib/data/teacher'

export type LinkDecisionState = { error?: string; message?: string }

/**
 * The student's answer to a teacher's request.
 *
 * Both actions take the signed-in account from the session and pass it down as
 * part of the WHERE clause, never as something the form supplies. A teacher who
 * calls this directly with a link id they guessed matches no row: the update is
 * scoped to links whose `student_id` is the caller.
 */
export async function acceptLink(linkId: string): Promise<LinkDecisionState> {
  const actor = await requireActor()
  const ok = await acceptTeacherLink(linkId, actor.id)
  revalidatePath('/study')
  return ok
    ? { message: '선생님과 연결했습니다.' }
    : { error: '처리할 요청을 찾지 못했습니다.' }
}

export async function declineLink(linkId: string): Promise<LinkDecisionState> {
  const actor = await requireActor()
  const ok = await revokeTeacherLink(linkId, actor.id)
  revalidatePath('/study')
  return ok ? { message: '요청을 거절했습니다.' } : { error: '처리할 요청을 찾지 못했습니다.' }
}

/**
 * An admin approving on a student's behalf — for a student who cannot do it
 * themselves. Separate action, separate role check, and it records the admin as
 * the consenting party rather than pretending the student clicked.
 */
export async function approveLinkForStudent(linkId: string): Promise<LinkDecisionState> {
  const admin = await requireRole('admin')
  const ok = await approveLinkAsAdmin(linkId, admin.id)
  revalidatePath('/study')
  revalidatePath('/teacher')
  return ok ? { message: '연결을 승인했습니다.' } : { error: '처리할 요청을 찾지 못했습니다.' }
}
