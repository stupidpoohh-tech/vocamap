'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/session'
import { ensureBrainMap, setBrainMapStatus } from '@/lib/data/brain-map'

export async function reviewBrainMap(
  brainMapId: string,
  status: 'approved' | 'rejected' | 'needs_review',
  note?: string,
): Promise<void> {
  const actor = await requireRole('teacher', 'admin')
  await setBrainMapStatus(brainMapId, status, actor.id, note ?? null)
  revalidatePath('/admin')
  revalidatePath(`/admin/${brainMapId}`)
}

/** Discards the current draft and asks the model again. */
export async function regenerate(
  vocabularyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireRole('teacher', 'admin')
  try {
    await ensureBrainMap(vocabularyId, { requestedBy: actor.id, force: true })
    revalidatePath('/admin')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '재생성에 실패했습니다.' }
  }
}
