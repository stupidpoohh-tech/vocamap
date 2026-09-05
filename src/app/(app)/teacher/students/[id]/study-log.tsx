import Link from 'next/link'
import { agoKo, LOG_TIME_ZONE, type StudyLog } from '@/lib/data/study-log'
import { EmptyState } from '@/components/ui'

/**
 * The diary, not the dashboard.
 *
 * A tutor checking whether a student worked last night reads three things off
 * a row: that there is a row at all, how much of it there was, and how much of
 * it was right. Everything else on this screen is about the words; this is
 * about the sitting down.
 *
 * A day with no answers has no row. That gap is the finding, so it is not
 * filled in with a zero — but the strip above the list draws every day in the
 * window, blank ones included, because "three of the last seven" is the thing
 * the gaps add up to.
 */
export function StudyLogView({
  log,
  everStudiedAt,
}: {
  log: StudyLog
  /** The last answer ever, ignoring the window. */
  everStudiedAt: Date | null
}) {
  if (!log.days.length) {
    // A student who stopped three weeks ago has not "never studied", and the
    // teacher's list one screen back already says "1개월 전" — saying the
    // opposite here would be the screen arguing with itself.
    return everStudiedAt ? (
      <EmptyState
        title={`최근 ${log.window}일 동안 학습이 없어요`}
        hint={`마지막 학습은 ${agoKo(everStudiedAt)}이에요.`}
      />
    ) : (
      <EmptyState
        title="아직 학습 기록이 없어요"
        hint="학생이 시험을 한 번 보면 날짜별로 여기에 쌓여요."
      />
    )
  }

  const answered = new Set(log.days.map((day) => day.day))
  // The strip draws the same window the sentence above it counts. Hard-coding
  // a length here would either contradict that count or draw hollow days from
  // outside the window, which read as "did not study" when they were never
  // asked about.
  const strip = recentDays(log.window)

  return (
    <div>
      <p className="mb-3 flex items-baseline gap-2 break-keep">
        <span className="text-[0.8125rem] text-ink-2">
          최근 {log.window}일 중{' '}
          <span className="numeral font-medium text-ink">{log.activeDays}일</span> 학습
        </span>
        <span className="numeral text-xs text-ink-3">
          {log.total}문제 · 마지막 {agoKo(log.lastStudiedAt)}
        </span>
      </p>

      {/* Two weeks at a glance. Filled where they worked, hollow where they
          did not — the shape of the habit, before any of the numbers. */}
      <div className="mb-5 flex items-center gap-1" aria-hidden>
        {strip.map((day) => (
          <span
            key={day}
            title={day}
            className={`h-1.5 flex-1 rounded-full ${answered.has(day) ? 'bg-brand' : 'bg-line'}`}
          />
        ))}
      </div>

      <ul className="divide-y divide-line-soft border-t border-line">
        {log.days.map((day) => {
          const accuracy = day.total > 0 ? Math.round((day.correct / day.total) * 100) : 0

          return (
            <li key={day.day} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.9375rem] text-ink">{dayLabel(day.day)}</span>
                <span className="numeral shrink-0 text-xs text-ink-3">
                  <span className="text-ink-2">{day.total}</span>문제
                  <span className={`ml-2 ${accuracy < 60 ? 'text-warn' : 'text-ink-2'}`}>
                    정답 {accuracy}%
                  </span>
                  <span className="ml-2">
                    {clock(day.firstAt)}–{clock(day.lastAt)}
                  </span>
                </span>
              </div>

              {/* Which words to bring up next lesson. Not a transcript — the
                  six that went wrong most often that day. */}
              {day.correct === day.total ? (
                <p className="mt-1 text-[0.8125rem] text-good">다 맞았어요</p>
              ) : day.missed.length > 0 ? (
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[0.8125rem] text-ink-3">
                  <span className="text-xs">틀림</span>
                  {day.missed.map((word) => (
                    <Link
                      key={word.lemma}
                      href={`/study?q=${encodeURIComponent(word.lemma)}`}
                      className="text-ink-2 underline decoration-line underline-offset-4 transition hover:text-ink hover:decoration-brand"
                    >
                      {word.lemma}
                      {word.wrong > 1 ? (
                        <span className="numeral ml-0.5 text-xs text-ink-3">×{word.wrong}</span>
                      ) : null}
                    </Link>
                  ))}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The last `count` Korean calendar days, oldest first. */
function recentDays(count: number): string[] {
  const days: string[] = []
  const now = Date.now()
  for (let back = count - 1; back >= 0; back -= 1) {
    days.push(
      new Date(now - back * 86_400_000).toLocaleDateString('en-CA', { timeZone: LOG_TIME_ZONE }),
    )
  }
  return days
}

function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00+09:00`)
  return date.toLocaleDateString('ko-KR', {
    timeZone: LOG_TIME_ZONE,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
}

function clock(at: Date): string {
  return at.toLocaleTimeString('ko-KR', {
    timeZone: LOG_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
