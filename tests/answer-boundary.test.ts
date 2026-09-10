import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  brainMapMeanings,
  brainMapNodeProgress,
  brainMaps,
  reviewEvents,
  userVocabularyCards,
} from '@/lib/db/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { buildSemanticMap } from '@/lib/data/semantic-map'
import { questionStillStands, setBrainMapStatus, writeDraft } from '@/lib/data/brain-map'
import { buildQuestions } from '@/lib/learning/questions'
import { buildScopedQueue, recordExtendedAnswer, recordRecallAnswer } from '@/lib/data/study'
import { addToSet, createSet } from '@/lib/data/teacher'
import { brainMapDraftSchema } from '@/lib/ai/schema'
import { grade, verifyQuestion } from '@/lib/learning/question-token'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

const DRAFT = brainMapDraftSchema.parse({
  meaningCoreKo: '어떤 상태가 이어지도록 계속 붙들고 있는 것.',
  meaningCoreEn: null,
  primaryTranslations: ['유지하다'],
  meanings: [
    {
      ko: '유지하다, 지속하다',
      enDefinition: 'to keep something in the same condition',
      enDefinitionKo: null,
      connectionNote: '붙들고 있으니 상태가 그대로 이어진다.',
      exampleChunk: 'maintain a balance',
    },
    {
      ko: '주장하다',
      enDefinition: 'to say firmly that something is true',
      enDefinitionKo: null,
      connectionNote: '입장을 붙들고 놓지 않는다.',
      exampleChunk: 'maintain that it is true',
    },
  ],
  sentences: [
    {
      text: 'Engineers maintain the bridge every spring.',
      ko: '기술자들이 매년 봄 다리를 점검한다.',
      targetMeaning: '유지하다, 지속하다',
      highlight: 'maintain',
      difficulty: 2,
    },
  ],
  collocations: [
    { expression: 'maintain a balance', ko: '균형을 유지하다', exampleSentence: null, importance: 1 },
    { expression: 'maintain order', ko: '질서를 유지하다', exampleSentence: null, importance: 2 },
  ],
  wordFamily: [
    { lemma: 'maintenance', partOfSpeech: 'noun', ko: '유지, 관리', exampleSentence: null },
  ],
  similarWords: [],
})

async function mappedSet() {
  const teacher = await createUser('teacher')
  const student = await createUser('student')
  const ids: string[] = []
  for (const [lemma, ko] of [
    ['maintain', '유지하다'],
    ['declare', '선언하다'],
    ['abandon', '포기하다'],
    ['connect', '연결하다'],
  ] as const) {
    const { id } = await findOrCreateVocabulary({ lemma, translations: [ko] })
    ids.push(id)
  }
  const setId = await createSet({ ownerId: teacher.id, title: '범위' })
  await addToSet(setId, ids)
  const brainMapId = await writeDraft(ids[0]!, DRAFT, { status: 'approved', createdBy: teacher.id })
  await setBrainMapStatus(brainMapId, 'approved', teacher.id)
  return { teacher, student, setId, mappedId: ids[0]!, brainMapId }
}

/* ═══ P1-2 · the map's own cards are graded by the server too ════════════ */

describe.skipIf(!hasDatabase)('a card inside the map', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('goes out with the server’s signed record of it', async () => {
    // This was the one answer path still grading itself: the page worked out
    // `correct` and posted it, so anything reaching the action could mark any
    // node of any word right, for anyone, as often as it liked.
    const { student, mappedId } = await mappedSet()
    const map = (await buildSemanticMap(student.id, mappedId))!

    const choices = map.nodes.flatMap((n) => n.exercises.filter((e) => e.kind === 'choice'))
    expect(choices.length).toBeGreaterThan(0)
    for (const exercise of choices) expect(exercise.token).toBeTruthy()
  })

  it('signs the reader, the word, the item, the node and the map version', async () => {
    const { student, mappedId, brainMapId } = await mappedSet()
    const map = (await buildSemanticMap(student.id, mappedId))!
    const [head] = await db.select().from(brainMaps).where(eq(brainMaps.id, brainMapId))

    const node = map.nodes.find((n) => n.exercises.some((e) => e.kind === 'choice'))!
    const exercise = node.exercises.find((e) => e.kind === 'choice')!
    const claims = (await verifyQuestion(exercise.token!))!

    expect(claims.userId).toBe(student.id)
    expect(claims.vocabularyId).toBe(mappedId)
    expect(claims.itemId).toBe(node.itemId)
    expect(claims.node).toBe(node.progressNode)
    expect(claims.contentVersion).toBe(head!.version)
    expect(claims.options).toEqual(exercise.options)
  })

  it('does not leave a reveal card gradable', async () => {
    // Reveal cards are read, not answered, so there is nothing to sign.
    const { student, mappedId } = await mappedSet()
    const map = (await buildSemanticMap(student.id, mappedId))!
    for (const node of map.nodes) {
      for (const exercise of node.exercises) {
        if (exercise.kind === 'translate') expect(exercise.token).toBeUndefined()
      }
    }
  })

  it('refuses an option that was never offered', async () => {
    const { student, mappedId } = await mappedSet()
    const map = (await buildSemanticMap(student.id, mappedId))!
    const exercise = map.nodes.flatMap((n) => n.exercises).find((e) => e.kind === 'choice')!
    const claims = (await verifyQuestion(exercise.token!))!

    expect(grade(claims, '내가 지어낸 답')).toEqual({ offered: false, correct: false })
  })

  it('mints a different submission id for each reader', async () => {
    const { mappedId } = await mappedSet()
    const other = await createUser('student')
    const mine = await createUser('student')

    const a = (await buildSemanticMap(mine.id, mappedId))!
    const b = (await buildSemanticMap(other.id, mappedId))!
    const claimsA = (await verifyQuestion(
      a.nodes.flatMap((n) => n.exercises).find((e) => e.kind === 'choice')!.token!,
    ))!
    const claimsB = (await verifyQuestion(
      b.nodes.flatMap((n) => n.exercises).find((e) => e.kind === 'choice')!.token!,
    ))!

    expect(claimsA.userId).toBe(mine.id)
    expect(claimsB.userId).toBe(other.id)
    expect(claimsA.submissionId).not.toBe(claimsB.submissionId)
  })
})

