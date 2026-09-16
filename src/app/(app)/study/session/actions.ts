'use server'

import { getActor } from '@/lib/auth/session'
import { recordRecallAnswer } from '@/lib/data/study'
import { grade, plausibleResponseTime, verifyQuestion } from '@/lib/learning/question-token'
import type { QuestionKind } from '@/lib/learning/questions'
import { relativeKo } from '@/lib/utils'

export type AnswerResult =
  | {
      status: 'saved' | 'guest' | 'duplicate'
      correct: boolean
      nextReviewLabel: string
      retentionPercent: number
      brainMapRecommended: boolean
      recommendationMessage: string | null
    }
  | { status: 'rejected'; reason: 'unknown_question' | 'option_not_offered' }
  | { status: 'failed'; correct: boolean; message: string }

/**
 * The one write the study loop performs.
 *
 * The user id comes from the session cookie and the grade comes from the token,
 * so neither is anything the page can choose. It used to post `correct` as a
 * boolean it had worked out itself — which meant the schedule that is supposed
 * to measure what somebody can recall recorded whatever their browser said,
 * for any word, as often as it liked.
 *
 * A guest is welcome to take the test; there is simply nowhere to schedule the
 * next review, so the result comes back graded but unsaved and the session
 * screen says so.
 */
export async function submitAnswer(input: {
  token: string
  choice: string
  responseTimeMs?: number
}): Promise<AnswerResult> {
  const claims = await verifyQuestion(input.token)
  // Not a question this server asked, or one asked too long ago. Not a wrong
  // answer — there is nothing here to be wrong about, and writing a lapse into
  // somebody's schedule on the strength of an unaccountable request is the
  // thing being prevented.
  if (!claims) return { status: 'rejected', reason: 'unknown_question' }

  const { offered, correct } = grade(claims, input.choice)
  if (!offered) return { status: 'rejected', reason: 'option_not_offered' }

  const actor = await getActor()
  if (!actor) {
    return {
      status: 'guest',
      correct,
      nextReviewLabel: '',
      retentionPercent: 0,
      brainMapRecommended: false,
      recommendationMessage: null,
    }
  }

  // A token minted for one reader answered by another is not a submission to
  // record. It cannot happen by accident, so it is refused rather than
  // re-attributed.
  if (claims.userId !== actor.id) return { status: 'rejected', reason: 'unknown_question' }

  try {
    const outcome = await recordRecallAnswer({
      userId: actor.id,
      vocabularyId: claims.vocabularyId,
      direction: claims.direction,
      correct,
      responseTimeMs: plausibleResponseTime(input.responseTimeMs),
      questionType: 'recall_choice',
      submissionId: claims.submissionId,
      // What was actually asked, kept beside the answer. The card and the
      // question type say "recall, multiple choice"; this says which of the
      // ways a mapped word can be asked it was, and which version of the map it
      // came from.
      payload: {
        choice: input.choice,
        kind: claims.kind satisfies QuestionKind,
        ...(claims.contentVersion ? { mapVersion: claims.contentVersion } : {}),
      },
    })

    return {
      status: outcome.recorded ? 'saved' : 'duplicate',
      correct,
      nextReviewLabel: relativeKo(outcome.nextDueAt),
      retentionPercent: Math.round(outcome.estimatedRetention * 100),
      brainMapRecommended: outcome.brainMapRecommended,
      recommendationMessage: outcome.recommendationMessage,
    }
  } catch (error) {
    // The grade is already decided and the reader is entitled to see it. What
    // they must not be told is that it was saved.
    console.error('[study:submitAnswer]', error)
    return {
      status: 'failed',
      correct,
      message: '결과를 저장하지 못했어요.',
    }
  }
}
