import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { brainMaps } from '@/lib/db/schema'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { listStudyWords, listWordSets, wordSetName } from '@/lib/data/library'
import {
  buildScopedQueue,
  buildTodayQueue,
  parseDirections,
  parseQueueScope,
  recordRecallAnswer,
  toggleBookmark,
} from '@/lib/data/study'
import { addToSet, assignSet, createSet } from '@/lib/data/teacher'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

async function library(lemmas: string[]) {
  const student = await createUser('student')
  const ids: string[] = []
  for (const lemma of lemmas) {
    const { id } = await findOrCreateVocabulary({
      lemma,
      partOfSpeech: 'verb',
      translations: [`${lemma}-뜻`],
    })
    ids.push(id)
  }
  return { student, ids }
}

async function giveMap(vocabularyId: string, status: 'approved' | 'draft_ai') {
  await db.insert(brainMaps).values({ vocabularyId, status })
}

describe.skipIf(!hasDatabase)('the study book', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('shows every uploaded word, saved or not', async () => {
    // The whole point of the change: a student opens the app and can study the
    // words that exist, without waiting to be assigned anything.
    const { student, ids } = await library(['maintain', 'affect', 'issue'])
    const words = await listStudyWords({ userId: student.id, scope: 'all' })
    expect(words.map((w) => w.id).sort()).toEqual([...ids].sort())
    expect(words.every((w) => !w.bookmarked)).toBe(true)
  })

  it('carries both sides of every word so the list can be covered either way', async () => {
    const { student } = await library(['maintain'])
    const [word] = await listStudyWords({ userId: student.id, scope: 'all' })
    expect(word!.lemma).toBe('maintain')
    expect(word!.translation).toBe('maintain-뜻')
  })

  it('finds a word by its English or its Korean', async () => {
    const { student } = await library(['maintain', 'affect'])
    expect(
      (await listStudyWords({ userId: student.id, scope: 'all', query: 'main' })).map((w) => w.lemma),
    ).toEqual(['maintain'])
    expect(
      (await listStudyWords({ userId: student.id, scope: 'all', query: 'affect-뜻' })).map(
        (w) => w.lemma,
      ),
    ).toEqual(['affect'])
  })
})

describe.skipIf(!hasDatabase)('the vault', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('holds what the student saved', async () => {
    const { student, ids } = await library(['maintain', 'affect'])
    await toggleBookmark({ userId: student.id, vocabularyId: ids[0]!, bookmarked: true })

    const saved = await listStudyWords({ userId: student.id, scope: 'saved' })
    expect(saved.map((w) => w.id)).toEqual([ids[0]])
    expect(saved[0]!.bookmarked).toBe(true)
  })

  it('holds what the student got wrong, and counts it', async () => {
    const { student, ids } = await library(['maintain', 'affect'])
    for (const correct of [false, false, true]) {
      await recordRecallAnswer({
        userId: student.id,
        vocabularyId: ids[0]!,
        direction: 'en_ko',
        correct,
      })
    }
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: ids[1]!,
      direction: 'en_ko',
      correct: true,
    })

    const wrong = await listStudyWords({ userId: student.id, scope: 'wrong' })
    expect(wrong.map((w) => w.id)).toEqual([ids[0]])
    expect(wrong[0]!.wrongCount).toBe(2)
  })

  it('keeps one student’s wrong answers out of another’s vault', async () => {
    const { student, ids } = await library(['maintain'])
    const other = await createUser('student')
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: ids[0]!,
      direction: 'en_ko',
      correct: false,
    })

    expect(await listStudyWords({ userId: other.id, scope: 'wrong' })).toEqual([])
    expect(await listStudyWords({ userId: other.id, scope: 'saved' })).toEqual([])
  })
})