/* ══════ P1-2 · a question whose content moved on is not answerable ══════ */

describe.skipIf(!hasDatabase)('a question built from content that has changed', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('still stands while nothing has moved', async () => {
    const { student, mappedId, brainMapId } = await mappedSet()
    const map = (await buildSemanticMap(student.id, mappedId))!
    const [head] = await db.select().from(brainMaps).where(eq(brainMaps.id, brainMapId))
    const node = map.nodes.find((n) => n.exercises.some((e) => e.kind === 'choice'))!

    expect(
      await questionStillStands({
        vocabularyId: mappedId,
        version: head!.version,
        itemId: node.itemId,
      }),
    ).toBe(true)
  })

  it('does not stand once the map has been rewritten', async () => {
    const { teacher, student, mappedId, brainMapId } = await mappedSet()
    const map = (await buildSemanticMap(student.id, mappedId))!
    const [before] = await db.select().from(brainMaps).where(eq(brainMaps.id, brainMapId))
    const node = map.nodes.find((n) => n.exercises.some((e) => e.kind === 'choice'))!

    await writeDraft(mappedId, DRAFT, { status: 'approved', createdBy: teacher.id })

    expect(
      await questionStillStands({
        vocabularyId: mappedId,
        version: before!.version,
        itemId: null,
      }),
    ).toBe(false)
    // And the item it named is gone too — rewriting rebuilds the child rows.
    expect(
      await questionStillStands({ vocabularyId: mappedId, version: null, itemId: node.itemId }),
    ).toBe(false)
  })

  it('does not stand once the map has been unapproved', async () => {
    const { teacher, student, mappedId, brainMapId } = await mappedSet()
    const [head] = await db.select().from(brainMaps).where(eq(brainMaps.id, brainMapId))
    void student

    await setBrainMapStatus(brainMapId, 'needs_review', teacher.id)

    expect(
      await questionStillStands({ vocabularyId: mappedId, version: head!.version, itemId: null }),
    ).toBe(false)
  })

  it('accepts the core node’s derived id, which has no row of its own', async () => {
    // `core:<mapId>` is not an item row. Looking it up would refuse every
    // answer to the one card every mapped word has; the version check above
    // already settles the head it is derived from.
    const { student, mappedId, brainMapId } = await mappedSet()
    const map = (await buildSemanticMap(student.id, mappedId))!
    const [head] = await db.select().from(brainMaps).where(eq(brainMaps.id, brainMapId))
    const core = map.nodes.find((n) => n.kind === 'coreMeaning')!
    expect(core.itemId.startsWith('core:')).toBe(true)

    expect(
      await questionStillStands({
        vocabularyId: mappedId,
        version: head!.version,
        itemId: core.itemId,
      }),
    ).toBe(true)
  })

  it('does not stand for a word with no map at all', async () => {
    const { id } = await findOrCreateVocabulary({ lemma: 'unmapped' })
    expect(await questionStillStands({ vocabularyId: id, version: 1, itemId: null })).toBe(false)
  })

  it('does not stand once the item was deleted', async () => {
    const { student, mappedId, brainMapId } = await mappedSet()
    const map = (await buildSemanticMap(student.id, mappedId))!
    const node = map.nodes.find((n) => n.progressNode === 'collocations')!
    const [head] = await db.select().from(brainMaps).where(eq(brainMaps.id, brainMapId))

    await db.delete(brainMapMeanings).where(eq(brainMapMeanings.brainMapId, brainMapId))

    // The collocation is still there, so the map itself still stands …
    expect(
      await questionStillStands({
        vocabularyId: mappedId,
        version: head!.version,
        itemId: node.itemId,
      }),
    ).toBe(true)
    // … but a question about a meaning that was deleted does not.
    expect(
      await questionStillStands({
        vocabularyId: mappedId,
        version: head!.version,
        itemId: '00000000-0000-0000-0000-000000000000',
      }),
    ).toBe(false)
  })
})

