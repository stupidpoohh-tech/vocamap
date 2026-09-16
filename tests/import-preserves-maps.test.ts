import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  brainMapMeanings,
  brainMapRevisions,
  brainMaps,
  vocabularyTranslations,
} from '@/lib/db/schema'
import { getMasterBrainMap, setBrainMapStatus, writeDraft } from '@/lib/data/brain-map'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { importWordbook } from '@/lib/import/import-wordbook'
import { brainMapDraftSchema } from '@/lib/ai/schema'
import { recordRecallAnswer } from '@/lib/data/study'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

const actorFrom = (u: { id: string; email: string; displayName: string }) => ({
  ...u,
  role: 'teacher' as const,
})

/** The curated map a teacher reviewed and a student has been studying. */
const CURATED = brainMapDraftSchema.parse({
  meaningCoreKo: '어떤 상태가 이어지도록 계속 붙들고 있는 것.',
  meaningCoreEn: null,
  primaryTranslations: ['유지하다'],
  meanings: [
    {
      ko: '유지하다, 지속하다',
      enDefinition: 'to keep something in the same condition',
      enDefinitionKo: '무언가를 같은 상태로 계속 두다.',
      connectionNote: '붙들고 있으니 상태가 그대로 이어진다.',
      exampleChunk: 'maintain a balance',
    },
  ],
  sentences: [
    {
      text: 'Engineers maintain the bridge every spring.',
      ko: '기술자들이 매년 봄 다리를 점검한다.',
      targetMeaning: '유지하다',
      highlight: 'maintain',
      difficulty: 2,
    },
  ],
  collocations: [],
  wordFamily: [],
  similarWords: [],
})

/** The same word typed into a paste box, worded differently. */
const PASTED = `어휘 | 영영 풀이 | 의미
maintain | to declare something is true | 주장하다
newcomer | a person who has recently arrived | 신입`

async function snapshot(vocabularyId: string) {
  const [head] = await db.select().from(brainMaps).where(eq(brainMaps.vocabularyId, vocabularyId))
  const meanings = await db
    .select()
    .from(brainMapMeanings)
    .where(eq(brainMapMeanings.brainMapId, head!.id))
  const translations = await db
    .select()
    .from(vocabularyTranslations)
    .where(eq(vocabularyTranslations.vocabularyId, vocabularyId))
  const revisions = await db
    .select()
    .from(brainMapRevisions)
    .where(eq(brainMapRevisions.brainMapId, head!.id))
  return { head, meanings, translations, revisions }
}

describe.skipIf(!hasDatabase)('importing a word that already has a map', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('leaves the approved public map exactly as it was', async () => {
    // The vulnerability: import called `writeDraft` for every word it touched,
    // including ones it had merely found again. That bumped the version, reset
    // the approval, and dropped and rebuilt every child row with new ids —
    // so pasting a vocabulary list silently replaced reviewed public content.
    const curator = await createUser('teacher')
    const teacher = await createUser('teacher')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })
    const brainMapId = await writeDraft(vocabularyId, CURATED, {
      status: 'approved',
      createdBy: curator.id,
    })
    await setBrainMapStatus(brainMapId, 'approved', curator.id)

    const before = await snapshot(vocabularyId)

    const summary = await importWordbook({
      text: PASTED,
      title: '9월 범위',
      actor: actorFrom(teacher),
    })

    const after = await snapshot(vocabularyId)

    expect(after.head).toEqual(before.head)
    expect(after.meanings).toEqual(before.meanings)
    expect(after.translations).toEqual(before.translations)
    expect(after.revisions).toEqual(before.revisions)
    expect(summary.keptExistingMap).toEqual(['maintain'])
  })

  it('says so, rather than merging the new wording in', async () => {
    const curator = await createUser('teacher')
    const teacher = await createUser('teacher')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })
    await writeDraft(vocabularyId, CURATED, { status: 'approved', createdBy: curator.id })

    const summary = await importWordbook({
      text: PASTED,
      title: '9월 범위',
      actor: actorFrom(teacher),
    })

    expect(summary.keptExistingMap).toContain('maintain')

    // The paste said 주장하다; the map still says what the curator wrote.
    const map = await getMasterBrainMap(vocabularyId, { approvedOnly: false })
    expect(map!.meanings.map((m) => m.ko)).toEqual(['유지하다, 지속하다'])
    expect(map!.meanings[0]!.enDefinition).toBe('to keep something in the same condition')
  })

  it('does not disturb what the student has already done with it', async () => {
    const curator = await createUser('teacher')
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })
    await writeDraft(vocabularyId, CURATED, { status: 'approved', createdBy: curator.id })

    await recordRecallAnswer({ userId: student.id, vocabularyId, direction: 'en_ko', correct: false })
    const { userVocabularyCards } = await import('@/lib/db/schema')
    const before = await db
      .select()
      .from(userVocabularyCards)
      .where(eq(userVocabularyCards.vocabularyId, vocabularyId))

    await importWordbook({ text: PASTED, title: '9월 범위', actor: actorFrom(teacher) })

    const after = await db
      .select()
      .from(userVocabularyCards)
      .where(eq(userVocabularyCards.vocabularyId, vocabularyId))
    expect(after).toEqual(before)
    expect(before.length).toBeGreaterThan(0)
  })

  it('still adds the word to the set it was imported into', async () => {
    // Reusing the map must not mean skipping the word — the set is the point
    // of the import and the word belongs in it either way.
    const curator = await createUser('teacher')
    const teacher = await createUser('teacher')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })
    await writeDraft(vocabularyId, CURATED, { status: 'approved', createdBy: curator.id })

    const summary = await importWordbook({
      text: PASTED,
      title: '9월 범위',
      actor: actorFrom(teacher),
    })

    const { vocabularySetItems } = await import('@/lib/db/schema')
    const items = await db
      .select({ vocabularyId: vocabularySetItems.vocabularyId })
      .from(vocabularySetItems)
      .where(eq(vocabularySetItems.setId, summary.setId))
    expect(items.map((i) => i.vocabularyId)).toContain(vocabularyId)
    expect(items).toHaveLength(2)
  })

  it('writes a map for the word in the same paste that had none', async () => {
    // Only the word with an existing map is left alone. The rest of the paste
    // imports normally — the fix is a boundary, not a shutdown.
    const curator = await createUser('teacher')
    const teacher = await createUser('teacher')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })
    await writeDraft(vocabularyId, CURATED, { status: 'approved', createdBy: curator.id })

    const summary = await importWordbook({
      text: PASTED,
      title: '9월 범위',
      actor: actorFrom(teacher),
    })

    const { vocabularies } = await import('@/lib/db/schema')
    const [newcomer] = await db
      .select({ id: vocabularies.id })
      .from(vocabularies)
      .where(eq(vocabularies.lemma, 'newcomer'))
    expect(newcomer).toBeDefined()

    const map = await getMasterBrainMap(newcomer!.id, { approvedOnly: false })
    expect(map).not.toBeNull()
    expect(map!.meanings.map((m) => m.ko)).toEqual(['신입'])
    expect(summary.keptExistingMap).not.toContain('newcomer')
  })
})

