import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { vocabularies, vocabularyTranslations } from '@/lib/db/schema'
import {
  findOrCreateVocabulary,
  importVocabularyList,
  searchVocabulary,
} from '@/lib/data/vocabulary'
import { hasDatabase, resetDatabase } from './helpers/db'

describe.skipIf(!hasDatabase)('shared vocabulary knowledge base', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates a word once and reuses it thereafter', async () => {
    const first = await findOrCreateVocabulary({ lemma: 'maintain', partOfSpeech: 'verb' })
    const second = await findOrCreateVocabulary({ lemma: 'maintain', partOfSpeech: 'verb' })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.id).toBe(first.id)

    const rows = await db.select().from(vocabularies)
    expect(rows).toHaveLength(1)
  })

  it('treats case and surrounding whitespace as the same word', async () => {
    const a = await findOrCreateVocabulary({ lemma: 'Maintain', partOfSpeech: 'verb' })
    const b = await findOrCreateVocabulary({ lemma: '  MAINTAIN  ', partOfSpeech: 'verb' })
    expect(b.id).toBe(a.id)
    expect(b.created).toBe(false)
  })

  it('keeps homographs with different parts of speech apart', async () => {
    const noun = await findOrCreateVocabulary({ lemma: 'issue', partOfSpeech: 'noun' })
    const verb = await findOrCreateVocabulary({ lemma: 'issue', partOfSpeech: 'verb' })
    expect(verb.id).not.toBe(noun.id)
    expect(verb.created).toBe(true)
  })

  it('deduplicates a word with no part of speech recorded', async () => {
    const a = await findOrCreateVocabulary({ lemma: 'account' })
    const b = await findOrCreateVocabulary({ lemma: 'account' })
    expect(b.id).toBe(a.id)
    const rows = await db.select().from(vocabularies)
    expect(rows).toHaveLength(1)
  })

  it('survives the database-level unique constraint being hit directly', async () => {
    await findOrCreateVocabulary({ lemma: 'demand', partOfSpeech: 'noun' })
    await expect(
      db.insert(vocabularies).values({ lemma: 'demand', partOfSpeech: 'noun', language: 'en' }),
    ).rejects.toThrow()
  })

  it('reuses existing words when a teacher imports an overlapping list', async () => {
    await importVocabularyList([
      { lemma: 'maintain', partOfSpeech: 'verb' },
      { lemma: 'affect', partOfSpeech: 'verb' },
    ])

    const second = await importVocabularyList([
      { lemma: 'maintain', partOfSpeech: 'verb' },
      { lemma: 'affect', partOfSpeech: 'verb' },
      { lemma: 'supply', partOfSpeech: 'noun' },
    ])

    expect(second.reused).toHaveLength(2)
    expect(second.created).toHaveLength(1)
    expect(await db.select().from(vocabularies)).toHaveLength(3)
  })

  it('adds translations without duplicating them', async () => {
    const { id } = await findOrCreateVocabulary({
      lemma: 'maintain',
      translations: ['유지하다', '주장하다'],
    })
    await findOrCreateVocabulary({ lemma: 'maintain', translations: ['유지하다', '정비하다'] })

    const rows = await db
      .select()
      .from(vocabularyTranslations)
      .where(eq(vocabularyTranslations.vocabularyId, id))
    expect(rows).toHaveLength(3)
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1)
  })

  it('searches by English prefix and by Korean meaning', async () => {
    await findOrCreateVocabulary({
      lemma: 'maintain',
      partOfSpeech: 'verb',
      translations: ['유지하다'],
    })
    await findOrCreateVocabulary({ lemma: 'supply', partOfSpeech: 'noun', translations: ['공급'] })

    const byEnglish = await searchVocabulary('main')
    expect(byEnglish.map((r) => r.lemma)).toContain('maintain')

    const byKorean = await searchVocabulary('유지')
    expect(byKorean.map((r) => r.lemma)).toContain('maintain')

    expect(await searchVocabulary('   ')).toEqual([])
  })
})
