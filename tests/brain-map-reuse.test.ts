import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { aiGenerationJobs, brainMapRevisions, brainMaps, wordPairs } from '@/lib/db/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { ensureBrainMap, getMasterBrainMap, setBrainMapStatus, writeDraft } from '@/lib/data/brain-map'
import { MockProvider, setLLMProvider } from '@/lib/ai/provider'
import type { BrainMapDraft } from '@/lib/ai/schema'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

const draft = (lemma: string, similar: string): BrainMapDraft => ({
  meaningCoreKo: `${lemma}의 중심 의미를 설명하는 한 문장.`,
  meaningCoreEn: null,
  primaryTranslations: ['뜻'],
  meanings: [
    { ko: '기본 뜻', enDefinition: null, connectionNote: '중심 의미에서 바로 나온다.', exampleChunk: null },
  ],
  sentences: [
    {
      text: `They ${lemma} the standard every year.`,
      ko: '그들은 매년 그 기준을 지킨다.',
      targetMeaning: '기준을 지키다',
      highlight: lemma,
      difficulty: 2,
    },
  ],
  collocations: [
    { expression: `${lemma} quality`, ko: '품질을 유지하다', exampleSentence: null, importance: 1 },
  ],
  wordFamily: [],
  similarWords: [
    {
      lemma: similar,
      coreDifference: '노력이 들어가는지 여부가 다르다.',
      usageRule: null,
      questions: [
        { prompt: `Please ___ the door open.`, answer: similar, explanation: '일상적 표현이다.' },
      ],
    },
  ],
})

describe.skipIf(!hasDatabase)('master brain map reuse', () => {
  beforeEach(async () => {
    await resetDatabase()
    setLLMProvider(null)
  })

  it('generates a map once and reuses it for every later request', async () => {
    const mock = new MockProvider()
    mock.register('maintain', draft('maintain', 'keep'))
    setLLMProvider(mock)

    const { id } = await findOrCreateVocabulary({ lemma: 'maintain', partOfSpeech: 'verb' })

    const first = await ensureBrainMap(id)
    expect(first.outcome).toBe('generated')

    // A second student reaching the same word must not trigger a second call.
    const second = await ensureBrainMap(id)
    expect(second.outcome).toBe('reused')

    const third = await ensureBrainMap(id)
    expect(third.outcome).toBe('reused')

    expect(await db.select().from(brainMaps)).toHaveLength(1)
    const jobs = await db.select().from(aiGenerationJobs)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.status).toBe('succeeded')
  })

  it('lets only one of two concurrent requests do the generating', async () => {
    const mock = new MockProvider()
    mock.register('affect', draft('affect', 'effect'))
    setLLMProvider(mock)

    const { id } = await findOrCreateVocabulary({ lemma: 'affect', partOfSpeech: 'verb' })
    const results = await Promise.allSettled([ensureBrainMap(id), ensureBrainMap(id)])

    const outcomes = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof ensureBrainMap>>> =>
        r.status === 'fulfilled',
      )
      .map((r) => r.value.outcome)

    expect(outcomes.filter((o) => o === 'generated')).toHaveLength(1)
    expect(await db.select().from(brainMaps)).toHaveLength(1)
  })

  it('records the failure and releases the lock when the model output is unusable', async () => {
    const mock = new MockProvider()
    mock.register('issue', { meaningCoreKo: 'x' })
    setLLMProvider(mock)

    const { id } = await findOrCreateVocabulary({ lemma: 'issue', partOfSpeech: 'noun' })
    await expect(ensureBrainMap(id)).rejects.toThrow()

    const jobs = await db.select().from(aiGenerationJobs).where(eq(aiGenerationJobs.vocabularyId, id))
    expect(jobs[0]!.status).toBe('failed')
    expect(jobs[0]!.error).toBeTruthy()
    expect(await db.select().from(brainMaps)).toHaveLength(0)

    // The lock is a partial index over in-flight jobs, so a retry can proceed.
    mock.register('issue', draft('issue', 'problem'))
    const retry = await ensureBrainMap(id)
    expect(retry.outcome).toBe('generated')
  })

  it('shares one confusion pair between both words in it', async () => {
    const admin = await createUser('admin')
    const maintain = await findOrCreateVocabulary({ lemma: 'maintain', partOfSpeech: 'verb' })
    const keep = await findOrCreateVocabulary({ lemma: 'keep', partOfSpeech: 'verb' })

    await writeDraft(maintain.id, draft('maintain', 'keep'), { createdBy: admin.id })
    await writeDraft(keep.id, draft('keep', 'maintain'), { createdBy: admin.id })

    // "maintain vs keep" and "keep vs maintain" must be the same row.
    expect(await db.select().from(wordPairs)).toHaveLength(1)

    await setBrainMapStatus((await db.select().from(brainMaps).where(eq(brainMaps.vocabularyId, maintain.id)))[0]!.id, 'approved', admin.id)
    await setBrainMapStatus((await db.select().from(brainMaps).where(eq(brainMaps.vocabularyId, keep.id)))[0]!.id, 'approved', admin.id)

    const fromMaintain = await getMasterBrainMap(maintain.id, { approvedOnly: true })
    const fromKeep = await getMasterBrainMap(keep.id, { approvedOnly: true })

    expect(fromMaintain!.similarWords[0]!.pairId).toBe(fromKeep!.similarWords[0]!.pairId)
    // Each side shows the student the *other* word.
    expect(fromMaintain!.similarWords[0]!.otherLemma).toBe('keep')
    expect(fromKeep!.similarWords[0]!.otherLemma).toBe('maintain')
  })

  it('hides unapproved content from students but shows it to curators', async () => {
    const admin = await createUser('admin')
    const { id } = await findOrCreateVocabulary({ lemma: 'supply', partOfSpeech: 'noun' })
    await writeDraft(id, draft('supply', 'provide'), { createdBy: admin.id })

    expect(await getMasterBrainMap(id, { approvedOnly: true })).toBeNull()
    const asCurator = await getMasterBrainMap(id, { approvedOnly: false })
    expect(asCurator!.status).toBe('draft_ai')

    await setBrainMapStatus(asCurator!.id, 'approved', admin.id)
    const asStudent = await getMasterBrainMap(id, { approvedOnly: true })
    expect(asStudent!.status).toBe('approved')
    // Approving the map must also release the pairs it teaches.
    expect(asStudent!.similarWords).toHaveLength(1)
  })

  it('keeps a revision history across regeneration', async () => {
    const admin = await createUser('admin')
    const { id } = await findOrCreateVocabulary({ lemma: 'demand', partOfSpeech: 'noun' })

    await writeDraft(id, draft('demand', 'request'), { createdBy: admin.id })
    const v1 = (await db.select().from(brainMaps).where(eq(brainMaps.vocabularyId, id)))[0]!
    expect(v1.version).toBe(1)

    const revised = { ...draft('demand', 'request'), meaningCoreKo: '수정된 중심 의미 문장입니다.' }
    await writeDraft(id, revised, { createdBy: admin.id })

    const v2 = (await db.select().from(brainMaps).where(eq(brainMaps.vocabularyId, id)))[0]!
    expect(v2.id).toBe(v1.id)
    expect(v2.version).toBe(2)
    expect(v2.meaningCoreKo).toBe('수정된 중심 의미 문장입니다.')

    const revisions = await db
      .select()
      .from(brainMapRevisions)
      .where(eq(brainMapRevisions.brainMapId, v1.id))
    expect(revisions.map((r) => r.version).sort()).toEqual([1, 2])
  })
})