/* ═══ P1-3 · an extended answer is recorded as itself and schedules nothing ══ */

describe.skipIf(!hasDatabase)('an answer to a map question', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('is stored with its real question type, node and item', async () => {
    const { student, mappedId } = await mappedSet()

    await recordExtendedAnswer({
      userId: student.id,
      vocabularyId: mappedId,
      node: 'collocations',
      questionType: 'collocation_cloze',
      correct: true,
      itemId: 'item-1',
      submissionId: '11111111-1111-1111-1111-111111111111',
      payload: { kind: 'collocation' },
    })

    const [event] = await db.select().from(reviewEvents)
    expect(event!.questionType).toBe('collocation_cloze')
    expect(event!.nodeType).toBe('collocations')
    expect((event!.payload as Record<string, unknown>).itemId).toBe('item-1')
    expect((event!.payload as Record<string, unknown>).kind).toBe('collocation')
  })

  it('leaves the basic recall card completely untouched', async () => {
    // The half that was missing. Splitting the questions without splitting the
    // write left `scope=mapped` answers advancing the same FSRS card and being
    // logged as `recall_choice`.
    const { student, mappedId } = await mappedSet()

    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: mappedId,
      direction: 'en_ko',
      correct: true,
      submissionId: '22222222-2222-2222-2222-222222222222',
    })
    const [before] = await db.select().from(userVocabularyCards)

    await recordExtendedAnswer({
      userId: student.id,
      vocabularyId: mappedId,
      node: 'collocations',
      questionType: 'collocation_cloze',
      correct: true,
      submissionId: '33333333-3333-3333-3333-333333333333',
    })

    const [after] = await db.select().from(userVocabularyCards)
    expect(after!.reps).toBe(before!.reps)
    expect(after!.stability).toBe(before!.stability)
    expect(after!.difficulty).toBe(before!.difficulty)
    expect(after!.dueAt.getTime()).toBe(before!.dueAt.getTime())
    expect(after).toEqual(before)
  })

  it('creates no card at all when there was none', async () => {
    const { student, mappedId } = await mappedSet()
    await recordExtendedAnswer({
      userId: student.id,
      vocabularyId: mappedId,
      node: 'collocations',
      questionType: 'collocation_cloze',
      correct: true,
      submissionId: '44444444-4444-4444-4444-444444444444',
    })
    expect(await db.select().from(userVocabularyCards)).toEqual([])
  })

  it('still moves the map’s own progress for that node', async () => {
    const { student, mappedId } = await mappedSet()
    await recordExtendedAnswer({
      userId: student.id,
      vocabularyId: mappedId,
      node: 'collocations',
      questionType: 'collocation_cloze',
      correct: true,
      submissionId: '55555555-5555-5555-5555-555555555555',
    })
    const [progress] = await db.select().from(brainMapNodeProgress)
    expect(progress!.node).toBe('collocations')
    expect(progress!.attempts).toBe(1)
    expect(progress!.correct).toBe(1)
  })

  it('records a resend exactly once', async () => {
    const { student, mappedId } = await mappedSet()
    const answer = {
      userId: student.id,
      vocabularyId: mappedId,
      node: 'collocations' as const,
      questionType: 'collocation_cloze' as const,
      correct: true,
      submissionId: '66666666-6666-6666-6666-666666666666',
    }

    const first = await recordExtendedAnswer(answer)
    const second = await recordExtendedAnswer(answer)

    expect(first.recorded).toBe(true)
    expect(second.recorded).toBe(false)
    expect(await db.select().from(reviewEvents)).toHaveLength(1)
    const [progress] = await db.select().from(brainMapNodeProgress)
    expect(progress!.attempts).toBe(1)
  })

  it('keeps node progress consistent when two answers land at once', async () => {
    const { student, mappedId } = await mappedSet()
    const base = {
      userId: student.id,
      vocabularyId: mappedId,
      node: 'collocations' as const,
      questionType: 'collocation_cloze' as const,
      correct: true,
    }

    await Promise.all([
      recordExtendedAnswer({ ...base, submissionId: '77777777-7777-7777-7777-777777777777' }),
      recordExtendedAnswer({ ...base, submissionId: '88888888-8888-8888-8888-888888888888' }),
    ])

    const [progress] = await db.select().from(brainMapNodeProgress)
    expect(progress!.attempts).toBe(2)
    expect(await db.select().from(reviewEvents)).toHaveLength(2)
  })

  it('basic recall still advances its card normally', async () => {
    const { student, mappedId } = await mappedSet()
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: mappedId,
      direction: 'en_ko',
      correct: true,
      submissionId: '99999999-9999-9999-9999-999999999999',
    })
    const [card] = await db.select().from(userVocabularyCards)
    expect(card!.reps).toBe(1)
    expect(card!.dueAt.getTime()).toBeGreaterThan(Date.now())
  })
})

