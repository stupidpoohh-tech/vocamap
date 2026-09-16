import { and, asc, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
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
        // Active is not enough on its own. Links written before consent
        // existed were made active by the teacher typing an address, so the
        // status recorded that a teacher asked, not that a student agreed.
        // Those rows are kept and re-confirmed rather than trusted.
        isNotNull(teacherStudentLinks.consentedAt),
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
        // The same condition `assertCanAccessStudent` applies, so the roster
        // cannot list a student whose page would then refuse to open.
        isNotNull(teacherStudentLinks.consentedAt),
      ),
    )
    .orderBy(users.displayName)
}

/**
 * A teacher asking to follow a student. Not the relationship itself.
 *
 * This used to insert `active`, and to force `active` on conflict — so knowing
 * a student's email address was the whole of the access check, and a student
 * who had revoked a teacher was re-linked the next time that teacher retyped
 * the address. Both are gone: a new row is `pending`, and an existing row of
 * any status is left exactly as it is.
 *
 * The student decides from here. See `acceptTeacherLink`.
 */
export async function requestStudentLink(
  teacherId: string,
  studentId: string,
  db: Db = defaultDb,
): Promise<{ outcome: 'requested' | 'already_pending' | 'already_active' | 'revoked' }> {
  const inserted = await db
    .insert(teacherStudentLinks)
    .values({ teacherId, studentId, status: 'pending', requestedBy: teacherId })
    // Never `onConflictDoUpdate`. A row that exists already carries the
    // student's answer, and a repeated request must not be able to change it.
    .onConflictDoNothing()
    .returning({ id: teacherStudentLinks.id })

  if (inserted.length) return { outcome: 'requested' }

  const [existing] = await db
    .select({
      status: teacherStudentLinks.status,
      consentedAt: teacherStudentLinks.consentedAt,
    })
    .from(teacherStudentLinks)
    .where(
      and(
        eq(teacherStudentLinks.teacherId, teacherId),
        eq(teacherStudentLinks.studentId, studentId),
      ),
    )
    .limit(1)

  if (existing?.status === 'revoked') return { outcome: 'revoked' }
  if (existing?.status === 'active' && existing.consentedAt) return { outcome: 'already_active' }
  return { outcome: 'already_pending' }
}

/**
 * Requests waiting on this student's answer.
 *
 * Read by the student's own screen, so it is keyed on the student — there is no
 * path here that lets one account list another's requests.
 */
export async function listPendingLinkRequests(studentId: string, db: Db = defaultDb) {
  return db
    .select({
      id: teacherStudentLinks.id,
      teacherName: users.displayName,
      teacherEmail: users.email,
      requestedAt: teacherStudentLinks.createdAt,
    })
    .from(teacherStudentLinks)
    .innerJoin(users, eq(users.id, teacherStudentLinks.teacherId))
    .where(
      and(
        eq(teacherStudentLinks.studentId, studentId),
        eq(teacherStudentLinks.status, 'pending'),
      ),
    )
    .orderBy(asc(teacherStudentLinks.createdAt))
}

/**
 * The student saying yes.
 *
 * `studentId` is the signed-in account, and it is part of the WHERE rather than
 * something checked beforehand: a teacher who guesses a link id still matches
 * no row. An admin approving on a student's behalf goes through
 * `approveLinkAsAdmin`, which records itself as the consenting party so the two
 * are never confused in the record.
 */
export async function acceptTeacherLink(
  linkId: string,
  studentId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const updated = await db
    .update(teacherStudentLinks)
    .set({ status: 'active', consentedAt: new Date(), consentedBy: studentId })
    .where(
      and(
        eq(teacherStudentLinks.id, linkId),
        eq(teacherStudentLinks.studentId, studentId),
        eq(teacherStudentLinks.status, 'pending'),
      ),
    )
    .returning({ id: teacherStudentLinks.id })
  return updated.length > 0
}

/** The student saying no, or withdrawing an answer they gave before. */
export async function revokeTeacherLink(
  linkId: string,
  studentId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const updated = await db
    .update(teacherStudentLinks)
    .set({ status: 'revoked', consentedAt: null, consentedBy: null })
    .where(and(eq(teacherStudentLinks.id, linkId), eq(teacherStudentLinks.studentId, studentId)))
    .returning({ id: teacherStudentLinks.id })
  return updated.length > 0
}

/**
 * An admin approving a link for a student who cannot do it themselves.
 *
 * Kept separate from `acceptTeacherLink` so the caller has to be an admin path,
 * and so `consented_by` names the admin rather than implying the student
 * clicked something. A teacher has no route to either function.
 */
export async function approveLinkAsAdmin(
  linkId: string,
  adminId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const updated = await db
    .update(teacherStudentLinks)
    .set({ status: 'active', consentedAt: new Date(), consentedBy: adminId })
    .where(and(eq(teacherStudentLinks.id, linkId), eq(teacherStudentLinks.status, 'pending')))
    .returning({ id: teacherStudentLinks.id })
  return updated.length > 0
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

/**
 * The set a teacher means when they type a name they have typed before.
 *
 * Pasting the second page of a range under the same title is one range in two
 * goes, not two ranges — and a second set with the same name is worse than
 * useless: the words are split across two of them and neither is the range.
 *
 * Matched on the name as typed, ignoring case and surrounding space, and only
 * within the teacher's own sets. Two teachers both having a "1과" is two
 * different 1과.
 *
 * Nothing stops two imports racing to create the same name — there is no
 * unique index, because sets with duplicate names already exist and an index
 * could not be added over them. A teacher pressing a button twice at once is
 * not the failure worth a migration.
 */
export async function findOrCreateSet(
  input: { ownerId: string; title: string; description?: string | null },
  db: Db = defaultDb,
): Promise<{ id: string; created: boolean }> {
  const title = input.title.trim()

  const [existing] = await db
    .select({ id: vocabularySets.id })
    .from(vocabularySets)
    .where(
      and(
        eq(vocabularySets.ownerId, input.ownerId),
        sql`lower(trim(${vocabularySets.title})) = ${title.toLowerCase()}`,
      ),
    )
    // The oldest, when a duplicate pair predates this. Later pastes then keep
    // landing in one of them rather than alternating.
    .orderBy(asc(vocabularySets.createdAt))
    .limit(1)

  if (existing) return { id: existing.id, created: false }
  return { id: await createSet({ ...input, title }, db), created: true }
}

/**
 * Sets reference vocabularies; the same word is never duplicated per set.
 *
 * Returns how many were actually new to the set. Pasting a range twice is a
 * normal thing to do — the second paste adds nothing and should say so rather
 * than report fifty words added.
 */
export async function addToSet(
  setId: string,
  vocabularyIds: string[],
  db: Db = defaultDb,
): Promise<number> {
  if (!vocabularyIds.length) return 0
  const inserted = await db
    .insert(vocabularySetItems)
    .values(
      vocabularyIds.map((vocabularyId, i) => ({
        setId,
        vocabularyId,
        // Continues where the set left off rather than restarting at zero, so
        // a second paste does not sit on top of the first. Read in the same
        // statement — nothing here is worth a round trip of its own.
        sortOrder: sql<number>`(
          select coalesce(max(existing.sort_order), -1) + 1 + ${i}
          from vocabulary_set_items existing
          where existing.set_id = ${setId}
        )`,
      })),
    )
    .onConflictDoNothing()
    .returning({ vocabularyId: vocabularySetItems.vocabularyId })
  return inserted.length
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