describe.skipIf(!hasDatabase)('the map list', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('shows only words that have a published map', async () => {
    const { student, ids } = await library(['maintain', 'affect', 'issue'])
    await giveMap(ids[0]!, 'approved')
    await giveMap(ids[1]!, 'draft_ai')

    const mapped = await listStudyWords({ userId: student.id, scope: 'mapped' })
    expect(mapped.map((w) => w.id)).toEqual([ids[0]])
    expect(mapped[0]!.mapStatus).toBe('approved')
  })

  it('narrows to the maps the student saved', async () => {
    const { student, ids } = await library(['maintain', 'affect'])
    await giveMap(ids[0]!, 'approved')
    await giveMap(ids[1]!, 'approved')
    await toggleBookmark({ userId: student.id, vocabularyId: ids[1]!, bookmarked: true })

    const saved = await listStudyWords({ userId: student.id, scope: 'mapped', savedOnly: true })
    expect(saved.map((w) => w.id)).toEqual([ids[1]])
  })

  it('gives a curator the queue of words still missing a map', async () => {
    // This list is the only route to map generation, so it has to be exact.
    const { student, ids } = await library(['maintain', 'affect'])
    await giveMap(ids[0]!, 'approved')

    const missing = await listStudyWords({ userId: student.id, scope: 'mapMissing' })
    expect(missing.map((w) => w.id)).toEqual([ids[1]])

    await giveMap(ids[1]!, 'draft_ai')
    expect(await listStudyWords({ userId: student.id, scope: 'mapMissing' })).toEqual([])
    expect(
      (await listStudyWords({ userId: student.id, scope: 'mapPending' })).map((w) => w.id),
    ).toEqual([ids[1]])
  })
})

describe.skipIf(!hasDatabase)('tests aimed at a list', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('tests the whole book without needing anything saved', async () => {
    const { student, ids } = await library(['maintain', 'affect'])
    expect(await buildTodayQueue(student.id)).toEqual([])

    const queue = await buildScopedQueue(student.id, { scope: 'all' })
    expect(new Set(queue.map((q) => q.vocabularyId))).toEqual(new Set(ids))
    expect(queue).toHaveLength(ids.length * 2)
  })

  it('tests one direction when the student picked one', async () => {
    const { student } = await library(['maintain'])
    const queue = await buildScopedQueue(student.id, {
      scope: 'all',
      directions: parseDirections('ko_en'),
    })
    expect(queue.map((q) => q.direction)).toEqual(['ko_en'])
  })

  it('tests exactly the saved list, and exactly the wrong list', async () => {
    const { student, ids } = await library(['maintain', 'affect', 'issue'])
    await toggleBookmark({ userId: student.id, vocabularyId: ids[0]!, bookmarked: true })
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: ids[2]!,
      direction: 'en_ko',
      correct: false,
    })

    const saved = await buildScopedQueue(student.id, { scope: 'saved' })
    expect(new Set(saved.map((q) => q.vocabularyId))).toEqual(new Set([ids[0]]))

    const wrong = await buildScopedQueue(student.id, { scope: 'wrong' })
    expect(new Set(wrong.map((q) => q.vocabularyId))).toEqual(new Set([ids[2]]))
  })

  it('brings a word answered in an open test back on schedule', async () => {
    // Without this, testing yourself on the open book would be a dead end: the
    // words you met would never come due, because you never saved them.
    const { student, ids } = await library(['maintain'])
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: ids[0]!,
      direction: 'en_ko',
      correct: false,
    })

    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const due = await buildTodayQueue(student.id, { now: later })
    expect(due.map((q) => q.vocabularyId)).toContain(ids[0])
  })

  it('does not treat the whole library as new words in the daily queue', async () => {
    // An answered word joins the review pool, but the unanswered rest of the
    // library must not turn into "10 new words" the student never asked for.
    const { student, ids } = await library(['maintain', 'affect', 'issue'])
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: ids[0]!,
      direction: 'en_ko',
      correct: true,
    })

    const queue = await buildTodayQueue(student.id)
    expect(queue.filter((q) => q.isNew).map((q) => q.vocabularyId)).not.toContain(ids[1])
    expect(queue.filter((q) => q.isNew).map((q) => q.vocabularyId)).not.toContain(ids[2])
  })

  it('reads the scope and direction from what the URL actually says', async () => {
    expect(parseQueueScope('wrong')).toBe('wrong')
    expect(parseQueueScope('nonsense')).toBe('due')
    expect(parseQueueScope(undefined)).toBe('due')
    expect(parseDirections('en_ko')).toEqual(['en_ko'])
    expect(parseDirections(undefined)).toEqual(['en_ko', 'ko_en'])
  })
})

