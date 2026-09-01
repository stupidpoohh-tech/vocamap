/**
 * Retention engine.
 *
 * We do not invent interval rules. Scheduling is delegated to FSRS (the
 * Free Spaced Repetition Scheduler, the algorithm behind modern Anki), via the
 * reference `ts-fsrs` implementation. This module's only real job is the
 * impedance mismatch: FSRS wants a 4-point self-assessed grade, our UI collects
 * a binary correct/incorrect plus a response time. Everything here is pure so
 * it can be tested without a database.
 */
import {
  type Card,
  type Grade,
  Rating,
  State,
  createEmptyCard,
  fsrs,
  generatorParameters,
} from 'ts-fsrs'

export type Direction = 'en_ko' | 'ko_en'

/** The subset of `user_vocabulary_cards` the scheduler reads and writes. */
export type CardState = {
  stability: number
  difficulty: number
  fsrsState: number
  dueAt: Date
  lastReviewedAt: Date | null
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  consecutiveCorrect: number
}

export type GradeInput = {
  correct: boolean
  /** Milliseconds from question shown to answer submitted. Optional. */
  responseTimeMs?: number | null
}

/**
 * Target probability of recall at review time. 0.9 is the FSRS default and a
 * sane starting point; exposed here so it can become a per-student setting
 * later without hunting for magic numbers.
 */
export const REQUEST_RETENTION = 0.9

const params = generatorParameters({
  request_retention: REQUEST_RETENTION,
  enable_fuzz: true,
  enable_short_term: true,
})

const engine = fsrs(params)

/**
 * Response-time thresholds separating a confident answer from a laboured one.
 * These are UX thresholds for mapping to a grade, not scheduling constants —
 * FSRS owns every interval decision downstream.
 */
export const FAST_ANSWER_MS = 3_500
export const SLOW_ANSWER_MS = 12_000

/**
 * Binary answer + latency → FSRS grade.
 *
 *   wrong                       → Again
 *   right but slow / hesitant   → Hard
 *   right                       → Good
 *   right and fast, on a card
 *   already in review           → Easy
 *
 * `Easy` is withheld from new and learning cards: being fast the first time you
 * see a word is not evidence of durable memory.
 */
export function toGrade(input: GradeInput, state: number): Grade {
  if (!input.correct) return Rating.Again

  const ms = input.responseTimeMs
  if (typeof ms === 'number' && ms >= 0) {
    if (ms > SLOW_ANSWER_MS) return Rating.Hard
    if (ms < FAST_ANSWER_MS && state === State.Review) return Rating.Easy
  }
  return Rating.Good
}

export function emptyCardState(now: Date = new Date()): CardState {
  return fromFsrsCard(createEmptyCard(now), 0)
}

function toFsrsCard(state: CardState): Card {
  return {
    due: state.dueAt,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.fsrsState as State,
    last_review: state.lastReviewedAt ?? undefined,
  }
}

function fromFsrsCard(card: Card, consecutiveCorrect: number): CardState {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    fsrsState: card.state,
    dueAt: card.due,
    lastReviewedAt: card.last_review ?? null,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    consecutiveCorrect,
  }
}

/** Advance a card by one graded answer. Pure: returns the next state. */
export function review(
  state: CardState,
  input: GradeInput,
  now: Date = new Date(),
): { next: CardState; grade: Grade } {
  const grade = toGrade(input, state.fsrsState)
  const { card } = engine.next(toFsrsCard(state), now, grade, (r) => r)
  const streak = input.correct ? state.consecutiveCorrect + 1 : 0
  return { next: fromFsrsCard(card, streak), grade }
}

/**
 * Probability that the student can recall this card right now, from the
 * forgetting curve. Derived, never stored — it decays every second, so a
 * persisted copy is wrong the moment it is written.
 */
export function estimatedRetention(state: CardState, now: Date = new Date()): number {
  if (state.reps === 0 || state.stability <= 0) return 0
  return engine.get_retrievability(toFsrsCard(state), now, false)
}

export type RetentionBand = 'strong' | 'fair' | 'at_risk'

/**
 * Student-facing bucketing. Students see "기억 안정도: 높음", never a stability
 * value in days.
 */
export function retentionBand(retention: number): RetentionBand {
  if (retention >= 0.85) return 'strong'
  if (retention >= 0.6) return 'fair'
  return 'at_risk'
}

export const RETENTION_BAND_LABEL: Record<RetentionBand, string> = {
  strong: '높음',
  fair: '보통',
  at_risk: '위험',
}

export function isDue(state: CardState, now: Date = new Date()): boolean {
  return state.dueAt.getTime() <= now.getTime()
}
