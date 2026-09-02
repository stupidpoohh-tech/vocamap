import { beforeEach, describe, expect, it } from 'vitest'
import { buildSemanticMap } from '@/lib/data/semantic-map'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { setBrainMapStatus, writeDraft } from '@/lib/data/brain-map'
import { recordNodeAnswer } from '@/lib/data/study'
import { SEED_WORDS } from '@/lib/seed/words'
import { brainMapDraftSchema } from '@/lib/ai/schema'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

async function seedIssue() {
  const admin = await createUser('admin')
  const student = await createUser('student')
  const word = SEED_WORDS.find((w) => w.lemma === 'issue')!
  const { id } = await findOrCreateVocabulary({
    lemma: 'issue',
    partOfSpeech: word.partOfSpeech,
    translations: word.translations,
  })
  const brainMapId = await writeDraft(id, brainMapDraftSchema.parse(word.brainMap), {
    createdBy: admin.id,
  })
  await setBrainMapStatus(brainMapId, 'approved', admin.id)
  return { student, vocabularyId: id }
}

describe.skipIf(!hasDatabase)('semantic brain map', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('builds nodes whose labels are vocabulary, never category names', async () => {
    const { student, vocabularyId } = await seedIssue()
    const map = (await buildSemanticMap(student.id, vocabularyId))!

    const labels = map.nodes.map((n) => n.label)
    // The five drawers the old map showed must not appear as node labels.
    for (const category of ['Meaning', 'Sentences', 'Similar', 'Collocations', 'Family']) {
      expect(labels).not.toContain(category)
    }

    expect(labels).toContain('issue vs problem')
    expect(labels).toContain('raise an issue')
    expect(labels.some((l) => l.includes('문제'))).toBe(true)
  })

  it('gives every kind of content a node', async () => {
    const { student, vocabularyId } = await seedIssue()
    const map = (await buildSemanticMap(student.id, vocabularyId))!
    const kinds = new Set(map.nodes.map((n) => n.kind))
    expect(kinds).toContain('coreMeaning')
    expect(kinds).toContain('confusable')
    expect(kinds).toContain('collocation')
    expect(kinds).toContain('secondaryMeaning')
  })

  it('ranks a confusable the student actually mixes up above everything else', async () => {
    const { student, vocabularyId } = await seedIssue()

    const before = (await buildSemanticMap(student.id, vocabularyId))!
    const pair = before.nodes.find((n) => n.kind === 'confusable')!

    for (let i = 0; i < 2; i += 1) {
      await recordNodeAnswer({
        userId: student.id,
        vocabularyId,
        node: 'similar_words',
        questionType: 'similar_battle',
        correct: false,
        pairId: pair.pairId,
        payload: { itemId: pair.itemId },
      })
    }

    const after = (await buildSemanticMap(student.id, vocabularyId))!
    const confusable = after.nodes.find((n) => n.id === pair.id)!

    expect(confusable.importance).toBe(1)
    expect(confusable.status).toBe('weak')
    expect(after.recommendedNodeId).toBe(pair.id)
    expect(Math.max(...after.nodes.map((n) => n.importance))).toBe(confusable.importance)
  })

  it('keeps importance and mastery separate', async () => {
    const { student, vocabularyId } = await seedIssue()
    const first = (await buildSemanticMap(student.id, vocabularyId))!
    const core = first.nodes.find((n) => n.kind === 'coreMeaning')!

    // Master the core meaning: it stays the most important thing about the
    // word even once there is nothing left to practise there.
    for (let i = 0; i < 4; i += 1) {
      await recordNodeAnswer({
        userId: student.id,
        vocabularyId,
        node: 'meaning_core',
        questionType: 'sentence_translation',
        correct: true,
        payload: { itemId: core.itemId },
      })
    }

    const after = (await buildSemanticMap(student.id, vocabularyId))!
    const mastered = after.nodes.find((n) => n.id === core.id)!
    expect(mastered.status).toBe('completed')
    expect(mastered.importance).toBe(core.importance)
    expect(mastered.importance).toBeGreaterThan(0.9)
  })

  it('derives per-item status from the event log without a per-item table', async () => {
    const { student, vocabularyId } = await seedIssue()
    const map = (await buildSemanticMap(student.id, vocabularyId))!
    const collocations = map.nodes.filter((n) => n.kind === 'collocation')
    const target = collocations[0]!

    await recordNodeAnswer({
      userId: student.id,
      vocabularyId,
      node: 'collocations',
      questionType: 'collocation_cloze',
      correct: false,
      payload: { itemId: target.itemId },
    })

    const after = (await buildSemanticMap(student.id, vocabularyId))!
    expect(after.nodes.find((n) => n.id === target.id)!.status).toBe('weak')
    // Its neighbours in the same category are untouched — this is per item,
    // not per drawer.
    for (const other of collocations.slice(1)) {
      expect(after.nodes.find((n) => n.id === other.id)!.status).toBe('unseen')
    }
  })

  it('explains why the word was expanded, from real events only', async () => {
    const { student, vocabularyId } = await seedIssue()
    expect((await buildSemanticMap(student.id, vocabularyId))!.reasons.map((r) => r.text)).toEqual([
      '교사 검수 완료',
    ])

    const pair = (await buildSemanticMap(student.id, vocabularyId))!.nodes.find(
      (n) => n.kind === 'confusable',
    )!
    for (let i = 0; i < 2; i += 1) {
      await recordNodeAnswer({
        userId: student.id,
        vocabularyId,
        node: 'similar_words',
        questionType: 'similar_battle',
        correct: false,
        pairId: pair.pairId,
        payload: { itemId: pair.itemId },
      })
    }

    const reasons = (await buildSemanticMap(student.id, vocabularyId))!.reasons
    // Assert the substance, not the wording: both words and the real counts.
    const confusion = reasons.find((r) => r.text.includes('problem'))
    expect(confusion, reasons.map((r) => r.text).join(' | ')).toBeDefined()
    expect(confusion!.text).toContain('issue')
    expect(confusion!.text).toContain('2회')
    expect(confusion!.tone).toBe('warn')
  })

  it('gives each node an exercise rather than a passage to read', async () => {
    const { student, vocabularyId } = await seedIssue()
    const map = (await buildSemanticMap(student.id, vocabularyId))!

    const confusable = map.nodes.find((n) => n.kind === 'confusable')!
    expect(confusable.exercises[0]!.kind).toBe('choice')

    const core = map.nodes.find((n) => n.kind === 'coreMeaning')!
    expect(core.exercises.length).toBeGreaterThan(0)

    // The concept is the reward for answering, so it must not be the prompt.
    for (const exercise of confusable.exercises) {
      if (exercise.kind !== 'choice') continue
      expect(exercise.prompt).not.toContain(exercise.explanation)
    }
  })

  it('hides an unapproved map from a student and shows it to a curator', async () => {
    const admin = await createUser('admin')
    const student = await createUser('student')
    const word = SEED_WORDS.find((w) => w.lemma === 'affect')!
    const { id } = await findOrCreateVocabulary({ lemma: 'affect', translations: word.translations })
    await writeDraft(id, brainMapDraftSchema.parse(word.brainMap), { createdBy: admin.id })

    expect(await buildSemanticMap(student.id, id)).toBeNull()
    expect(await buildSemanticMap(admin.id, id, { approvedOnly: false })).not.toBeNull()
  })
})
