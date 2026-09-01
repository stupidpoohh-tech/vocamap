import { describe, expect, it } from 'vitest'
import { Rating, State } from 'ts-fsrs'
import {
  FAST_ANSWER_MS,
  SLOW_ANSWER_MS,
  emptyCardState,
  estimatedRetention,
  isDue,
  retentionBand,
  review,
  toGrade,
} from '@/lib/learning/scheduler'

const T0 = new Date('2026-01-01T09:00:00Z')
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000)

describe('grade mapping', () => {
  it('maps a wrong answer to Again regardless of speed', () => {
    expect(toGrade({ correct: false, responseTimeMs: 100 }, State.Review)).toBe(Rating.Again)
    expect(toGrade({ correct: false, responseTimeMs: 60_000 }, State.New)).toBe(Rating.Again)
  })

  it('maps a slow correct answer to Hard', () => {
    expect(toGrade({ correct: true, responseTimeMs: SLOW_ANSWER_MS + 1 }, State.Review)).toBe(
      Rating.Hard,
    )
  })

  it('reserves Easy for fast answers on cards already in review', () => {
    const fast = { correct: true, responseTimeMs: FAST_ANSWER_MS - 1 }
    expect(toGrade(fast, State.Review)).toBe(Rating.Easy)
    // Being quick the first time you see a word is not evidence of memory.
    expect(toGrade(fast, State.New)).toBe(Rating.Good)
    expect(toGrade(fast, State.Learning)).toBe(Rating.Good)
  })

  it('falls back to Good when no response time was captured', () => {
    expect(toGrade({ correct: true }, State.Review)).toBe(Rating.Good)
    expect(toGrade({ correct: true, responseTimeMs: null }, State.Review)).toBe(Rating.Good)
  })
})

describe('card progression', () => {
  it('schedules a new card into the future and counts the rep', () => {
    const { next } = review(emptyCardState(T0), { correct: true }, T0)
    expect(next.reps).toBe(1)
    expect(next.dueAt.getTime()).toBeGreaterThan(T0.getTime())
    expect(next.consecutiveCorrect).toBe(1)
  })

  it('lengthens the interval as correct answers accumulate', () => {
    let state = emptyCardState(T0)
    let previousInterval = 0
    let now = T0
    for (let i = 0; i < 6; i += 1) {
      const result = review(state, { correct: true }, now)
      state = result.next
      const interval = state.dueAt.getTime() - now.getTime()
      if (i > 1) expect(interval).toBeGreaterThan(previousInterval)
      previousInterval = interval
      now = state.dueAt
    }
    // Six clean reviews should carry the card well past a week.
    expect(state.stability).toBeGreaterThan(7)
  })

  it('resets the streak and records a lapse on a wrong answer', () => {
    let state = emptyCardState(T0)
    state = review(state, { correct: true }, T0).next
    state = review(state, { correct: true }, days(1)).next
    state = review(state, { correct: true }, days(4)).next
    const before = state.stability
    expect(state.consecutiveCorrect).toBe(3)

    const after = review(state, { correct: false }, days(10)).next
    expect(after.consecutiveCorrect).toBe(0)
    expect(after.lapses).toBe(state.lapses + 1)
    expect(after.stability).toBeLessThan(before)
  })
})

describe('estimated retention', () => {
  it('is zero for a card that has never been reviewed', () => {
    expect(estimatedRetention(emptyCardState(T0), T0)).toBe(0)
  })

  it('decays as time passes since the last review', () => {
    const state = review(emptyCardState(T0), { correct: true }, T0).next
    const sameDay = estimatedRetention(state, T0)
    const later = estimatedRetention(state, days(30))
    const muchLater = estimatedRetention(state, days(365))
    expect(sameDay).toBeGreaterThan(later)
    expect(later).toBeGreaterThan(muchLater)
    expect(muchLater).toBeGreaterThanOrEqual(0)
  })

  it('buckets retention into the three student-facing bands', () => {
    expect(retentionBand(0.95)).toBe('strong')
    expect(retentionBand(0.85)).toBe('strong')
    expect(retentionBand(0.7)).toBe('fair')
    expect(retentionBand(0.59)).toBe('at_risk')
  })
})

describe('due detection', () => {
  it('treats a card as due once its due date has passed', () => {
    const state = review(emptyCardState(T0), { correct: true }, T0).next
    expect(isDue(state, T0)).toBe(false)
    expect(isDue(state, days(400))).toBe(true)
  })
})
