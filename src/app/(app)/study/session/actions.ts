'use server'

import { requireActor } from '@/lib/auth/session'
import { recordRecallAnswer } from '@/lib/data/study'
import type { Direction } from '@/lib/learning/scheduler'
import { relativeKo } from '@/lib/utils'

export type AnswerResult = {
  correct: boolean
  nextReviewLabel: string
  retentionPercent: number
  brainMapRecommended: boolean
  recommendationMessage: string | null
}

/**
 * The one write the study loop performs. The user id comes from the session
 * cookie, never from the client — a student cannot submit answers as anyone
 * else no matter what the page posts.
 */
export async function submitAnswer(input: {
  vocabularyId: string
  direction: Direction
  correct: boolean
  responseTimeMs: number
  choice?: string
}): Promise<AnswerResult> {
  const actor = await requireActor()

  const outcome = await recordRecallAnswer({
    userId: actor.id,
    vocabularyId: input.vocabularyId,
    direction: input.direction,
    correct: input.correct,
    responseTimeMs: input.responseTimeMs,
    questionType: 'recall_choice',
    payload: input.choice ? { choice: input.choice } : undefined,
  })

  return {
    correct: input.correct,
    nextReviewLabel: relativeKo(outcome.nextDueAt),
    retentionPercent: Math.round(outcome.estimatedRetention * 100),
    brainMapRecommended: outcome.brainMapRecommended,
    recommendationMessage: outcome.recommendationMessage,
  }
}
