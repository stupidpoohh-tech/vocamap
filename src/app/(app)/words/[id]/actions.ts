'use server'

import { revalidatePath } from 'next/cache'
import { getActor, requireCurator } from '@/lib/auth/session'
import { NEEDS_LOGIN, WROTE, type WriteResult } from '@/lib/auth/write-result'
import { logLearningEvent, markImportant, recordExtendedAnswer } from '@/lib/data/study'
import { questionStillStands } from '@/lib/data/brain-map'
import { grade, plausibleResponseTime, verifyQuestion } from '@/lib/learning/question-token'
import { NODE_TYPES } from '@/lib/learning/nodes'
import type { RejectReason } from '@/app/(app)/study/session/actions'
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

/**
 * An answer to one of the map's own questions.
 *
 * The same boundary the study session has, for the same reason. This used to
 * take `correct`, `vocabularyId`, `node` and `questionType` from the request:
 * anything that could reach the action could mark any node of any word correct,
 * for anyone's account, as many times as it liked, and the node's mastery and
 * the word's recommendation both moved on the strength of it.
 *
 * Now the only thing the page chooses is which option it tapped. Everything
 * else — whose answer it is, which word, which item, which node, and whether it
 * is right — comes out of the token the server signed when it built the card.
 */
export async function answerNode(input: {
  token: string
  choice: string
  responseTimeMs?: number
}): Promise<
  | { status: 'saved' | 'duplicate' | 'guest'; correct: boolean; nodeStatus: string | null }
  | { status: 'rejected'; reason: RejectReason }
  | { status: 'failed'; correct: boolean }
> {
  const claims = await verifyQuestion(input.token)
  if (!claims) return { status: 'rejected', reason: 'unknown_question' }

  const { offered, correct } = grade(claims, input.choice)
  if (!offered) return { status: 'rejected', reason: 'option_not_offered' }

  const actor = await getActor()
  // Nothing to record against, but the answer still stands on screen.
  if (!actor) return { status: 'guest', correct, nodeStatus: null }
  if (claims.userId !== actor.id) return { status: 'rejected', reason: 'unknown_question' }

  const node = claims.node
  if (!node || !NODE_TYPES.includes(node as NodeType)) {
    return { status: 'rejected', reason: 'unknown_question' }
  }

  // The card was built from a map that has since changed, or from an item a
  // curator has deleted. Refusing is the honest answer: there is nothing left
  // to be right or wrong about.
  const stands = await questionStillStands({
    vocabularyId: claims.vocabularyId,
    version: claims.contentVersion ?? null,
    itemId: claims.itemId,
  })
  if (!stands) return { status: 'rejected', reason: 'content_changed' }

  try {
    const result = await recordExtendedAnswer({
      userId: actor.id,
      vocabularyId: claims.vocabularyId,
      node: node as NodeType,
      questionType: QUESTION_TYPE_FOR_NODE[node as NodeType],
      correct,
      responseTimeMs: plausibleResponseTime(input.responseTimeMs),
      itemId: claims.itemId ?? null,
      submissionId: claims.submissionId,
      payload: { choice: input.choice, mapVersion: claims.contentVersion ?? null },
    })
    return {
      status: result.recorded ? 'saved' : 'duplicate',
      correct,
      nodeStatus: result.nodeStatus,
    }
  } catch (error) {
    console.error('[map:answerNode]', error)
    return { status: 'failed', correct }
  }
}

/** Which question type each node's cards are recorded as. */
const QUESTION_TYPE_FOR_NODE: Record<
  NodeType,
  'sentence_translation' | 'similar_battle' | 'collocation_cloze' | 'word_family_cloze'
> = {
  meaning_core: 'sentence_translation',
  sentences: 'sentence_translation',
  similar_words: 'similar_battle',
  collocations: 'collocation_cloze',
  word_family: 'word_family_cloze',
}

/**
 * The reader looked at a translation. Recorded as that, and only that.
 *
 * There is no grade here to record: nothing was asked and nothing was judged.
 * It goes to the learning-event log — which exists for exactly this, things
 * that happened without being scored — and touches neither `review_events`,
 * nor the node's progress, nor any FSRS card. Reading a card must not be able
 * to move a schedule.
 */
export async function revealNode(input: {
  vocabularyId: string
  node: NodeType
  payload?: Record<string, unknown>
}): Promise<void> {
  const actor = await getActor()
  if (!actor) return
  await logLearningEvent({
    userId: actor.id,
    vocabularyId: input.vocabularyId,
    kind: 'map_reading_revealed',
    payload: { node: input.node, ...(input.payload ?? {}) },
  })
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
  const actor = await requireCurator()
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
