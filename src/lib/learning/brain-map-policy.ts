/**
 * Decides which words earn a Brain Map.
 *
 * The premise of the service is that most words do not: they get memorised by
 * repetition and pass through. A Brain Map costs the student several minutes,
 * so it is only offered when there is evidence that repetition alone is not
 * working, or when a human has said the word matters.
 *
 * Pure module — no database, no clock beyond what is passed in.
 */
import type { NodeStatus, NodeType } from './nodes'

export type WordClass =
  /** Recall strong and retention high — pass through quickly. */
  | 'known'
  /** Recall weak but nothing suggests a comprehension problem — just drill it. */
  | 'memorise'
  /** Evidence of a comprehension gap, or a human flagged it — expand the map. */
  | 'understand'

export type ExpansionReason =
  | 'teacher_selected'
  | 'student_selected'
  | 'frequent_error'
  | 'exam'
  | 'system_recommended'

/** Everything the policy is allowed to look at. */
export type WordSignals = {
  /** Lifetime lapses summed across both recall directions. */
  lapses: number
  /** Reviews summed across both directions. */
  reps: number
  /** Correct answers in the last `recentWindow` recall attempts. */
  recentCorrect: number
  recentAttempts: number
  /** Lowest estimated retention across the two directions, 0..1. */
  minRetention: number
  /** Wrong answers on similar-word battles involving this word. */
  confusionErrors: number
  /** Wrong answers on sentence-translation checks for this word. */
  sentenceErrors: number
  /** Wrong answers on collocation cloze items for this word. */
  collocationErrors: number
  markedImportant: boolean
  importantReason: ExpansionReason | null
}

export const MIN_REPS_BEFORE_JUDGING = 3
export const LAPSE_THRESHOLD = 3
export const RECENT_ACCURACY_FLOOR = 0.6
export const NODE_ERROR_THRESHOLD = 2

export type Recommendation = {
  wordClass: WordClass
  recommend: boolean
  reason: ExpansionReason | null
  /** Short Korean sentence explaining the recommendation to the student. */
  message: string | null
  /** Nodes worth opening first, most useful first. */
  suggestedNodes: NodeType[]
}

export function classifyWord(signals: WordSignals): Recommendation {
  // A human's judgement outranks any heuristic, and applies immediately —
  // there is no point making a student fail three times first.
  if (signals.markedImportant) {
    const reason =
      signals.importantReason === 'teacher_selected' ||
      signals.importantReason === 'student_selected' ||
      signals.importantReason === 'exam'
        ? signals.importantReason
        : 'system_recommended'
    return {
      wordClass: 'understand',
      recommend: true,
      reason,
      message: MESSAGES[reason],
      suggestedNodes: rankNodes(signals),
    }
  }

  // Too early to tell. Do not interrupt a word the student has barely met.
  if (signals.reps < MIN_REPS_BEFORE_JUDGING) {
    return { wordClass: 'memorise', recommend: false, reason: null, message: null, suggestedNodes: [] }
  }

  const recentAccuracy =
    signals.recentAttempts > 0 ? signals.recentCorrect / signals.recentAttempts : 1

  const nodeEvidence =
    signals.confusionErrors >= NODE_ERROR_THRESHOLD ||
    signals.sentenceErrors >= NODE_ERROR_THRESHOLD ||
    signals.collocationErrors >= NODE_ERROR_THRESHOLD

  const recallEvidence =
    signals.lapses >= LAPSE_THRESHOLD || recentAccuracy < RECENT_ACCURACY_FLOOR

  if (nodeEvidence || recallEvidence) {
    return {
      wordClass: 'understand',
      recommend: true,
      reason: 'frequent_error',
      message: expansionMessage(signals),
      suggestedNodes: rankNodes(signals),
    }
  }

  if (signals.minRetention >= 0.85 && recentAccuracy >= 0.9) {
    return { wordClass: 'known', recommend: false, reason: null, message: null, suggestedNodes: [] }
  }

  return { wordClass: 'memorise', recommend: false, reason: null, message: null, suggestedNodes: [] }
}

const MESSAGES: Record<ExpansionReason, string> = {
  teacher_selected: '선생님이 중요 단어로 지정했어요.',
  student_selected: '중요 단어로 저장한 단어예요.',
  exam: '시험 범위에 포함된 단어예요.',
  frequent_error: '이 단어를 자주 틀리고 있어요.',
  system_recommended: '조금 더 깊이 볼 만한 단어예요.',
}

function expansionMessage(signals: WordSignals): string {
  if (signals.confusionErrors >= NODE_ERROR_THRESHOLD) return '비슷한 단어와 반복해서 헷갈리고 있어요.'
  if (signals.sentenceErrors >= NODE_ERROR_THRESHOLD) return '문장 속 의미를 놓치는 경우가 있어요.'
  if (signals.collocationErrors >= NODE_ERROR_THRESHOLD) return '함께 쓰는 표현에서 자주 막히고 있어요.'
  return MESSAGES.frequent_error
}

/**
 * Order the five nodes by what this student's errors point at. Meaning core
 * leads whenever the failure looks like plain recall, because a student who
 * cannot hold the word at all is not helped by collocations.
 */
function rankNodes(signals: WordSignals): NodeType[] {
  const scored: Array<[NodeType, number]> = [
    ['meaning_core', 1],
    ['sentences', signals.sentenceErrors],
    ['similar_words', signals.confusionErrors],
    ['collocations', signals.collocationErrors],
    ['word_family', 0],
  ]
  return scored
    .sort((a, b) => b[1] - a[1])
    .map(([node]) => node)
}

/* ───────────────────────── node status derivation ───────────────────────── */

export type NodeCounters = { attempts: number; correct: number; available: boolean }

/**
 * A node's status is derived from the student's attempts on it, not stored as
 * a hand-set flag — so it can never drift from the underlying events.
 */
export function deriveNodeStatus(counters: NodeCounters): NodeStatus {
  if (!counters.available) return 'locked'
  if (counters.attempts === 0) return 'available'
  const accuracy = counters.correct / counters.attempts
  if (counters.attempts >= 3 && accuracy >= 0.8) return 'mastered'
  if (accuracy < 0.5) return 'weak'
  return 'learning'
}
