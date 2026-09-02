'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/session'
import {
  EditError,
  removeDraftItem,
  saveDraftItem,
  saveMeaningCore,
} from '@/lib/data/brain-map-edit'
import type { ItemKind } from '@/lib/ai'

export type EditResult =
  | { ok: true }
  | { ok: false; message: string; errors?: Record<string, string> }

/**
 * Every write here is curator-only and scoped to one Brain Map. The actor comes
 * from the session, and the data layer refuses an item that does not belong to
 * the map named in the request, so an id alone is never enough.
 */
export async function saveItem(input: {
  brainMapId: string
  vocabularyId: string
  kind: ItemKind
  itemId?: string
  parentId?: string
  values: Record<string, string>
}): Promise<EditResult> {
  const actor = await requireRole('teacher', 'admin')
  try {
    await saveDraftItem({ ...input, actorId: actor.id })
    revalidateAll(input.brainMapId, input.vocabularyId)
    return { ok: true }
  } catch (error) {
    return failure(error)
  }
}

export async function deleteItem(input: {
  brainMapId: string
  vocabularyId: string
  kind: ItemKind
  itemId: string
}): Promise<EditResult> {
  const actor = await requireRole('teacher', 'admin')
  try {
    await removeDraftItem({ ...input, actorId: actor.id })
    revalidateAll(input.brainMapId, input.vocabularyId)
    return { ok: true }
  } catch (error) {
    return failure(error)
  }
}

export async function saveCore(input: {
  brainMapId: string
  vocabularyId: string
  ko: string
  en: string
}): Promise<EditResult> {
  const actor = await requireRole('teacher', 'admin')
  try {
    await saveMeaningCore({ ...input, actorId: actor.id })
    revalidateAll(input.brainMapId, input.vocabularyId)
    return { ok: true }
  } catch (error) {
    return failure(error)
  }
}

function failure(error: unknown): EditResult {
  if (error instanceof EditError) {
    return { ok: false, message: error.message, errors: error.errors }
  }
  return {
    ok: false,
    message: error instanceof Error ? error.message : '저장하지 못했어요.',
  }
}

/** The map the student reads is built from these rows, so it refreshes too. */
function revalidateAll(brainMapId: string, vocabularyId: string): void {
  revalidatePath(`/admin/${brainMapId}`)
  revalidatePath('/admin')
  revalidatePath(`/words/${vocabularyId}`)
}
