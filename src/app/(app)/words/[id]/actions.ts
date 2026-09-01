'use server'

import { revalidatePath } from 'next/cache'
import { requireActor, requireRole } from '@/lib/auth/session'
import { logLearningEvent, markImportant, recordNodeAnswer } from '@/lib/data/study'
import { markBrainMapOpened } from '@/lib/data/personal'
import { ensureBrainMap } from '@/lib/data/brain-map'
import type { NodeType } from '@/lib/learning/nodes'

export async function openBrainMap(vocabularyId: string): Promise<void> {
  const actor = await requireActor()
  await markBrainMapOpened(actor.id, vocabularyId)
  await logLearningEvent({
    userId: actor.id,
    vocabularyId,
    kind: 'brain_map_opened',
  })
}

export async function answerNode(input: {
  vocabularyId: string
  node: NodeType
  questionType: 'sentence_translation' | 'similar_battle' | 'collocation_cloze' | 'word_family_cloze'
  correct: boolean
  responseTimeMs: number
  pairId?: string
  payload?: Record<string, unknown>
}): Promise<{ nodeStatus: string }> {
  const actor = await requireActor()
  const result = await recordNodeAnswer({
    userId: actor.id,
    vocabularyId: input.vocabularyId,
    node: input.node,
    questionType: input.questionType,
    correct: input.correct,
    responseTimeMs: input.responseTimeMs,
    pairId: input.pairId ?? null,
    payload: input.payload,
  })
  return { nodeStatus: result.nodeStatus }
}

export async function toggleImportant(
  vocabularyId: string,
  important: boolean,
): Promise<void> {
  const actor = await requireActor()
  await markImportant({
    userId: actor.id,
    vocabularyId,
    important,
    reason: 'student_selected',
    markedBy: actor.id,
  })
  revalidatePath(`/words/${vocabularyId}`)
}

/**
 * Generation is a curator action, not a student one: an LLM call costs money
 * and produces unreviewed content, so students never trigger it.
 */
export async function generateBrainMap(
  vocabularyId: string,
): Promise<{ ok: true; outcome: string } | { ok: false; error: string }> {
  const actor = await requireRole('teacher', 'admin')
  try {
    const result = await ensureBrainMap(vocabularyId, { requestedBy: actor.id })
    revalidatePath(`/words/${vocabularyId}`)
    return { ok: true, outcome: result.outcome }
  } catch (error) {
    // Next.js redacts thrown Server Action errors in production, which would
    // leave the curator staring at "an error occurred". The failure detail is
    // already persisted on the job row, so surfacing the message is safe.
    return { ok: false, error: error instanceof Error ? error.message : '생성에 실패했습니다.' }
  }
}
