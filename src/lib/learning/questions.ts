import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  vocabularies,
  vocabularySetItems,
  vocabularyTranslations,
} from '@/lib/db/schema'
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
 * Distractors come from the word's own set first.
 *
 * They used to be drawn from anywhere in the library, which made the questions
 * far easier than they looked: asked for `govern`, a student who saw
 * `refrigeration`, `celebrity` and `magnetic` beside it could cross all three
 * off by topic without knowing the word at all. Words a teacher grouped into
 * one set are the words that turn up together on the paper, and they are
 * exactly the ones worth telling apart.
 *
 * The library is still there as a fallback, for a word in no set or a set too
 * small to fill four options.
 */
export async function buildQuestions(
  userId: string,
  queue: QueueItem[],
  db: Db = defaultDb,
): Promise<RecallQuestion[]> {
  if (!queue.length) return []

  const queueIds = [...new Set(queue.map((q) => q.vocabularyId))]

  const [neighbours, pool] = await Promise.all([
    setNeighbours(queueIds, db),
    libraryPool(db),
  ])

  const questions: RecallQuestion[] = []

  for (const item of queue) {
    const isEnKo = item.direction === 'en_ko'
    const answer = isEnKo ? item.translation : item.lemma
    const prompt = isEnKo ? item.lemma : item.translation

    const usable = (words: PoolWord[]) =>
      words
        .filter((w) => w.vocabularyId !== item.vocabularyId)
        .map((w) => (isEnKo ? w.translation : w.lemma))
        .filter((value) => value && value !== answer)

    // Set first, library only to top up.
    const near = shuffle([...new Set(usable(neighbours.get(item.vocabularyId) ?? []))])
    const far = shuffle([...new Set(usable(pool))])
    const distractors = [...new Set([...near, ...far])].slice(0, OPTION_COUNT - 1)

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

type PoolWord = { vocabularyId: string; lemma: string; translation: string }

/**
 * Every word that shares a set with something in the queue, by queue word.
 *
 * One query for the whole session rather than one per question: a set is a
 * couple of dozen words, and a test is a couple of dozen questions.
 */
async function setNeighbours(
  queueIds: string[],
  db: Db,
): Promise<Map<string, PoolWord[]>> {
  const byWord = new Map<string, PoolWord[]>()
  if (!queueIds.length) return byWord

  const rows = await db
    .select({
      setId: vocabularySetItems.setId,
      vocabularyId: vocabularies.id,
      lemma: vocabularies.lemma,
      translation: vocabularyTranslations.text,
    })
    .from(vocabularySetItems)
    .innerJoin(vocabularies, eq(vocabularies.id, vocabularySetItems.vocabularyId))
    .innerJoin(
      vocabularyTranslations,
      and(
        eq(vocabularyTranslations.vocabularyId, vocabularies.id),
        eq(vocabularyTranslations.isPrimary, true),
      ),
    )
    .where(
      inArray(
        vocabularySetItems.setId,
        db
          .select({ setId: vocabularySetItems.setId })
          .from(vocabularySetItems)
          .where(inArray(vocabularySetItems.vocabularyId, queueIds)),
      ),
    )

  const membersOf = new Map<string, PoolWord[]>()
  const setsOf = new Map<string, string[]>()
  for (const row of rows) {
    const word = { vocabularyId: row.vocabularyId, lemma: row.lemma, translation: row.translation }
    const members = membersOf.get(row.setId)
    if (members) members.push(word)
    else membersOf.set(row.setId, [word])

    const sets = setsOf.get(row.vocabularyId)
    if (sets) sets.push(row.setId)
    else setsOf.set(row.vocabularyId, [row.setId])
  }

  for (const id of queueIds) {
    const words = (setsOf.get(id) ?? []).flatMap((setId) => membersOf.get(setId) ?? [])
    byWord.set(id, words)
  }
  return byWord
}

/** The last resort: any word with a gloss, for a word that is in no set. */
async function libraryPool(db: Db): Promise<PoolWord[]> {
  return db
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
    .limit(400)
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
