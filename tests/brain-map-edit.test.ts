import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  brainMapSentences,
  brainMapSimilarWords,
  brainMapRevisions,
  wordPairQuestions,
  wordPairs,
} from '@/lib/db/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { getMasterBrainMap, setBrainMapStatus, writeDraft } from '@/lib/data/brain-map'
import { EditError, removeDraftItem, saveDraftItem, saveMeaningCore } from '@/lib/data/brain-map-edit'
import { validateItem } from '@/lib/ai'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

const DRAFT = {
  meaningCoreKo: '어떤 상태가 끊기지 않게 붙잡아 두다',
  meaningCoreEn: 'to keep something going',
  primaryTranslations: ['유지하다'],
  meanings: [
    { ko: '유지하다', enDefinition: null, connectionNote: '중심 개념 그대로', exampleChunk: 'maintain health' },
  ],
  sentences: [
    {
      text: 'She works hard to maintain her health.',
      ko: '그녀는 건강을 유지하려고 노력한다.',
      targetMeaning: '유지하다',
      highlight: 'maintain her health',
      difficulty: 2,
    },
  ],
  collocations: [{ expression: 'maintain quality', ko: '품질을 유지하다', exampleSentence: null, importance: 1 }],
  wordFamily: [
    { lemma: 'maintenance', partOfSpeech: 'noun' as const, ko: '유지, 정비', exampleSentence: null },
  ],
  similarWords: [
    {
      lemma: 'keep',
      coreDifference: 'maintain은 의도적인 관리, keep은 단순히 계속 가지는 것',
      usageRule: null,
      questions: [
        {
          prompt: 'The hospital must ___ strict hygiene standards.',
          answer: 'maintain',
          explanation: '규정을 관리해서 지키는 상황이라 maintain이 맞아요.',
        },
      ],
    },
  ],
}

async function draftFor(lemma = 'maintain') {
  const curator = await createUser('teacher')
  const { id: vocabularyId } = await findOrCreateVocabulary({ lemma, partOfSpeech: 'verb' })
  const brainMapId = await writeDraft(vocabularyId, DRAFT, { createdBy: curator.id })
  const map = (await getMasterBrainMap(vocabularyId, { approvedOnly: false }))!
  return { curator, vocabularyId, brainMapId, map }
}

const reread = (vocabularyId: string) => getMasterBrainMap(vocabularyId, { approvedOnly: false })

