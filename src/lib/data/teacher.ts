import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import type { Actor } from '@/lib/auth/session'
import {
  assignments,
  reviewEvents,
  teacherStudentLinks,
  userConfusions,
  userVocabularyCards,
  users,
  vocabularies,
  vocabularySetItems,
  vocabularySets,
  wordPairs,
} from '@/lib/db/schema'
import { ForbiddenError, NotFoundError } from './errors'

/**
 * The only gate between a teacher and a student's data. Every teacher-facing
 * read calls this first; there is no query in the codebase that reaches student
 * rows without either `actor.id === studentId` or a passing call here.
 *
 * This is the RLS replacement. Postgres-level policies would push the same
 * check into the database, but they only bind if every query runs as a
 * per-request role — which a pooled serverless connection makes awkward.
 * Concentrating it in one testable function is the honest trade for this size
 * of project.
 */
export async function assertCanAccessStudent(
  actor: Actor,
  studentId: string,
  db: Db = defaultDb,
): Promise<void> {
  if (actor.id === studentId) return
  if (actor.role === 'admin') return
  if (actor.role !== 'teacher') throw new ForbiddenError('Not permitted to view this student')

  const [link] = await db
    .select({ id: teacherStudentLinks.id })
    .from(teacherStudentLinks)
    .where(
      and(
        eq(teacherStudentLinks.teacherId, actor.id),
        eq(teacherStudentLinks.studentId, studentId),
        eq(teacherStudentLinks.status, 'active'),
      ),
    )
    .limit(1)

  if (!link) throw new ForbiddenError('No active link to this student')
}

export async function listStudents(teacherId: string, db: Db = defaultDb) {
  return db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
    })
    .from(teacherStudentLinks)
    .innerJoin(users, eq(users.id, teacherStudentLinks.studentId))
    .where(
      and(
        eq(teacherStudentLinks.teacherId, teacherId),
        eq(teacherStudentLinks.status, 'active'),
      ),
    )
    .orderBy(users.displayName)
}

export async function linkStudent(
  teacherId: string,
  studentId: string,
  db: Db = defaultDb,
): Promise<void> {
  await db
    .insert(teacherStudentLinks)
    .values({ teacherId, studentId, status: 'active' })
    .onConflictDoUpdate({
      target: [teacherStudentLinks.teacherId, teacherStudentLinks.studentId],
      set: { status: 'active' },
    })
}

/** Words this student gets wrong most often. The teacher's main working view. */
export async function listWeakWords(studentId: string, limit = 20, db: Db = defaultDb) {
  return db
    .select({
      vocabularyId: reviewEvents.vocabularyId,
      lemma: vocabularies.lemma,
      wrong: sql<number>`count(*) filter (where ${reviewEvents.correct} = false)`.mapWith(Number),
      total: count(),
    })
    .from(reviewEvents)
    .innerJoin(vocabularies, eq(vocabularies.id, reviewEvents.vocabularyId))
    .where(eq(reviewEvents.userId, studentId))
    .groupBy(reviewEvents.vocabularyId, vocabularies.lemma)
    .having(sql`count(*) filter (where ${reviewEvents.correct} = false) > 0`)
    .orderBy(desc(sql`count(*) filter (where ${reviewEvents.correct} = false)`))
    .limit(limit)
}

export async function listConfusions(studentId: string, limit = 10, db: Db = defaultDb) {
  return db
    .select({
      pairId: userConfusions.pairId,
      lemmaA: wordPairs.lemmaA,
      lemmaB: wordPairs.lemmaB,
      wrongCount: userConfusions.wrongCount,
      rightCount: userConfusions.rightCount,
    })
    .from(userConfusions)
    .innerJoin(wordPairs, eq(wordPairs.id, userConfusions.pairId))
    .where(and(eq(userConfusions.userId, studentId), sql`${userConfusions.wrongCount} > 0`))
    .orderBy(desc(userConfusions.wrongCount))
    .limit(limit)
}

