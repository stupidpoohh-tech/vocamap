'use server'

import { revalidatePath } from 'next/cache'
import { getActor, requireRole } from '@/lib/auth/session'
import { NEEDS_LOGIN, WROTE, type WriteResult } from '@/lib/auth/write-result'
import { logLearningEvent, markImportant, recordNodeAnswer } from '@/lib/data/study'
import { markBrainMapOpened } from '@/lib/data/personal'
import { ensureBrainMap } from '@/lib/data/brain-map'
import type { NodeType } from '@/lib/learning/nodes'

/**
 * Progress writes, and what a guest does with them.
 *
 * Opening a map and answering a question fire on their own as the reader works.
 * A guest has nowhere to record them, so they do nothing — the screen still
 * behaves, and the reader is told once, on the screen itself, that a guest's
 * progress is not kept. Interrupting every answer with a sign-in prompt would
 * be a wall built out of nagging instead of out of a landing page.
 */
export async function openBrainMap(vocabularyId: string): Promise<void> {
  const actor = await getActor()
  if (!actor) return
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
  const actor = await getActor()
  // Nothing to record against, but the answer still stands on screen.
  if (!actor) return { nodeStatus: input.correct ? 'learning' : 'weak' }

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
): Promise<WriteResult> {
  const actor = await getActor()
  if (!actor) return NEEDS_LOGIN

  await markImportant({
    userId: actor.id,
    vocabularyId,
    important,
    reason: 'student_selected',
    markedBy: actor.id,
  })
  revalidatePath(`/words/${vocabularyId}`)
  return WROTE
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

    // `in_progress` means another request holds the word — refreshing shows
    // nothing, so saying "done" would be a lie. Report it as its own outcome.
    if (result.outcome === 'in_progress') {
      return {
        ok: false,
        error: '다른 생성 작업이 진행 중입니다. 잠시 후 다시 눌러 주세요.',
      }
    }
    return { ok: true, outcome: result.outcome }
  } catch (error) {
    // Next.js redacts thrown Server Action errors in production, which would
    // leave the curator staring at "an error occurred". The failure detail is
    // already persisted on the job row, so surfacing the message is safe.
    return { ok: false, error: error instanceof Error ? error.message : '생성에 실패했습니다.' }
  }
}