describe('item validation', () => {
  it('holds an edited sentence to the rules that would break the card', () => {
    // The same two rules that block a whole generated draft: a highlight the
    // sentence does not contain has nothing to mark up.
    const bad = validateItem('sentence', {
      text: 'She maintains her health.',
      ko: '그녀는 건강을 유지한다.',
      targetMeaning: '유지하다',
      highlight: 'keeps her health',
      difficulty: '2',
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.highlight).toBeTruthy()
  })

  it('insists a cloze prompt has exactly one blank', () => {
    for (const prompt of ['No blank here at all.', 'Two ___ blanks ___ here.']) {
      const result = validateItem('pairQuestion', {
        prompt,
        answer: 'maintain',
        explanation: '설명이 충분히 깁니다.',
      })
      expect(result.ok, prompt).toBe(false)
    }
    const good = validateItem('pairQuestion', {
      prompt: 'The hospital must ___ standards.',
      answer: 'maintain',
      explanation: '설명이 충분히 깁니다.',
    })
    expect(good.ok).toBe(true)
  })

  it('turns an empty optional field into null rather than an empty string', () => {
    const result = validateItem('meaning', { ko: '유지하다', enDefinition: '', connectionNote: '', exampleChunk: '' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values.enDefinition).toBeNull()
  })

  it('refuses a required field and a word paired with itself', () => {
    expect(validateItem('meaning', { ko: '  ' }).ok).toBe(false)
    const self = validateItem(
      'pair',
      { lemma: 'Maintain', coreDifference: '차이를 설명합니다.', usageRule: '' },
      { lemma: 'maintain' },
    )
    expect(self.ok).toBe(false)
  })
})

describe.skipIf(!hasDatabase)('editing one item at a time', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('edits a sentence without touching anything else', async () => {
    const { curator, vocabularyId, brainMapId, map } = await draftFor()
    const before = map.collocations[0]!.expression

    await saveDraftItem({
      brainMapId,
      kind: 'sentence',
      itemId: map.sentences[0]!.id,
      actorId: curator.id,
      values: {
        text: 'He struggled to maintain order.',
        ko: '그는 질서를 유지하려 애썼다.',
        targetMeaning: '질서를 유지하다',
        highlight: 'maintain order',
        difficulty: '3',
      },
    })

    const after = (await reread(vocabularyId))!
    expect(after.sentences).toHaveLength(1)
    expect(after.sentences[0]!.text).toBe('He struggled to maintain order.')
    expect(after.sentences[0]!.difficulty).toBe(3)
    // The rest of the map is exactly as the curator left it.
    expect(after.collocations[0]!.expression).toBe(before)
    expect(after.meanings).toHaveLength(1)
    expect(after.similarWords).toHaveLength(1)
  })

  it('refuses an edit that would render as a broken card', async () => {
    const { curator, vocabularyId, brainMapId, map } = await draftFor()
    const attempt = saveDraftItem({
      brainMapId,
      kind: 'sentence',
      itemId: map.sentences[0]!.id,
      actorId: curator.id,
      values: {
        text: 'He maintained order.',
        ko: '그는 질서를 유지했다.',
        targetMeaning: '유지하다',
        highlight: 'kept order',
        difficulty: '2',
      },
    })
    await expect(attempt).rejects.toBeInstanceOf(EditError)
    // And nothing was written.
    expect((await reread(vocabularyId))!.sentences[0]!.text).toBe(
      'She works hard to maintain her health.',
    )
  })

  it('deletes one item and leaves the others', async () => {
    const { curator, vocabularyId, brainMapId, map } = await draftFor()
    await saveDraftItem({
      brainMapId,
      kind: 'sentence',
      actorId: curator.id,
      values: {
        text: 'They maintain the machines every week.',
        ko: '그들은 매주 기계를 정비한다.',
        targetMeaning: '정비하다',
        highlight: 'maintain the machines',
        difficulty: '2',
      },
    })
    const two = (await reread(vocabularyId))!
    expect(two.sentences).toHaveLength(2)

    await removeDraftItem({
      brainMapId,
      kind: 'sentence',
      itemId: two.sentences[0]!.id,
      actorId: curator.id,
    })

    const one = (await reread(vocabularyId))!
    expect(one.sentences.map((s) => s.id)).toEqual([two.sentences[1]!.id])
    expect(one.collocations).toHaveLength(1)
  })

  it('stops at the cap rather than growing the map without limit', async () => {
    const { curator, brainMapId } = await draftFor()
    // The draft ships one collocation; the cap is five.
    for (let i = 0; i < 4; i += 1) {
      await saveDraftItem({
        brainMapId,
        kind: 'collocation',
        actorId: curator.id,
        values: { expression: `maintain ${i}`, ko: `유지 ${i}`, exampleSentence: '', importance: '2' },
      })
    }
    await expect(
      saveDraftItem({
        brainMapId,
        kind: 'collocation',
        actorId: curator.id,
        values: { expression: 'one too many', ko: '초과', exampleSentence: '', importance: '2' },
      }),
    ).rejects.toBeInstanceOf(EditError)
  })

  it('refuses an item that belongs to a different word’s map', async () => {
    // An id on its own must never be enough to edit someone else's content.
    const a = await draftFor('maintain')
    const b = await draftFor('preserve')
    await expect(
      saveDraftItem({
        brainMapId: b.brainMapId,
        kind: 'sentence',
        itemId: a.map.sentences[0]!.id,
        actorId: b.curator.id,
        values: {
          text: 'Hijacked sentence goes here.',
          ko: '가로챈 문장',
          targetMeaning: '유지하다',
          highlight: '',
          difficulty: '2',
        },
      }),
    ).rejects.toThrow()

    const untouched = await db
      .select()
      .from(brainMapSentences)
      .where(eq(brainMapSentences.id, a.map.sentences[0]!.id))
    expect(untouched[0]!.text).toBe('She works hard to maintain her health.')
  })

  it('edits the meaning core in place', async () => {
    const { curator, vocabularyId, brainMapId } = await draftFor()
    await saveMeaningCore({
      brainMapId,
      ko: '끊기지 않게 계속 붙잡아 두는 것',
      en: '',
      actorId: curator.id,
    })
    const after = (await reread(vocabularyId))!
    expect(after.meaningCoreKo).toBe('끊기지 않게 계속 붙잡아 두는 것')
    expect(after.meaningCoreEn).toBeNull()
  })

  it('records a version and a snapshot for every change', async () => {
    // There is no undo button, so this is the only way back.
    const { curator, brainMapId, map } = await draftFor()
    await removeDraftItem({
      brainMapId,
      kind: 'collocation',
      itemId: map.collocations[0]!.id,
      actorId: curator.id,
    })
    const revisions = await db
      .select()
      .from(brainMapRevisions)
      .where(eq(brainMapRevisions.brainMapId, brainMapId))
    expect(revisions).toHaveLength(2) // the generated draft, then the delete
    expect(revisions.map((r) => r.changeKind)).toContain('manual_delete')
    expect(new Set(revisions.map((r) => r.version)).size).toBe(2)
  })
})

describe.skipIf(!hasDatabase)('editing a shared confusable pair', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('adds and edits a question inside the pair', async () => {
    const { curator, vocabularyId, brainMapId, map } = await draftFor()
    const pairId = map.similarWords[0]!.pairId

    await saveDraftItem({
      brainMapId,
      kind: 'pairQuestion',
      parentId: pairId,
      actorId: curator.id,
      values: {
        prompt: 'Please ___ your temper.',
        answer: 'keep',
        explanation: '감정은 keep을 씁니다.',
      },
    })

    const after = (await reread(vocabularyId))!
    expect(after.similarWords[0]!.questions).toHaveLength(2)

    await saveDraftItem({
      brainMapId,
      kind: 'pairQuestion',
      itemId: after.similarWords[0]!.questions[1]!.id,
      actorId: curator.id,
      values: {
        prompt: 'Please ___ your temper in public.',
        answer: 'keep',
        explanation: '감정은 keep을 씁니다.',
      },
    })
    const edited = (await reread(vocabularyId))!
    expect(edited.similarWords[0]!.questions[1]!.prompt).toBe('Please ___ your temper in public.')
  })

  it('detaches a pair from this map but keeps it for the other word', async () => {
    // "maintain vs keep" is one shared row. Removing it from maintain's map
    // must not erase it from keep's.
    const { curator, vocabularyId, brainMapId, map } = await draftFor('maintain')
    const pairId = map.similarWords[0]!.pairId

    const { id: otherVocab } = await findOrCreateVocabulary({ lemma: 'keep', partOfSpeech: 'verb' })
    const otherMapId = await writeDraft(
      otherVocab,
      { ...DRAFT, similarWords: [] },
      { createdBy: curator.id },
    )
    await db.insert(brainMapSimilarWords).values({ brainMapId: otherMapId, pairId, sortOrder: 0 })

    await removeDraftItem({ brainMapId, kind: 'pair', itemId: pairId, actorId: curator.id })

    expect((await reread(vocabularyId))!.similarWords).toEqual([])
    expect(await db.select().from(wordPairs).where(eq(wordPairs.id, pairId))).toHaveLength(1)
    expect(
      await db.select().from(wordPairQuestions).where(eq(wordPairQuestions.pairId, pairId)),
    ).not.toHaveLength(0)
  })

  it('cleans up a pair nothing else points at', async () => {
    const { curator, brainMapId, map } = await draftFor()
    const pairId = map.similarWords[0]!.pairId
    await removeDraftItem({ brainMapId, kind: 'pair', itemId: pairId, actorId: curator.id })
    expect(await db.select().from(wordPairs).where(eq(wordPairs.id, pairId))).toEqual([])
  })

  it('adds a confusable without wiping an existing pair’s questions', async () => {
    // The bulk writer replaces a pair's questions wholesale; adding one by hand
    // must not, or the other word's material would vanish.
    const { curator, brainMapId, map } = await draftFor('maintain')
    const pairId = map.similarWords[0]!.pairId
    await removeDraftItem({ brainMapId, kind: 'pair', itemId: pairId, actorId: curator.id })

    const other = await draftFor('preserve')
    const sharedId = other.map.similarWords[0]!.pairId
    const questionsBefore = await db
      .select()
      .from(wordPairQuestions)
      .where(eq(wordPairQuestions.pairId, sharedId))

    await saveDraftItem({
      brainMapId,
      kind: 'pair',
      actorId: curator.id,
      values: { lemma: 'keep', coreDifference: '손질해서 지키는가, 그냥 두는가의 차이.', usageRule: '' },
    })

    const linked = await db
      .select()
      .from(brainMapSimilarWords)
      .where(eq(brainMapSimilarWords.brainMapId, brainMapId))
    expect(linked).toHaveLength(1)
    expect(
      await db.select().from(wordPairQuestions).where(eq(wordPairQuestions.pairId, sharedId)),
    ).toHaveLength(questionsBefore.length)
  })

  it('publishes a confusable added by hand to an already published map', async () => {
    // Students only see approved pairs, so adding one to a live map and having
    // it silently not appear would be worse than not offering the button.
    const { curator, vocabularyId, brainMapId, map } = await draftFor('maintain')
    await removeDraftItem({
      brainMapId,
      kind: 'pair',
      itemId: map.similarWords[0]!.pairId,
      actorId: curator.id,
    })
    await setBrainMapStatus(brainMapId, 'approved', curator.id)

    await saveDraftItem({
      brainMapId,
      kind: 'pair',
      actorId: curator.id,
      values: { lemma: 'keep', coreDifference: '손질해서 지키는가, 그냥 두는가의 차이.', usageRule: '' },
    })

    const asStudent = await getMasterBrainMap(vocabularyId, { approvedOnly: true })
    expect(asStudent!.similarWords.map((p) => p.otherLemma)).toEqual(['keep'])
  })

  it('leaves a confusable on an unpublished draft unpublished', async () => {
    const { curator, vocabularyId, brainMapId, map } = await draftFor('maintain')
    await removeDraftItem({
      brainMapId,
      kind: 'pair',
      itemId: map.similarWords[0]!.pairId,
      actorId: curator.id,
    })
    await saveDraftItem({
      brainMapId,
      kind: 'pair',
      actorId: curator.id,
      values: { lemma: 'keep', coreDifference: '손질해서 지키는가, 그냥 두는가의 차이.', usageRule: '' },
    })
    const [pair] = await db.select().from(wordPairs).where(eq(wordPairs.lemmaB, 'maintain'))
    expect(pair!.status).toBe('draft_ai')
    expect(await getMasterBrainMap(vocabularyId, { approvedOnly: true })).toBeNull()
  })

  it('refuses to touch a pair through a map that does not teach it', async () => {
    const a = await draftFor('maintain')
    const b = await draftFor('preserve')
    await expect(
      removeDraftItem({
        brainMapId: b.brainMapId,
        kind: 'pair',
        itemId: a.map.similarWords[0]!.pairId,
        actorId: b.curator.id,
      }),
    ).rejects.toThrow()
    expect(
      await db
        .select()
        .from(brainMapSimilarWords)
        .where(
          and(
            eq(brainMapSimilarWords.brainMapId, a.brainMapId),
            eq(brainMapSimilarWords.pairId, a.map.similarWords[0]!.pairId),
          ),
        ),
    ).toHaveLength(1)
  })
})
