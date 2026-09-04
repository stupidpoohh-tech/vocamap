import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import { userVocabularyCards } from '@/lib/db/schema'
import { estimatedRetention, type CardState } from '@/lib/learning/scheduler'
import type { BrainMapState } from './vocabulary'

/**
 * 보관함, as a review desk rather than a second word list.
 *
 * The star lists live where the stars are — in 단어 and in 맵 — so what is left
 * for this screen is the one thing neither of them can show: the learning
 * curve. Every row here answers "when do I meet this word again, and how much
 * of it is still there", which is a property of the schedule, not of the word.
 *
 * A word owns two cards, one per direction, and they drift apart: you can
 * recognise `assert` and still not produce it. So a word is due when its
 * *earlier* card is due, and its strength is the *weaker* of the two. Averaging
 * them would hide exactly the half that needs the work.
 */
export type ReviewBucket =
  /** Its next review has arrived. */
  | 'now'
  /** Scheduled, not yet arrived. */
  | 'upcoming'
  /** Answered wrong at least once, whenever it is next due. */
  | 'wrong'

export type ReviewWord = {
  id: string
  lemma: string
  translation: string | null
  bookmarked: boolean
  wrongCount: number
  mapStatus: BrainMapState
  /** The earlier of the word's two cards. */
  dueAt: Date | null
  /** 0–1, the weaker direction. `null` before the word has ever been answered. */
  retention: number | null
}

export type ReviewPage = {
  words: ReviewWord[]
  total: number
  page: number
  pageCount: number
}

export type ReviewCounts = { now: number; upcoming: number; wrong: number }

export const REVIEW_PAGE_SIZE = 25

/** The three tab counts, in one round trip. */
export async function reviewCounts(
  userId: string,
  opts: { now?: Date } = {},
  db: Db = defaultDb,
): Promise<ReviewCounts> {
  const now = (opts.now ?? new Date()).toISOString()
  const rows = (await db.execute<{
    now: number
    upcoming: number
    wrong: number
  }>(sql`
    with word as (
      select vocabulary_id, min(due_at) as due_at
        from user_vocabulary_cards
        where user_id = ${userId}
        group by vocabulary_id
    )
    select
      (select count(*) from word where due_at <= ${now}::timestamptz)::int as now,
      (select count(*) from word where due_at > ${now}::timestamptz)::int as upcoming,
      (select count(distinct vocabulary_id) from review_events
        where user_id = ${userId} and correct = false)::int as wrong
  `)) as unknown as Array<{ now: number; upcoming: number; wrong: number }>

  const row = rows[0]
  return {
    now: Number(row?.now ?? 0),
    upcoming: Number(row?.upcoming ?? 0),
    wrong: Number(row?.wrong ?? 0),
  }
}

/**
 * One page of the review desk.
 *
 * The page is chosen first, from the schedule alone, and only then described —
 * so the join that fetches meanings and map badges runs over twenty-five words
 * rather than over the whole library.
 */