describe.skipIf(!hasDatabase)('the set shelf', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function shelfScenario() {
    const teacher = await createUser('teacher')
    const { student, ids } = await library(['maintain', 'affect', 'issue', 'loose'])
    const week1 = await createSet({ ownerId: teacher.id, title: '1주차' })
    const week2 = await createSet({ ownerId: teacher.id, title: '2주차', description: '동사 모음' })
    await addToSet(week1, [ids[0]!, ids[1]!])
    await addToSet(week2, [ids[2]!])
    return { teacher, student, ids, week1, week2 }
  }

  it('lists every set with its size, not just the ones assigned', async () => {
    const { student, week1, week2 } = await shelfScenario()
    const shelf = await listWordSets(student.id)
    const byId = new Map(shelf.map((s) => [s.id, s]))
    expect(byId.get(week1)!.wordCount).toBe(2)
    expect(byId.get(week2)!.wordCount).toBe(1)
    expect(byId.get(week2)!.description).toBe('동사 모음')
  })

  it('keeps words that belong to no set reachable', async () => {
    // Browsing set by set would otherwise hide them completely.
    const { student, ids } = await shelfScenario()
    const loose = (await listWordSets(student.id)).find((s) => s.id === null)
    expect(loose?.wordCount).toBe(1)

    const words = await listStudyWords({ userId: student.id, scope: 'all', unassigned: true })
    expect(words.map((w) => w.id)).toEqual([ids[3]])
  })

  it('counts what the student has already put in the vault', async () => {
    const { student, ids, week1 } = await shelfScenario()
    await toggleBookmark({ userId: student.id, vocabularyId: ids[0]!, bookmarked: true })
    const shelf = await listWordSets(student.id)
    expect(shelf.find((s) => s.id === week1)!.savedCount).toBe(1)
  })

  it('puts an assigned set first', async () => {
    const { teacher, student, week2 } = await shelfScenario()
    await assignSet({ setId: week2, studentId: student.id, assignedBy: teacher.id })
    const shelf = await listWordSets(student.id)
    expect(shelf[0]!.id).toBe(week2)
    expect(shelf[0]!.assigned).toBe(true)
  })

  it('opens a set into exactly its own words', async () => {
    const { student, ids, week1 } = await shelfScenario()
    const words = await listStudyWords({ userId: student.id, scope: 'all', setId: week1 })
    expect(new Set(words.map((w) => w.id))).toEqual(new Set([ids[0], ids[1]]))
    expect(await wordSetName(week1)).toBe('1주차')
  })

  it('tests one set, and tests the loose words, without touching the rest', async () => {
    const { student, ids, week1 } = await shelfScenario()

    const set = await buildScopedQueue(student.id, { scope: 'all', setId: week1 })
    expect(new Set(set.map((q) => q.vocabularyId))).toEqual(new Set([ids[0], ids[1]]))

    const loose = await buildScopedQueue(student.id, { scope: 'all', unassigned: true })
    expect(new Set(loose.map((q) => q.vocabularyId))).toEqual(new Set([ids[3]]))
  })

  it('tests exactly what the student put in the vault', async () => {
    // The vault is only worth keeping if it can be drilled.
    const { student, ids } = await shelfScenario()
    await toggleBookmark({ userId: student.id, vocabularyId: ids[1]!, bookmarked: true })
    await toggleBookmark({ userId: student.id, vocabularyId: ids[3]!, bookmarked: true })

    const queue = await buildScopedQueue(student.id, { scope: 'saved' })
    expect(new Set(queue.map((q) => q.vocabularyId))).toEqual(new Set([ids[1], ids[3]]))
    expect(queue).toHaveLength(4) // two words, both directions
  })
})