/* ─────────────────────────── vocabulary sets ─────────────────────────── */

export async function createSet(
  input: { ownerId: string; title: string; description?: string | null; isSeed?: boolean },
  db: Db = defaultDb,
): Promise<string> {
  const [row] = await db
    .insert(vocabularySets)
    .values({
      ownerId: input.ownerId,
      title: input.title,
      description: input.description ?? null,
      isSeed: input.isSeed ?? false,
    })
    .returning({ id: vocabularySets.id })
  if (!row) throw new Error('Failed to create set')
  return row.id
}

/** Sets reference vocabularies; the same word is never duplicated per set. */
export async function addToSet(
  setId: string,
  vocabularyIds: string[],
  db: Db = defaultDb,
): Promise<void> {
  if (!vocabularyIds.length) return
  await db
    .insert(vocabularySetItems)
    .values(vocabularyIds.map((vocabularyId, i) => ({ setId, vocabularyId, sortOrder: i })))
    .onConflictDoNothing()
}

export async function assignSet(
  input: { setId: string; studentId: string; assignedBy: string; dueAt?: Date | null },
  db: Db = defaultDb,
): Promise<void> {
  await db
    .insert(assignments)
    .values({
      setId: input.setId,
      studentId: input.studentId,
      assignedBy: input.assignedBy,
      dueAt: input.dueAt ?? null,
    })
    .onConflictDoNothing()
}

export async function listSets(ownerId: string, db: Db = defaultDb) {
  const sets = await db
    .select({
      id: vocabularySets.id,
      title: vocabularySets.title,
      description: vocabularySets.description,
      isSeed: vocabularySets.isSeed,
    })
    .from(vocabularySets)
    .where(eq(vocabularySets.ownerId, ownerId))
    .orderBy(desc(vocabularySets.createdAt))

  if (!sets.length) return []

  const counts = await db
    .select({ setId: vocabularySetItems.setId, value: count() })
    .from(vocabularySetItems)
    .where(inArray(vocabularySetItems.setId, sets.map((s) => s.id)))
    .groupBy(vocabularySetItems.setId)

  return sets.map((s) => ({
    ...s,
    wordCount: counts.find((c) => c.setId === s.id)?.value ?? 0,
  }))
}

/**
 * Removes a set, leaving its words alone.
 *
 * A set is a grouping, not a container: the same word can sit in several sets
 * and carries a Brain Map and every student's history with it. Deleting the
 * grouping must not take any of that with it, so this deletes the set row and
 * lets the cascade clear only what belongs to the set itself — its membership
 * rows and the assignments handing it to students.
 *
 * The owner check is the authorisation. An admin can remove anyone's set; a
 * teacher only their own.
 */
export async function deleteWordSet(
  input: { setId: string; actor: Actor },
  db: Db = defaultDb,
): Promise<{ title: string }> {
  const [set] = await db
    .select({ title: vocabularySets.title, ownerId: vocabularySets.ownerId })
    .from(vocabularySets)
    .where(eq(vocabularySets.id, input.setId))
    .limit(1)

  if (!set) throw new NotFoundError('세트를 찾을 수 없어요.')
  if (input.actor.role !== 'admin' && set.ownerId !== input.actor.id) {
    throw new ForbiddenError('내가 만든 세트만 삭제할 수 있어요.')
  }

  await db.delete(vocabularySets).where(eq(vocabularySets.id, input.setId))
  return { title: set.title }
}

export async function studentProgressSummary(studentId: string, db: Db = defaultDb) {
  const [row] = await db
    .select({
      cards: count(),
      lapses: sql<number>`coalesce(sum(${userVocabularyCards.lapses}), 0)`.mapWith(Number),
      reps: sql<number>`coalesce(sum(${userVocabularyCards.reps}), 0)`.mapWith(Number),
    })
    .from(userVocabularyCards)
    .where(eq(userVocabularyCards.userId, studentId))
  return row ?? { cards: 0, lapses: 0, reps: 0 }
}
