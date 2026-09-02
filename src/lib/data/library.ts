import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  assignments,
  brainMaps,
  reviewEvents,
  userVocabularyState,
  vocabularies,
  vocabularySetItems,
  vocabularySets,
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
  /** 0-based. Lists are paged so neither the query nor the page grows without bound. */
  page?: number
  pageSize?: number
  /** Words in no set at all. Without this they would be unreachable once the
   *  study book is browsed set by set. */
  unassigned?: boolean
  query?: string
  /** Restricts to words that are also starred. Powers "저장한 맵". */
  savedOnly?: boolean
  limit?: number
}

/**
 * One page of a word list.
 *
 * Everything used to come back in one 300-row array, which meant a page that
 * scrolled forever, three hundred bookmark buttons to hydrate, and a query that
 * grew with the library. A page is a page.
 */
export const WORD_PAGE_SIZE = 25

export type WordPage = {
  words: StudyWord[]
  /** Rows matching the filter, not rows on this page. Drives the pager. */
  total: number
  page: number
  pageCount: number
}

export async function listStudyWords(
  opts: ListWordsOptions,
  db: Db = defaultDb,
): Promise<WordPage> {
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
  if (opts.unassigned) {
    filters.push(sql`not exists (
      select 1 from ${vocabularySetItems} i where i.vocabulary_id = ${vocabularies.id}
    )`)
  }
  const search = opts.query?.trim()
  if (search) filters.push(searchFilter(search))

  const pageSize = opts.pageSize ?? opts.limit ?? WORD_PAGE_SIZE
  const page = Math.max(0, opts.page ?? 0)

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
      // The matching-row count rides along with the page, so paging costs one
      // query rather than two.
      total: sql<number>`count(*) over ()`,
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
    .limit(pageSize)
    .offset(page * pageSize)

  const total = Number(rows[0]?.total ?? 0)
  return {
    words: rows.map((row) => ({
      id: row.id,
      lemma: row.lemma,
      translation: row.translation,
      bookmarked: row.bookmarkedAt !== null,
      wrongCount: row.wrongCount ?? 0,
      lastWrongAt: row.lastWrongAt ?? null,
      mapStatus: row.status === 'approved' ? 'approved' : row.status ? 'draft' : 'none',
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  }
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

/* ───────────────────────────── the set shelf ───────────────────────────── */

export type WordSet = {
  /** `null` is the bucket of words that belong to no set. */
  id: string | null
  title: string
  description: string | null
  wordCount: number
  /** How many of this set's words the student has starred. */
  savedCount: number
  /** How many carry a Brain Map the student can open. */
  mappedCount: number
  assigned: boolean
}

/**
 * The shelf the study book opens on.
 *
 * A flat list of every word a tutor has ever uploaded is not a study book, it
 * is a dictionary — a student cannot tell which twenty words are this week's.
 * Sets are the unit the tutor already teaches in, so they are the unit the
 * student browses in.
 *
 * Every set is visible to everyone, like the words themselves. An assignment no
 * longer decides what you may see; it decides what leads the shelf.
 */
export async function listWordSets(userId: string, db: Db = defaultDb): Promise<WordSet[]> {
  const [sets, assigned, loose] = await Promise.all([
    db
      .select({
        id: vocabularySets.id,
        title: vocabularySets.title,
        description: vocabularySets.description,
        // Created order is lesson order. Sorting by title would put "Day 10"
        // ahead of "Day 2", which is worse than useless in a study book.
        createdAt: vocabularySets.createdAt,
      })
      .from(vocabularySets)
      .orderBy(asc(vocabularySets.createdAt)),
    db
      .selectDistinct({ setId: assignments.setId })
      .from(assignments)
      .where(eq(assignments.studentId, userId)),
    looseStats(userId, db),
  ])

  const assignedIds = new Set(assigned.map((a) => a.setId))
  const stats = sets.length ? await setStats(userId, sets.map((s) => s.id), db) : new Map()

  const shelf: WordSet[] = sets.map((set) => ({
    id: set.id,
    title: set.title,
    description: set.description,
    wordCount: stats.get(set.id)?.words ?? 0,
    savedCount: stats.get(set.id)?.saved ?? 0,
    mappedCount: stats.get(set.id)?.mapped ?? 0,
    assigned: assignedIds.has(set.id),
  }))

  // Assigned sets lead: a teacher handing a student a set is still the
  // strongest signal about what to study next.
  shelf.sort((a, b) => Number(b.assigned) - Number(a.assigned))

  if (loose.words > 0) {
    shelf.push({
      id: null,
      title: '세트에 없는 단어',
      description: '아직 어느 세트에도 담기지 않은 단어예요.',
      wordCount: loose.words,
      savedCount: loose.saved,
      mappedCount: loose.mapped,
      assigned: false,
    })
  }

  return shelf
}

async function setStats(
  userId: string,
  setIds: string[],
  db: Db,
): Promise<Map<string, { words: number; saved: number; mapped: number }>> {
  const rows = await db
    .select({
      setId: vocabularySetItems.setId,
      words: sql<number>`count(*)::int`,
      saved: sql<number>`count(${userVocabularyState.bookmarkedAt})::int`,
      mapped: sql<number>`count(*) filter (where ${brainMaps.status} = 'approved')::int`,
    })
    .from(vocabularySetItems)
    .leftJoin(
      userVocabularyState,
      and(
        eq(userVocabularyState.vocabularyId, vocabularySetItems.vocabularyId),
        eq(userVocabularyState.userId, userId),
      ),
    )
    .leftJoin(brainMaps, eq(brainMaps.vocabularyId, vocabularySetItems.vocabularyId))
    .where(inArray(vocabularySetItems.setId, setIds))
    .groupBy(vocabularySetItems.setId)

  return new Map(rows.map((r) => [r.setId, { words: r.words, saved: r.saved, mapped: r.mapped }]))
}

/** Size and state of the "in no set" bucket, in one query rather than two. */
async function looseStats(
  userId: string,
  db: Db,
): Promise<{ words: number; saved: number; mapped: number }> {
  const [row] = await db
    .select({
      words: sql<number>`count(*)::int`,
      saved: sql<number>`count(${userVocabularyState.bookmarkedAt})::int`,
      mapped: sql<number>`count(*) filter (where ${brainMaps.status} = 'approved')::int`,
    })
    .from(vocabularies)
    .leftJoin(
      userVocabularyState,
      and(
        eq(userVocabularyState.vocabularyId, vocabularies.id),
        eq(userVocabularyState.userId, userId),
      ),
    )
    .leftJoin(brainMaps, eq(brainMaps.vocabularyId, vocabularies.id))
    .where(
      sql`not exists (
        select 1 from ${vocabularySetItems} i where i.vocabulary_id = ${vocabularies.id}
      )`,
    )
  return { words: row?.words ?? 0, saved: row?.saved ?? 0, mapped: row?.mapped ?? 0 }
}

/** Title of one set, for the header of its word list. */
export async function wordSetName(setId: string, db: Db = defaultDb): Promise<string | null> {
  const [row] = await db
    .select({ title: vocabularySets.title })
    .from(vocabularySets)
    .where(eq(vocabularySets.id, setId))
    .limit(1)
  return row?.title ?? null
}

/* ────────────────────────────── tab counts ────────────────────────────── */

export type MapCounts = { published: number; saved: number; pending: number; missing: number }
export type VaultCounts = { saved: number; wrong: number }

/**
 * Every count the 맵 tabs need, in one query.
 *
 * They used to come from running the list query once per tab and taking its
 * length — four full scans to render one list. Counting is what the tabs
 * actually want, and counting is one round trip.
 */
export async function mapCounts(userId: string, db: Db = defaultDb): Promise<MapCounts> {
  const [row] = await db
    .select({
      published: sql<number>`count(*) filter (where ${brainMaps.status} = 'approved')::int`,
      saved: sql<number>`count(*) filter (
        where ${brainMaps.status} = 'approved' and ${userVocabularyState.bookmarkedAt} is not null
      )::int`,
      pending: sql<number>`count(*) filter (
        where ${brainMaps.status} is not null and ${brainMaps.status} <> 'approved'
      )::int`,
      missing: sql<number>`count(*) filter (where ${brainMaps.id} is null)::int`,
    })
    .from(vocabularies)
    .leftJoin(brainMaps, eq(brainMaps.vocabularyId, vocabularies.id))
    .leftJoin(
      userVocabularyState,
      and(
        eq(userVocabularyState.vocabularyId, vocabularies.id),
        eq(userVocabularyState.userId, userId),
      ),
    )

  return {
    published: row?.published ?? 0,
    saved: row?.saved ?? 0,
    pending: row?.pending ?? 0,
    missing: row?.missing ?? 0,
  }
}

/** Both 보관함 tab counts, in one query. */
export async function vaultCounts(userId: string, db: Db = defaultDb): Promise<VaultCounts> {
  const [row] = await db
    .select({
      saved: sql<number>`(
        select count(*) from ${userVocabularyState} s
        where s.user_id = ${userId} and s.bookmarked_at is not null
      )::int`,
      wrong: sql<number>`(
        select count(distinct e.vocabulary_id) from ${reviewEvents} e
        where e.user_id = ${userId} and e.correct = false
      )::int`,
    })
    .from(sql`(select 1) as one`)

  return { saved: row?.saved ?? 0, wrong: row?.wrong ?? 0 }
}