/* ═══════ P1-3 · what the map test actually issues and how it is kept ═════ */

describe.skipIf(!hasDatabase)('the map test', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('names the item and the node in every extended question it issues', async () => {
    const { student, setId, mappedId } = await mappedSet()
    const queue = await buildScopedQueue(student.id, { scope: 'all', setId })
    const questions = await buildQuestions(student.id, queue, { extended: true })

    const extended = questions.filter((q) => q.vocabularyId === mappedId && q.kind !== 'gloss')
    expect(extended.length).toBeGreaterThan(0)
    for (const question of extended) {
      const claims = (await verifyQuestion(question.token))!
      expect(claims.itemId).toBeTruthy()
      expect(claims.node).toBeTruthy()
      expect(claims.contentVersion).toBeGreaterThan(0)
    }
  })

  it('leaves basic recall questions with no node, so they schedule as recall', async () => {
    const { student, setId } = await mappedSet()
    const queue = await buildScopedQueue(student.id, { scope: 'all', setId })
    const questions = await buildQuestions(student.id, queue)

    for (const question of questions) {
      const claims = (await verifyQuestion(question.token))!
      expect(question.kind).toBe('gloss')
      expect(claims.node).toBeNull()
    }
  })
})

/* ═══ P1-4 · what the old reveal path actually touched ═══════════════════ */

describe.skipIf(!hasDatabase)('the write surface a node answer has', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('never touches an FSRS card, which is what the reveal bug could not do', async () => {
    // The correction this pins down. `recordNodeAnswer` — the function the
    // reveal button reached through `answerNode` before the fix — writes
    // review_events, brain_map_node_progress and the recommendation state. It
    // has never written user_vocabulary_cards, so the earlier claim that a
    // reveal "advanced FSRS" and "pushed the next review out" was wrong.
    const { recordNodeAnswer } = await import('@/lib/data/study')
    const { userVocabularyState } = await import('@/lib/db/schema')
    const { student, mappedId } = await mappedSet()

    await recordNodeAnswer({
      userId: student.id,
      vocabularyId: mappedId,
      node: 'meaning_core',
      questionType: 'sentence_translation',
      correct: true,
      payload: { given: '' },
    })

    expect(await db.select().from(userVocabularyCards)).toEqual([])
    expect(await db.select().from(reviewEvents)).toHaveLength(1)
    const [progress] = await db.select().from(brainMapNodeProgress)
    expect(progress!.attempts).toBe(1)
    expect(progress!.correct).toBe(1)
    expect((await db.select().from(userVocabularyState)).length).toBe(1)
  })

  it('leaves an existing card exactly where it was', async () => {
    const { recordNodeAnswer } = await import('@/lib/data/study')
    const { student, mappedId } = await mappedSet()

    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: mappedId,
      direction: 'en_ko',
      correct: false,
    })
    const [before] = await db.select().from(userVocabularyCards)

    await recordNodeAnswer({
      userId: student.id,
      vocabularyId: mappedId,
      node: 'meaning_core',
      questionType: 'sentence_translation',
      correct: true,
      payload: { given: '' },
    })

    const [after] = await db.select().from(userVocabularyCards)
    expect(after).toEqual(before)
  })

  it('shows why an empty `given` identifies a reveal but a filled one does not', async () => {
    // A choice card sends the option text, which is never empty. A reveal sent
    // the textarea, usually empty — but not always, and a student who typed
    // something is indistinguishable from a choice answer.
    const { student, mappedId } = await mappedSet()
    const map = (await buildSemanticMap(student.id, mappedId))!
    const choices = map.nodes.flatMap((n) => n.exercises).filter((e) => e.kind === 'choice')

    expect(choices.length).toBeGreaterThan(0)
    for (const exercise of choices) {
      for (const option of exercise.options) expect(option.trim()).not.toBe('')
    }
  })
})
