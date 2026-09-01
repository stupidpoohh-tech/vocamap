import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import { vocabularies, vocabularyTranslations } from '@/lib/db/schema'
import type { QueueItem } from '@/lib/data/study'
import type { Direction } from './scheduler'

export type RecallQuestion = {
  vocabularyId: string
  direction: Direction
  isNew: boolean
  /** What the student is shown. */
  prompt: string
  /** The correct response. */
  answer: string
  /** Four options including the answer, already shuffled. */
  options: string[]
}

const OPTION_COUNT = 4

/**
 * Turns a due queue into answerable multiple-choice questions.
 *
 * Distractors come from other words in the same student's own vocabulary,
 * because a distractor the student has never seen is not a distractor — it is
 * a giveaway. Falls back to any word in the database when the student's own
 * pool is too small to fill the options.
 */
export async function buildQuestions(
  userId: string,
  queue: QueueItem[],
  db: Db = defaultDb,
): Promise<RecallQuestion[]> {
  if (!queue.length) return []

  const queueIds = [...new Set(queue.map((q) => q.vocabularyId))]

  const pool = await db
    .select({
      vocabularyId: vocabularies.id,
      lemma: vocabularies.lemma,
      translation: vocabularyTranslations.text,
    })
    .from(vocabularies)
    .innerJoin(
      vocabularyTranslations,
      and(
        eq(vocabularyTranslations.vocabularyId, vocabularies.id),
        eq(vocabularyTranslations.isPrimary, true),
      ),
    )
    .where(sql`true`)
    .limit(400)

  const questions: RecallQuestion[] = []

  for (const item of queue) {
    const isEnKo = item.direction === 'en_ko'
    const answer = isEnKo ? item.translation : item.lemma
    const prompt = isEnKo ? item.lemma : item.translation

    const candidates = pool
      .filter((p) => p.vocabularyId !== item.vocabularyId)
      .map((p) => (isEnKo ? p.translation : p.lemma))
      .filter((value) => value && value !== answer)

    const distractors = shuffle([...new Set(candidates)]).slice(0, OPTION_COUNT - 1)

    questions.push({
      vocabularyId: item.vocabularyId,
      direction: item.direction,
      isNew: item.isNew,
      prompt,
      answer,
      options: shuffle([answer, ...distractors]),
    })
  }

  // Interleave rather than grouping by direction: seeing `maintain → 유지하다`
  // immediately followed by `유지하다 → maintain` tests recognition, not recall.
  return interleave(questions, queueIds.length)
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

/** Spreads the two directions of the same word apart within the session. */
function interleave(questions: RecallQuestion[], _wordCount: number): RecallQuestion[] {
  const enKo = questions.filter((q) => q.direction === 'en_ko')
  const koEn = questions.filter((q) => q.direction === 'ko_en')
  const result: RecallQuestion[] = []
  const half = Math.max(enKo.length, koEn.length)
  for (let i = 0; i < half; i += 1) {
    if (enKo[i]) result.push(enKo[i]!)
    if (koEn[i]) result.push(koEn[i]!)
  }
  return result
}
