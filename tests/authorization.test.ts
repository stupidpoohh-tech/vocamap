import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '@/lib/auth/session'
import { GUEST_ID } from '@/lib/auth/guest'
import { ForbiddenError } from '@/lib/data/errors'
import { assertCanAccessStudent, linkStudent, listStudents, listWeakWords } from '@/lib/data/teacher'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { addToSet, assignSet, createSet } from '@/lib/data/teacher'
import { recordRecallAnswer } from '@/lib/data/study'
import { bookmarkedIds } from '@/lib/data/study'
import { listStudyWords, listWordSets, mapCounts, vaultCounts } from '@/lib/data/library'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

const asActor = (u: { id: string; email: string; displayName: string; role: string }): Actor => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role as Actor['role'],
})

describe.skipIf(!hasDatabase)('student data access control', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('lets a student reach their own data', async () => {
    const student = await createUser('student')
    await expect(assertCanAccessStudent(asActor(student), student.id)).resolves.toBeUndefined()
  })

  it('refuses a student reaching another student', async () => {
    const alice = await createUser('student')
    const bob = await createUser('student')
    await expect(assertCanAccessStudent(asActor(alice), bob.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('refuses a teacher with no link to the student', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    await expect(assertCanAccessStudent(asActor(teacher), student.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('allows a teacher once an active link exists', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    await linkStudent(teacher.id, student.id)
    await expect(assertCanAccessStudent(asActor(teacher), student.id)).resolves.toBeUndefined()
  })

  it('refuses a teacher whose link belongs to a different student', async () => {
    const teacher = await createUser('teacher')
    const mine = await createUser('student')
    const theirs = await createUser('student')
    await linkStudent(teacher.id, mine.id)
    await expect(assertCanAccessStudent(asActor(teacher), theirs.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('allows an admin anywhere', async () => {
    const admin = await createUser('admin')
    const student = await createUser('student')
    await expect(assertCanAccessStudent(asActor(admin), student.id)).resolves.toBeUndefined()
  })

  it('only lists a teacher’s own students', async () => {
    const mine = await createUser('teacher')
    const other = await createUser('teacher')
    const a = await createUser('student')
    const b = await createUser('student')
    await linkStudent(mine.id, a.id)
    await linkStudent(other.id, b.id)

    const listed = await listStudents(mine.id)
    expect(listed.map((s) => s.id)).toEqual([a.id])
  })

  it('scopes weak-word analytics to a single student', async () => {
    const teacher = await createUser('teacher')
    const alice = await createUser('student')
    const bob = await createUser('student')
    await linkStudent(teacher.id, alice.id)

    const { id } = await findOrCreateVocabulary({ lemma: 'maintain', translations: ['유지하다'] })
    const setId = await createSet({ ownerId: teacher.id, title: 'set' })
    await addToSet(setId, [id])
    await assignSet({ setId, studentId: alice.id, assignedBy: teacher.id })
    await assignSet({ setId, studentId: bob.id, assignedBy: teacher.id })

    await recordRecallAnswer({ userId: alice.id, vocabularyId: id, direction: 'en_ko', correct: false })
    await recordRecallAnswer({ userId: bob.id, vocabularyId: id, direction: 'en_ko', correct: false })
    await recordRecallAnswer({ userId: bob.id, vocabularyId: id, direction: 'ko_en', correct: false })

    const aliceWeak = await listWeakWords(alice.id)
    expect(aliceWeak).toHaveLength(1)
    expect(aliceWeak[0]!.wrong).toBe(1)
  })
})

/**
 * Reading the app needs no account; keeping anything does.
 *
 * A guest reads as `GUEST_ID`, an id no user row can have, so every per-person
 * join finds nothing. These check both halves of that: the shared content is
 * still there, and none of the personal state is.
 */
describe.skipIf(!hasDatabase)('guest access', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('is an id no account can ever hold', async () => {
    const student = await createUser('student')
    expect(student.id).not.toBe(GUEST_ID)
  })

  it('shows a guest the words a tutor published', async () => {
    const teacher = await createUser('teacher')
    const word = await findOrCreateVocabulary({ lemma: 'guestword', createdBy: teacher.id })

    const page = await listStudyWords({ userId: GUEST_ID, scope: 'all' })
    expect(page.words.map((w) => w.id)).toContain(word.id)
  })

  it('shows a guest every set, without anyone else’s assignment', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const setId = await createSet({ ownerId: teacher.id, title: '1주차' })
    const word = await findOrCreateVocabulary({ lemma: 'shelfword', createdBy: teacher.id })
    await addToSet(setId, [word.id])
    await assignSet({ setId, studentId: student.id, assignedBy: teacher.id })

    const shelf = await listWordSets(GUEST_ID)
    const mine = shelf.find((s) => s.id === setId)
    expect(mine).toBeDefined()
    // Visible, but not marked as handed to them — a guest is nobody's student.
    expect(mine!.assigned).toBe(false)
  })

  it('carries none of a signed-in student’s state into a guest’s view', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const word = await findOrCreateVocabulary({ lemma: 'mineonly', createdBy: teacher.id })
    await recordRecallAnswer({
      userId: student.id,
      vocabularyId: word.id,
      direction: 'en_ko',
      correct: false,
      responseTimeMs: 1200,
      questionType: 'recall_choice',
    })

    // The same question, asked as each of them. The student's wrong answer is
    // theirs; the guest's view of the same word knows nothing about it.
    expect((await vaultCounts(student.id)).wrong).toBe(1)
    expect((await vaultCounts(GUEST_ID)).wrong).toBe(0)
    expect(await bookmarkedIds(GUEST_ID, [word.id])).toEqual(new Set())
    expect((await mapCounts(GUEST_ID)).saved).toBe(0)
  })
})
