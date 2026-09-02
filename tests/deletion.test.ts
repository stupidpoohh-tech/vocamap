import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  brainMapSimilarWords,
  brainMaps,
  reviewEvents,
  userVocabularyCards,
  vocabularies,
  wordPairQuestions,
  wordPairs,
} from '@/lib/db/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { getMasterBrainMap, writeDraft } from '@/lib/data/brain-map'
import { deleteBrainMap, deleteVocabulary } from '@/lib/data/brain-map-edit'
import { recordRecallAnswer } from '@/lib/data/study'
import { SEED_WORDS } from '@/lib/seed/words'
import { brainMapDraftSchema } from '@/lib/ai/schema'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

async function mapped(lemma: string) {
  const curator = await createUser('teacher')
  const student = await createUser('student')
  const word = SEED_WORDS.find((w) => w.lemma === lemma)!
  const { id: vocabularyId } = await findOrCreateVocabulary({
    lemma,
    partOfSpeech: word.partOfSpeech,
    translations: word.translations,
  })
  const brainMapId = await writeDraft(vocabularyId, brainMapDraftSchema.parse(word.brainMap), {
    createdBy: curator.id,
  })
  return { curator, student, vocabularyId, brainMapId }
}

describe.skipIf(!hasDatabase)('deleting a map', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('removes the map but leaves the word and the student’s history', async () => {
    const { curator, student, vocabularyId, brainMapId } = await mapped('issue')
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId,
      direction: 'en_ko',
      correct: false,
    })

    await deleteBrainMap({ brainMapId, actorId: curator.id })

    expect(await getMasterBrainMap(vocabularyId, { approvedOnly: false })).toBeNull()
    // A map is content, not progress: the word can still be drilled tomorrow.
    expect(await db.select().from(vocabularies).where(eq(vocabularies.id, vocabularyId))).toHaveLength(1)
    expect(
      await db.select().from(userVocabularyCards).where(eq(userVocabularyCards.vocabularyId, vocabularyId)),
    ).not.toHaveLength(0)
    expect(
      await db.select().from(reviewEvents).where(eq(reviewEvents.vocabularyId, vocabularyId)),
    ).not.toHaveLength(0)
  })

  it('keeps a shared confusable that another word still teaches', async () => {
    const a = await mapped('issue')
    const pairId = (await getMasterBrainMap(a.vocabularyId, { approvedOnly: false }))!
      .similarWords[0]!.pairId

    const { id: other } = await findOrCreateVocabulary({ lemma: 'matter', partOfSpeech: 'noun' })
    const otherMap = await writeDraft(
      other,
      brainMapDraftSchema.parse({ ...SEED_WORDS.find((w) => w.lemma === 'issue')!.brainMap, similarWords: [] }),
      { createdBy: a.curator.id },
    )
    await db.insert(brainMapSimilarWords).values({ brainMapId: otherMap, pairId, sortOrder: 0 })

    await deleteBrainMap({ brainMapId: a.brainMapId, actorId: a.curator.id })

    expect(await db.select().from(wordPairs).where(eq(wordPairs.id, pairId))).toHaveLength(1)
    expect(
      await db.select().from(wordPairQuestions).where(eq(wordPairQuestions.pairId, pairId)),
    ).not.toHaveLength(0)
  })

  it('takes a pair nothing else points at with it', async () => {
    const { curator, vocabularyId, brainMapId } = await mapped('issue')
    const pairId = (await getMasterBrainMap(vocabularyId, { approvedOnly: false }))!
      .similarWords[0]!.pairId

    await deleteBrainMap({ brainMapId, actorId: curator.id })
    expect(await db.select().from(wordPairs).where(eq(wordPairs.id, pairId))).toEqual([])
  })
})

describe.skipIf(!hasDatabase)('deleting a word', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('takes the map and every student’s record of it', async () => {
    // The destructive one. Nothing here can be reconstructed, which is why the
    // screen asks before calling it.
    const { curator, student, vocabularyId, brainMapId } = await mapped('issue')
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId,
      direction: 'en_ko',
      correct: true,
    })

    const { lemma } = await deleteVocabulary({ vocabularyId, actorId: curator.id })
    expect(lemma).toBe('issue')

    expect(await db.select().from(vocabularies).where(eq(vocabularies.id, vocabularyId))).toEqual([])
    expect(await db.select().from(brainMaps).where(eq(brainMaps.id, brainMapId))).toEqual([])
    expect(
      await db.select().from(userVocabularyCards).where(eq(userVocabularyCards.vocabularyId, vocabularyId)),
    ).toEqual([])
    expect(
      await db.select().from(reviewEvents).where(eq(reviewEvents.vocabularyId, vocabularyId)),
    ).toEqual([])
  })

  it('deletes a word that never had a map', async () => {
    // Otherwise a mistyped import sits in the library forever: a word with no
    // map never reaches the review screen.
    const curator = await createUser('teacher')
    const { id } = await findOrCreateVocabulary({ lemma: 'mistyppe', partOfSpeech: 'noun' })
    await deleteVocabulary({ vocabularyId: id, actorId: curator.id })
    expect(await db.select().from(vocabularies).where(eq(vocabularies.id, id))).toEqual([])
  })

  it('refuses a word that is not there', async () => {
    const curator = await createUser('teacher')
    await expect(
      deleteVocabulary({
        vocabularyId: '00000000-0000-0000-0000-000000000000',
        actorId: curator.id,
      }),
    ).rejects.toThrow()
  })
})
