'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { requireCurator, requireRole } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { ensureBrainMap, setBrainMapStatus } from '@/lib/data/brain-map'

export async function reviewBrainMap(
  brainMapId: string,
  status: 'approved' | 'rejected' | 'needs_review',
  note?: string,
): Promise<void> {
  const actor = await requireCurator()
  await setBrainMapStatus(brainMapId, status, actor.id, note ?? null)
  revalidatePath('/admin')
  revalidatePath(`/admin/${brainMapId}`)
}

/** Discards the current draft and asks the model again. */
export async function regenerate(
  vocabularyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireCurator()
  try {
    await ensureBrainMap(vocabularyId, { requestedBy: actor.id, force: true })
    revalidatePath('/admin')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '재생성에 실패했습니다.' }
  }
}

/* ─────────────────────────── teacher accounts ─────────────────────────── */

/**
 * The only way an account becomes a curator.
 *
 * Sign-up used to take the role from the form, which put "can write and approve
 * the maps everyone studies from" behind a dropdown on a public page. It now
 * always makes a student, and this is the replacement: an admin, signed in,
 * naming the person.
 *
 * Granting sets both the role and the verification stamp — an admin doing this
 * deliberately is the check that `teacher_verified_at` records. Existing
 * `teacher` rows are left unverified by the migration precisely because nobody
 * can say who granted them.
 */
export async function grantTeacherRole(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireRole('admin')
  if (admin.id === userId) return { ok: false, error: '자기 자신은 변경할 수 없습니다.' }

  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!target) return { ok: false, error: '해당 사용자가 없습니다.' }
  if (target.role === 'admin') return { ok: false, error: '관리자 계정은 변경하지 않습니다.' }

  await db
    .update(users)
    .set({ role: 'teacher', teacherVerifiedAt: new Date(), teacherVerifiedBy: admin.id })
    .where(eq(users.id, userId))

  revalidatePath('/admin/teachers')
  return { ok: true }
}

/**
 * Takes the curator powers away without touching the account or its work.
 *
 * The role stays `teacher` so nothing that references it changes meaning; what
 * goes is the verification, which `requireCurator` reads on every call. Maps
 * they wrote, sets they built and students linked to them are all left alone.
 */
export async function revokeTeacherVerification(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireRole('admin')
  if (admin.id === userId) return { ok: false, error: '자기 자신은 변경할 수 없습니다.' }

  await db
    .update(users)
    .set({ teacherVerifiedAt: null, teacherVerifiedBy: null })
    .where(and(eq(users.id, userId), eq(users.role, 'teacher')))

  revalidatePath('/admin/teachers')
  return { ok: true }
}
