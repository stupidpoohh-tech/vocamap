import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  brainMaps,
  reviewEvents,
  userVocabularyState,
  vocabularies,
  vocabularySetItems,
  vocabularyTranslations,
} from '@/lib/db/schema'
import type { BrainMapState } from './vocabulary'

/**
 * The word list, sliced the way each of the three student screens needs it.
 *
 * One query shape serves all of them on purpose. "Saved", "wrong" and "has a
 * map" are properties of a word, not different kinds of thing, so a student who
 * finds a word in the vault and a teacher who finds it in the map queue are
 * looking at the same row with the same star and the same meaning.
 */
export type WordScope =
  /** Everything a teacher has uploaded — the study book. */
  | 'all'
  /** Starred. */
  | 'saved'
  /** Answered wrong at least once. */
  | 'wrong'
  /** Has a Brain Map the student can open. */
  | 'mapped'
  /** Has a map awaiting review. Curators only. */
  | 'mapPending'
  /** Has no map at all. Curators only — this is the generation queue. */
  | 'mapMissing'

export type StudyWord = {
  id: string
  lemma: string
  translation: string | null
  bookmarked: boolean
  wrongCount: number
  lastWrongAt: Date | null
  mapStatus: BrainMapState
}

export type ListWordsOptions = {
  userId: string
  scope: WordScope
  setId?: string
  query?: string
  /** Restricts to words that are also starred. Powers "저장한 맵". */
  savedOnly?: boolean
  limit?: number
}

export const WORD_LIST_LIMIT = 300

export async function listStudyWords(
  opts: ListWordsOptions,
  db: Db = defaultDb,
): Promise<StudyWord[]> {
  // Wrong answers are counted from the event log rather than from the FSRS
  // card: a lapse count tells you the scheduler demoted the card, not which
  // words the student actually got wrong, and the vault is about the latter.
  const wrong = db.$with('wrong').as(
    db
      .select({
        vocabularyId: reviewEvents.vocabularyId,
        wrongCount: sql<number>`count(*)::int`.as('wrong_count'),
        lastWrongAt: sql<Date>`max(${reviewEvents.reviewedAt})`.as('last_wrong_at'),
      })
      .from(reviewEvents)
      .where(and(eq(reviewEvents.userId, opts.userId), eq(reviewEvents.correct, false)))
      .groupBy(reviewEvents.vocabularyId),
  )

  const filters = [scopeFilter(opts.scope, wrong)]
  if (opts.savedOnly) filters.push(isNotNull(userVocabularyState.bookmarkedAt))
  if (opts.setId) {
    filters.push(
      inArray(
        vocabularies.id,
        db
          .select({ id: vocabularySetItems.vocabularyId })
          .from(vocabularySetItems)
          .where(eq(vocabularySetItems.setId, opts.setId)),
      ),
    )
  }
  const search = opts.query?.trim()
  if (search) filters.push(searchFilter(search))

  const rows = await db
    .with(wrong)
    .select({
      id: vocabularies.id,
      lemma: vocabularies.lemma,
      translation: vocabularyTranslations.text,
      status: brainMaps.status,
      bookmarkedAt: userVocabularyState.bookmarkedAt,
      wrongCount: wrong.wrongCount,
      lastWrongAt: wrong.lastWrongAt,
    })
    .from(vocabularies)
    .leftJoin(
      vocabularyTranslations,
      and(
        eq(vocabularyTranslations.vocabularyId, vocabularies.id),
        eq(vocabularyTranslations.isPrimary, true),
      ),
    )
    .leftJoin(brainMaps, eq(brainMaps.vocabularyId, vocabularies.id))
    .leftJoin(
      userVocabularyState,
      and(
        eq(userVocabularyState.vocabularyId, vocabularies.id),
        eq(userVocabularyState.userId, opts.userId),
      ),
    )
    .leftJoin(wrong, eq(wrong.vocabularyId, vocabularies.id))
    .where(and(...filters))
    .orderBy(...ordering(opts.scope, wrong))
    .limit(opts.limit ?? WORD_LIST_LIMIT)

  return rows.map((row) => ({
    id: row.id,
    lemma: row.lemma,
    translation: row.translation,
    bookmarked: row.bookmarkedAt !== null,
    wrongCount: row.wrongCount ?? 0,
    lastWrongAt: row.lastWrongAt ?? null,
    mapStatus: row.status === 'approved' ? 'approved' : row.status ? 'draft' : 'none',
  }))
}

/** Just the ids, for building a test out of a list the student is looking at. */
export async function scopedWordIds(
  opts: ListWordsOptions,
  db: Db = defaultDb,
): Promise<string[]> {
  const words = await listStudyWords(opts, db)
  return words.map((w) => w.id)
}

function scopeFilter(scope: WordScope, wrong: { wrongCount: unknown }) {
  switch (scope) {
    case 'saved':
      return isNotNull(userVocabularyState.bookmarkedAt)
    case 'wrong':
      return sql`coalesce(${wrong.wrongCount}, 0) > 0`
    case 'mapped':
      return eq(brainMaps.status, 'approved')
    case 'mapPending':
      return and(isNotNull(brainMaps.status), ne(brainMaps.status, 'approved'))!
    case 'mapMissing':
      return isNull(brainMaps.id)
    case 'all':
    default:
      return sql`true`
  }
}

function ordering(scope: WordScope, wrong: { lastWrongAt: unknown }) {
  // Each list answers a different question, so each has its own "first".
  if (scope === 'wrong') return [desc(sql`${wrong.lastWrongAt}`), asc(vocabularies.lemma)]
  if (scope === 'saved') return [desc(userVocabularyState.bookmarkedAt), asc(vocabularies.lemma)]
  return [asc(vocabularies.lemma)]
}

/**
 * Matches English or Korean. The Korean side is an EXISTS over every
 * translation, not just the primary one, so searching a secondary sense still
 * finds the word.
 */
function searchFilter(query: string) {
  const prefix = `${query.toLowerCase()}%`
  const contains = `%${query.toLowerCase()}%`
  return or(
    sql`lower(${vocabularies.lemma}) like ${prefix}`,
    sql`exists (
      select 1 from ${vocabularyTranslations} t
      where t.vocabulary_id = ${vocabularies.id} and lower(t.text) like ${contains}
    )`,
  )!
}
