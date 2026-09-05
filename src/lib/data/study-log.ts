import { eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import { reviewEvents } from '@/lib/db/schema'

/**
 * Did they actually study, and how did it go.
 *
 * A tutor's question is not "what is this student's retention curve" — it is
 * "did 준혁 sit down last night, for how long, and where did he come unstuck".
 * That is a diary, one row per day, so a gap in the list is itself the answer.
 *
 * Days are Korean days. A session that runs to half past midnight belongs to
 * the night it started for the person who sat through it, but a fixed offset
 * would be a lie in a different way — so the boundary is Asia/Seoul midnight,
 * which is the one both people in this app live by.
 */
export const LOG_TIME_ZONE = 'Asia/Seoul'

export type StudyDay = {
  /** `2026-09-05`, in Korean time. */
  day: string
  total: number
  correct: number
  firstAt: Date
  lastAt: Date
  /** The words missed that day, worst first. Trimmed for the screen. */
  missed: Array<{ lemma: string; wrong: number }>
}

export type StudyLog = {
  days: StudyDay[]
  /** How many of the last `window` days had any answer at all. */
  activeDays: number
  window: number
  total: number
  lastStudiedAt: Date | null
}

const MISSED_PER_DAY = 6

export async function studyLog(
  studentId: string,
  opts: { window?: number } = {},
  db: Db = defaultDb,
): Promise<StudyLog> {
  const requested = Number.isFinite(opts.window) ? Math.trunc(opts.window as number) : 21
  const window = Math.min(Math.max(requested, 1), 120)
  // Korean midnight, `window - 1` days back — so the range is exactly `window`
  // calendar days counting today. Subtracting a rolling `window * 24h` from
  // `now()` instead would reach back into a *partial* further day, and
  // `activeDays` could then come out larger than `window`: "최근 21일 중 22일".
  const since = sql`
    (((now() at time zone ${LOG_TIME_ZONE})::date - ${window - 1}::int)::timestamp
      at time zone ${LOG_TIME_ZONE})
  `

  const [dayRows, missRows] = await Promise.all([
    db.execute<{
      day: string
      total: number
      correct: number
      first_at: string
      last_at: string
    }>(sql`
      select (e.reviewed_at at time zone ${LOG_TIME_ZONE})::date::text as day,
             count(*)::int as total,
             count(*) filter (where e.correct)::int as correct,
             min(e.reviewed_at) as first_at,
             max(e.reviewed_at) as last_at
        from review_events e
        where e.user_id = ${studentId} and e.reviewed_at >= ${since}
        group by 1
        order by 1 desc
    `),
    // Wrong answers only, worst first, trimmed per day rather than overall:
    // the point is which words to bring up in the next lesson, not a
    // transcript. The rank has to be taken per day inside the query — a flat
    // row cap would spend itself on the newest days and leave the oldest ones
    // looking like days nothing went wrong on.
    db.execute<{ day: string; lemma: string; wrong: number }>(sql`
      select day, lemma, wrong
        from (
          select day, lemma, wrong,
                 row_number() over (partition by day order by wrong desc, lemma) as rank
            from (
              select (e.reviewed_at at time zone ${LOG_TIME_ZONE})::date::text as day,
                     v.lemma,
                     count(*)::int as wrong
                from review_events e
                join vocabularies v on v.id = e.vocabulary_id
                where e.user_id = ${studentId}
                  and e.correct = false
                  and e.reviewed_at >= ${since}
                group by 1, 2
            ) counted
        ) ranked
       where rank <= ${MISSED_PER_DAY}
       order by day desc, wrong desc, lemma
    `),
  ])

  const days = rows<DayRow>(dayRows)
  const misses = rows<MissRow>(missRows)

  const missedOf = new Map<string, Array<{ lemma: string; wrong: number }>>()
  for (const row of misses) {
    const list = missedOf.get(row.day) ?? []
    if (list.length >= MISSED_PER_DAY) continue
    list.push({ lemma: row.lemma, wrong: Number(row.wrong) })
    missedOf.set(row.day, list)
  }

  const log = days.map((row) => ({
    day: row.day,
    total: Number(row.total),
    correct: Number(row.correct),
    firstAt: new Date(row.first_at),
    lastAt: new Date(row.last_at),
    missed: missedOf.get(row.day) ?? [],
  }))

  return {
    days: log,
    activeDays: log.length,
    window,
    total: log.reduce((sum, day) => sum + day.total, 0),
    lastStudiedAt: log[0]?.lastAt ?? null,
  }
}

/** When each of these students last answered anything, for the teacher's list. */
export async function lastStudiedByStudent(
  studentIds: string[],
  db: Db = defaultDb,
): Promise<Map<string, Date>> {
  if (!studentIds.length) return new Map()
  const found = await db
    .select({
      userId: reviewEvents.userId,
      lastAt: sql<Date>`max(${reviewEvents.reviewedAt})`,
    })
    .from(reviewEvents)
    .where(
      studentIds.length === 1
        ? eq(reviewEvents.userId, studentIds[0]!)
        : inArray(reviewEvents.userId, studentIds),
    )
    .groupBy(reviewEvents.userId)

  return new Map(found.map((row) => [row.userId, new Date(row.lastAt)]))
}

type DayRow = { day: string; total: number; correct: number; first_at: string; last_at: string }
type MissRow = { day: string; lemma: string; wrong: number }

/** `db.execute` hands back a driver result; these queries are plain row sets. */
function rows<T>(result: unknown): T[] {
  return result as T[]
}

/** "3일 전", "오늘". The tutor's actual question, in two words. */
export function agoKo(target: Date | null, now: Date = new Date()): string {
  if (!target) return '기록 없음'
  const days = daysBetween(target, now)
  if (days <= 0) return '오늘'
  if (days === 1) return '어제'
  if (days < 30) return `${days}일 전`
  return `${Math.round(days / 30)}개월 전`
}

/** Calendar days apart in Korean time, not 24-hour blocks. */
function daysBetween(from: Date, to: Date): number {
  const key = (date: Date) =>
    Date.parse(date.toLocaleDateString('en-CA', { timeZone: LOG_TIME_ZONE }))
  return Math.round((key(to) - key(from)) / 86_400_000)
}
