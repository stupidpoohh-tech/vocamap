import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { vocabularySetItems, vocabularySets } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { addToSet, createSet, findOrCreateSet } from '@/lib/data/teacher'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { importWordbook } from '@/lib/import/import-wordbook'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

async function words(lemmas: string[]) {
  const ids: string[] = []
  for (const lemma of lemmas) {
    const { id } = await findOrCreateVocabulary({ lemma, translations: [`${lemma}-뜻`] })
    ids.push(id)
  }
  return ids
}

async function itemsOf(setId: string) {
  return db
    .select({ vocabularyId: vocabularySetItems.vocabularyId, sortOrder: vocabularySetItems.sortOrder })
    .from(vocabularySetItems)
    .where(eq(vocabularySetItems.setId, setId))
}

/** Two pages of one range, typed the way the tutor types them. */
const PAGE_ONE = `
어휘 | 영영 풀이 | 의미
govern | to control and direct the affairs of a country | 통치하다
impulse | a sudden strong wish to do something | 충동
`.trim()

const PAGE_TWO = `
어휘 | 영영 풀이 | 의미
impulse | a sudden strong wish to do something | 충동
magnetic | having the power to attract things | 자석의
normal | usual, typical, or expected | 보통의
`.trim()

describe.skipIf(!hasDatabase)('a set name typed twice', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('joins the set that already has the name', async () => {
    const teacher = await createUser('teacher')
    const first = await createSet({ ownerId: teacher.id, title: '기말 범위' })

    const found = await findOrCreateSet({ ownerId: teacher.id, title: '기말 범위' })

    expect(found).toEqual({ id: first, created: false })
  })

  it('ignores case and the spaces around the name', async () => {
    const teacher = await createUser('teacher')
    const first = await createSet({ ownerId: teacher.id, title: 'Unit 3' })

    const found = await findOrCreateSet({ ownerId: teacher.id, title: '  unit 3  ' })

    expect(found.id).toBe(first)
    expect(found.created).toBe(false)
  })

  it('is one teacher at a time — two teachers both have a 1과', async () => {
    const mine = await createUser('teacher')
    const theirs = await createUser('teacher')
    const first = await createSet({ ownerId: mine.id, title: '1과' })

    const found = await findOrCreateSet({ ownerId: theirs.id, title: '1과' })

    expect(found.id).not.toBe(first)
    expect(found.created).toBe(true)
  })

  it('makes the set when the name is new', async () => {
    const teacher = await createUser('teacher')
    const found = await findOrCreateSet({ ownerId: teacher.id, title: '새 범위' })

    expect(found.created).toBe(true)
    const [row] = await db
      .select({ title: vocabularySets.title })
      .from(vocabularySets)
      .where(eq(vocabularySets.id, found.id))
    expect(row!.title).toBe('새 범위')
  })

  it('picks the oldest when a duplicate pair already exists', async () => {
    // Sets made before this change could share a name. Later pastes have to
    // keep landing in one of them rather than alternating.
    const teacher = await createUser('teacher')
    const older = await createSet({ ownerId: teacher.id, title: '2주차' })
    await createSet({ ownerId: teacher.id, title: '2주차' })

    expect((await findOrCreateSet({ ownerId: teacher.id, title: '2주차' })).id).toBe(older)
    expect((await findOrCreateSet({ ownerId: teacher.id, title: '2주차' })).id).toBe(older)
  })
})

describe.skipIf(!hasDatabase)('adding words to a set that has some', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('continues the numbering instead of restarting at zero', async () => {
    const teacher = await createUser('teacher')
    const setId = await createSet({ ownerId: teacher.id, title: '범위' })
    const [a, b] = await words(['alpha', 'beta'])
    const [c] = await words(['gamma'])

    await addToSet(setId, [a!, b!])
    await addToSet(setId, [c!])

    const rows = await itemsOf(setId)
    expect(rows).toHaveLength(3)
    expect([...rows].map((r) => r.sortOrder).sort((x, y) => x - y)).toEqual([0, 1, 2])
  })

  it('counts only what the set did not already hold', async () => {
    const teacher = await createUser('teacher')
    const setId = await createSet({ ownerId: teacher.id, title: '범위' })
    const [a, b, c] = await words(['alpha', 'beta', 'gamma'])

    expect(await addToSet(setId, [a!, b!])).toBe(2)
    expect(await addToSet(setId, [b!, c!])).toBe(1)
    expect(await addToSet(setId, [a!, b!, c!])).toBe(0)
    expect(await itemsOf(setId)).toHaveLength(3)
  })
})

describe.skipIf(!hasDatabase)('pasting the second half of a range', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('lands in the one set, not a second of the same name', async () => {
    const teacher = await createUser('teacher')
    const actor = { ...teacher, role: 'teacher' as const }

    const first = await importWordbook({ text: PAGE_ONE, title: 'J1', actor })
    const second = await importWordbook({ text: PAGE_TWO, title: 'J1', actor })

    expect(first.setCreated).toBe(true)
    expect(second.setCreated).toBe(false)
    expect(second.setId).toBe(first.setId)

    const sets = await db
      .select({ id: vocabularySets.id })
      .from(vocabularySets)
      .where(eq(vocabularySets.ownerId, teacher.id))
    expect(sets).toHaveLength(1)

    // Four distinct words across two pastes that share `impulse`.
    expect(await itemsOf(first.setId)).toHaveLength(4)
    expect(second.addedToSet).toBe(2)
  })

  it('says nothing was added when the same page is pasted twice', async () => {
    const teacher = await createUser('teacher')
    const actor = { ...teacher, role: 'teacher' as const }

    await importWordbook({ text: PAGE_ONE, title: 'J1', actor })
    const again = await importWordbook({ text: PAGE_ONE, title: 'J1', actor })

    expect(again.addedToSet).toBe(0)
    expect(again.words).toBe(2)
    expect(await itemsOf(again.setId)).toHaveLength(2)
  })
})