export async function listReviewWords(
  opts: {
    userId: string
    bucket: ReviewBucket
    page?: number
    pageSize?: number
    now?: Date
  },
  db: Db = defaultDb,
): Promise<ReviewPage> {
  const now = (opts.now ?? new Date()).toISOString()
  const pageSize = opts.pageSize ?? REVIEW_PAGE_SIZE
  const page = Math.max(0, opts.page ?? 0)
  const offset = page * pageSize
  const userId = opts.userId

  // Each bucket has its own "first". Due words lead with the most overdue;
  // upcoming words with the soonest; wrong words with the most recent mistake,
  // because that is the one still fresh enough to be worth a second look.
  const picked =
    opts.bucket === 'wrong'
      ? sql`
          select e.vocabulary_id as id,
                 (select min(c.due_at) from user_vocabulary_cards c
                    where c.user_id = ${userId} and c.vocabulary_id = e.vocabulary_id) as due_at,
                 (count(*) over ())::int as total
            from review_events e
            where e.user_id = ${userId} and e.correct = false
            group by e.vocabulary_id
            order by max(e.reviewed_at) desc
            limit ${pageSize} offset ${offset}
        `
      : sql`
          select c.vocabulary_id as id,
                 min(c.due_at) as due_at,
                 (count(*) over ())::int as total
            from user_vocabulary_cards c
            where c.user_id = ${userId}
            group by c.vocabulary_id
            having min(c.due_at) ${opts.bucket === 'now' ? sql`<=` : sql`>`} ${now}::timestamptz
            order by min(c.due_at) asc
            limit ${pageSize} offset ${offset}
        `

  const rows = (await db.execute<DetailRow>(sql`
    with picked as (${picked})
    select p.id,
           p.due_at,
           p.total,
           v.lemma,
           t.text as translation,
           (s.bookmarked_at is not null) as bookmarked,
           b.status as map_status,
           coalesce(w.wrong_count, 0)::int as wrong_count
      from picked p
      join vocabularies v on v.id = p.id
      left join vocabulary_translations t
        on t.vocabulary_id = v.id and t.is_primary = true
      left join user_vocabulary_state s
        on s.vocabulary_id = v.id and s.user_id = ${userId}
      left join brain_maps b on b.vocabulary_id = v.id
      left join lateral (
        select count(*) as wrong_count from review_events e
          where e.user_id = ${userId} and e.vocabulary_id = v.id and e.correct = false
      ) w on true
      order by p.due_at ${opts.bucket === 'wrong' ? sql`desc nulls last` : sql`asc`}
  `)) as unknown as DetailRow[]

  const total = Number(rows[0]?.total ?? 0)
  const retentions = await weakestRetention(
    userId,
    rows.map((row) => row.id),
    opts.now ?? new Date(),
    db,
  )

  return {
    words: rows.map((row) => ({
      id: row.id,
      lemma: row.lemma,
      translation: row.translation,
      bookmarked: row.bookmarked === true,
      wrongCount: Number(row.wrong_count ?? 0),
      mapStatus: row.map_status === 'approved' ? 'approved' : row.map_status ? 'draft' : 'none',
      dueAt: row.due_at ? new Date(row.due_at) : null,
      retention: retentions.get(row.id) ?? null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  }
}

type DetailRow = {
  id: string
  due_at: string | null
  total: number
  lemma: string
  translation: string | null
  bookmarked: boolean
  map_status: string | null
  wrong_count: number
}

/**
 * How much of each word is still there, taken from its weaker direction.
 *
 * FSRS computes retrievability from the whole card state, so this reads the
 * card rather than deriving a number from the due date: a card answered late is
 * not the same as one answered on time, and only the state knows that.
 */
async function weakestRetention(
  userId: string,
  vocabularyIds: string[],
  now: Date,
  db: Db,
): Promise<Map<string, number>> {
  if (!vocabularyIds.length) return new Map()

  const cards = await db
    .select()
    .from(userVocabularyCards)
    .where(
      and(
        eq(userVocabularyCards.userId, userId),
        inArray(userVocabularyCards.vocabularyId, vocabularyIds),
      ),
    )

  const weakest = new Map<string, number>()
  for (const card of cards) {
    const state: CardState = {
      stability: card.stability,
      difficulty: card.difficulty,
      fsrsState: card.fsrsState,
      dueAt: card.dueAt,
      lastReviewedAt: card.lastReviewedAt,
      elapsedDays: card.elapsedDays,
      scheduledDays: card.scheduledDays,
      learningSteps: card.learningSteps,
      reps: card.reps,
      lapses: card.lapses,
      consecutiveCorrect: card.consecutiveCorrect,
    }
    const retention = estimatedRetention(state, now)
    const seen = weakest.get(card.vocabularyId)
    if (seen === undefined || retention < seen) weakest.set(card.vocabularyId, retention)
  }
  return weakest
}

/**
 * "3일 후", "2일 지남". Days, not hours: the schedule is a study plan, and a
 * plan measured in hours reads as a countdown the student is losing.
 */
export function dueLabel(dueAt: Date | null, now: Date = new Date()): string {
  if (!dueAt) return '—'
  const days = Math.round((dueAt.getTime() - now.getTime()) / 86_400_000)
  if (days <= -2) return `${Math.abs(days)}일 지남`
  if (days <= 0) return '지금'
  if (days === 1) return '내일'
  if (days < 30) return `${days}일 후`
  const months = Math.round(days / 30)
  return `${months}개월 후`
}