describe.skipIf(!hasDatabase)('two imports of the same new word at once', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('produces one map, and the second import does not overwrite the first', async () => {
    // A pre-check cannot settle this: under a connection pool both imports read
    // "no map yet" before either writes. The unique index on
    // brain_maps.vocabulary_id is what actually decides, and the loser has to
    // stop without touching a child row.
    const a = await createUser('teacher')
    const b = await createUser('teacher')

    const text = `어휘 | 영영 풀이 | 의미
concurrent | happening at the same time | 동시에 일어나는`

    const [first, second] = await Promise.all([
      importWordbook({ text, title: 'A 범위', actor: actorFrom(a) }),
      importWordbook({ text, title: 'B 범위', actor: actorFrom(b) }),
    ])

    const heads = await db.select().from(brainMaps)
    expect(heads).toHaveLength(1)
    expect(heads[0]!.version).toBe(1)

    // Exactly one of the two wrote it; the other reported that it kept what was
    // there. Which one wins is a race and does not matter.
    const kept = [...first.keptExistingMap, ...second.keptExistingMap]
    expect(kept).toEqual(['concurrent'])

    // One body, written once — not two rounds of delete-and-rebuild.
    const meanings = await db
      .select()
      .from(brainMapMeanings)
      .where(eq(brainMapMeanings.brainMapId, heads[0]!.id))
    expect(meanings).toHaveLength(1)

    const revisions = await db
      .select()
      .from(brainMapRevisions)
      .where(eq(brainMapRevisions.brainMapId, heads[0]!.id))
    expect(revisions).toHaveLength(1)

    // Both sets still got the word.
    const { vocabularySetItems } = await import('@/lib/db/schema')
    const items = await db.select().from(vocabularySetItems)
    expect(items).toHaveLength(2)
  })

  it('leaves the same result when the same paste is imported twice in a row', async () => {
    const teacher = await createUser('teacher')
    const text = `어휘 | 영영 풀이 | 의미
sequential | following one after another | 순차적인`

    await importWordbook({ text, title: '1차', actor: actorFrom(teacher) })
    const [head] = await db.select().from(brainMaps)
    const second = await importWordbook({ text, title: '2차', actor: actorFrom(teacher) })

    const [after] = await db.select().from(brainMaps)
    expect(after).toEqual(head)
    expect(second.keptExistingMap).toEqual(['sequential'])
  })
})

describe.skipIf(!hasDatabase)('the curator’s own replace path', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('still replaces a map when asked to explicitly', async () => {
    // The fix must not take the curator's regenerate button away with it:
    // `writeDraft` is still a replacement, it is just no longer reachable from
    // the import path.
    const curator = await createUser('teacher')
    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'maintain' })
    await writeDraft(vocabularyId, CURATED, { status: 'approved', createdBy: curator.id })

    const revised = brainMapDraftSchema.parse({
      ...CURATED,
      meanings: [{ ...CURATED.meanings[0]!, ko: '고쳐 쓴 뜻' }],
    })
    await writeDraft(vocabularyId, revised, { status: 'approved', createdBy: curator.id })

    const [head] = await db.select().from(brainMaps).where(eq(brainMaps.vocabularyId, vocabularyId))
    expect(head!.version).toBe(2)
    const map = await getMasterBrainMap(vocabularyId, { approvedOnly: false })
    expect(map!.meanings.map((m) => m.ko)).toEqual(['고쳐 쓴 뜻'])
  })
})
