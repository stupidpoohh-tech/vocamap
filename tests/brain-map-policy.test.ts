import { describe, expect, it } from 'vitest'
import {
  classifyWord,
  deriveNodeStatus,
  type WordSignals,
} from '@/lib/learning/brain-map-policy'

const base: WordSignals = {
  lapses: 0,
  reps: 10,
  recentCorrect: 8,
  recentAttempts: 8,
  minRetention: 0.95,
  confusionErrors: 0,
  sentenceErrors: 0,
  collocationErrors: 0,
  markedImportant: false,
  importantReason: null,
}

describe('word classification', () => {
  it('passes a well-known word through without a brain map', () => {
    const result = classifyWord(base)
    expect(result.wordClass).toBe('known')
    expect(result.recommend).toBe(false)
  })

  it('does not judge a word the student has barely met', () => {
    const result = classifyWord({ ...base, reps: 2, recentCorrect: 0, recentAttempts: 2, lapses: 2 })
    expect(result.recommend).toBe(false)
    expect(result.wordClass).toBe('memorise')
  })

  it('recommends expansion after repeated recall failures', () => {
    const result = classifyWord({ ...base, lapses: 3, minRetention: 0.4 })
    expect(result.wordClass).toBe('understand')
    expect(result.reason).toBe('frequent_error')
  })

  it('recommends expansion when recent accuracy drops', () => {
    const result = classifyWord({ ...base, recentCorrect: 3, recentAttempts: 8, minRetention: 0.5 })
    expect(result.recommend).toBe(true)
  })

  it('recommends expansion on repeated similar-word confusion even when recall is fine', () => {
    const result = classifyWord({ ...base, confusionErrors: 2 })
    expect(result.recommend).toBe(true)
    expect(result.message).toContain('헷갈리')
    // The node the student is actually failing should be offered first.
    expect(result.suggestedNodes[0]).toBe('similar_words')
  })

  it('honours a teacher flag immediately, without waiting for failures', () => {
    const result = classifyWord({
      ...base,
      reps: 0,
      markedImportant: true,
      importantReason: 'teacher_selected',
    })
    expect(result.recommend).toBe(true)
    expect(result.reason).toBe('teacher_selected')
    expect(result.suggestedNodes.length).toBeGreaterThan(0)
  })

  it('classifies a weak-but-uncomplicated word as drill, not expansion', () => {
    const result = classifyWord({ ...base, minRetention: 0.7, recentCorrect: 7, recentAttempts: 8 })
    expect(result.wordClass).toBe('memorise')
    expect(result.recommend).toBe(false)
  })
})

describe('node status derivation', () => {
  it('locks a node with no master content', () => {
    expect(deriveNodeStatus({ attempts: 0, correct: 0, available: false })).toBe('locked')
  })

  it('marks an untouched but available node as available', () => {
    expect(deriveNodeStatus({ attempts: 0, correct: 0, available: true })).toBe('available')
  })

  it('needs sustained accuracy before calling a node mastered', () => {
    expect(deriveNodeStatus({ attempts: 2, correct: 2, available: true })).toBe('learning')
    expect(deriveNodeStatus({ attempts: 3, correct: 3, available: true })).toBe('mastered')
  })

  it('marks a node weak when the student is failing it', () => {
    expect(deriveNodeStatus({ attempts: 4, correct: 1, available: true })).toBe('weak')
  })
})
