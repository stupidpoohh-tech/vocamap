'use server'

import { getActor } from '@/lib/auth/session'
import { recordExtendedAnswer, recordRecallAnswer } from '@/lib/data/study'
import { questionStillStands } from '@/lib/data/brain-map'
import { grade, plausibleResponseTime, verifyQuestion } from '@/lib/learning/question-token'
import { RECORD_AS } from '@/lib/learning/questions'
import { relativeKo } from '@/lib/utils'

export type RejectReason = 'unknown_question' | 'option_not_offered' | 'content_changed'

export type AnswerResult =
  | {
      status: 'saved' | 'guest' | 'duplicate'
      correct: boolean
      nextReviewLabel: string
      retentionPercent: number
      brainMapRecommended: boolean
      recommendationMessage: string | null
    }
  | { status: 'rejected'; reason: RejectReason }
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

  // A map question whose map has moved on is not answerable any more.
  if (claims.contentVersion !== null && claims.contentVersion !== undefined) {
    const stands = await questionStillStands({
      vocabularyId: claims.vocabularyId,
      version: claims.contentVersion,
      itemId: claims.itemId,
    })
    if (!stands) return { status: 'rejected', reason: 'content_changed' }
  }

  const payload = {
    choice: input.choice,
    kind: claims.kind,
    ...(claims.contentVersion ? { mapVersion: claims.contentVersion } : {}),
  }
  const record = RECORD_AS[claims.kind] ?? { fsrs: true as const }

  try {
    // A map question is not basic recall and does not move the recall card.
    // Splitting the questions without splitting the write left the schedule
    // being advanced by collocation answers and the event log calling them
    // gloss answers.
    if (!record.fsrs) {
      const outcome = await recordExtendedAnswer({
        userId: actor.id,
        vocabularyId: claims.vocabularyId,
        node: record.node,
        questionType: record.questionType,
        correct,
        responseTimeMs: plausibleResponseTime(input.responseTimeMs),
        itemId: claims.itemId ?? null,
        submissionId: claims.submissionId,
        payload,
      })
      return {
        status: outcome.recorded ? 'saved' : 'duplicate',
        correct,
        // Nothing was scheduled, so there is no next review to name. Saying one
        // would be reporting a date this answer did not set.
        nextReviewLabel: '',
        retentionPercent: 0,
        brainMapRecommended: false,
        recommendationMessage: null,
      }
    }

    const outcome = await recordRecallAnswer({
      userId: actor.id,
      vocabularyId: claims.vocabularyId,
      direction: claims.direction,
      correct,
      responseTimeMs: plausibleResponseTime(input.responseTimeMs),
      questionType: 'recall_choice',
      submissionId: claims.submissionId,
      payload,
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
