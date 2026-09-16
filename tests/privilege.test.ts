import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { teacherStudentLinks, users } from '@/lib/db/schema'
import {
  acceptTeacherLink,
  approveLinkAsAdmin,
  assertCanAccessStudent,
  listPendingLinkRequests,
  listStudents,
  requestStudentLink,
  revokeTeacherLink,
} from '@/lib/data/teacher'
import { ForbiddenError } from '@/lib/data/errors'
import { AuthError, assertVerifiedCurator, isVerifiedCurator } from '@/lib/auth/session'
import { createUser, hasDatabase, linkAccepted, resetDatabase, verifyTeacher } from './helpers/db'

const asActor = (u: { id: string; email: string; displayName: string; role: string }) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role as 'student' | 'teacher' | 'admin',
})

/* ══════════════════════ P0-1 · role from the form ══════════════════════ */

describe.skipIf(!hasDatabase)('signing up', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('makes a student even when the form asks for a teacher', async () => {
    // The whole vulnerability in one line: `role` was read off the sign-up
    // form, so anyone could hand themselves the power to write and approve the
    // public maps every other reader studies from.
    const { signUp } = await import('@/app/login/actions')

    const form = new FormData()
    form.set('email', 'attacker@example.com')
    form.set('password', 'a-long-enough-password')
    form.set('displayName', '침입자')
    form.set('role', 'teacher')

    // The action cannot finish outside a request scope — `createSession` reaches
    // for `cookies()` and the redirect throws a control signal — so the call is
    // allowed to fail. What matters is that the row is written before any of
    // that, so what lands in the table is exactly what the vulnerable line
    // decided. The logged error below is expected.
    await signUp({}, form).catch(() => undefined)

    const [created] = await db
      .select({ role: users.role, verifiedAt: users.teacherVerifiedAt })
      .from(users)
      .where(eq(users.email, 'attacker@example.com'))
      .limit(1)

    expect(created?.role).toBe('student')
    expect(created?.verifiedAt).toBeNull()
  })

  it('makes a student when the form asks for an admin', async () => {
    const { signUp } = await import('@/app/login/actions')

    const form = new FormData()
    form.set('email', 'root@example.com')
    form.set('password', 'a-long-enough-password')
    form.set('displayName', '관리자')
    form.set('role', 'admin')

    await signUp({}, form).catch(() => undefined)

    const [created] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.email, 'root@example.com'))
      .limit(1)
    expect(created?.role).toBe('student')
  })
})

/* ═════════════ P0-1 · a teacher nobody vouched for ══════════════════════ */

describe.skipIf(!hasDatabase)('a teacher account', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('cannot use the curator actions until an admin verifies it', async () => {
    // Every account that existed before this rule is in exactly this state,
    // including any that signed itself up as a teacher.
    const teacher = await createUser('teacher')
    await expect(assertVerifiedCurator(asActor(teacher))).rejects.toBeInstanceOf(AuthError)
    expect(await isVerifiedCurator(asActor(teacher))).toBe(false)
  })

  it('can once an admin has', async () => {
    const teacher = await createUser('teacher')
    await verifyTeacher(teacher.id)
    await expect(assertVerifiedCurator(asActor(teacher))).resolves.toBeUndefined()
    expect(await isVerifiedCurator(asActor(teacher))).toBe(true)
  })

  it('stops the moment the verification is taken away, mid-session', async () => {
    // The session cookie lasts thirty days and carries the role it was minted
    // with, so the check has to read the row rather than the token.
    const teacher = await createUser('teacher')
    await verifyTeacher(teacher.id)
    await expect(assertVerifiedCurator(asActor(teacher))).resolves.toBeUndefined()

    await db.update(users).set({ teacherVerifiedAt: null }).where(eq(users.id, teacher.id))

    await expect(assertVerifiedCurator(asActor(teacher))).rejects.toBeInstanceOf(AuthError)
  })

  it('refuses a session that still claims teacher after the role was removed', async () => {
    const teacher = await createUser('teacher')
    await verifyTeacher(teacher.id)
    const staleSession = asActor(teacher)

    await db
      .update(users)
      .set({ role: 'student', teacherVerifiedAt: null })
      .where(eq(users.id, teacher.id))

    await expect(assertVerifiedCurator(staleSession)).rejects.toBeInstanceOf(AuthError)
  })

  it('refuses a student outright', async () => {
    const student = await createUser('student')
    await expect(assertVerifiedCurator(asActor(student))).rejects.toBeInstanceOf(AuthError)
  })

  it('lets an admin through without a stamp', async () => {
    // Sign-up cannot make one, so the role is evidence in their case.
    const admin = await createUser('admin')
    await expect(assertVerifiedCurator(asActor(admin))).resolves.toBeUndefined()
  })
})

/* ═══════════════════ P0-2 · a link the student agreed to ═══════════════ */

describe.skipIf(!hasDatabase)('a teacher naming a student', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('creates a request, not a relationship', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')

    const { outcome } = await requestStudentLink(teacher.id, student.id)
    expect(outcome).toBe('requested')

    const [link] = await db
      .select({ status: teacherStudentLinks.status, consentedAt: teacherStudentLinks.consentedAt })
      .from(teacherStudentLinks)
      .where(eq(teacherStudentLinks.teacherId, teacher.id))
    expect(link?.status).toBe('pending')
    expect(link?.consentedAt).toBeNull()
  })

  it('cannot read the student while the request is pending', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    await requestStudentLink(teacher.id, student.id)

    await expect(assertCanAccessStudent(asActor(teacher), student.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    expect(await listStudents(teacher.id)).toEqual([])
  })

  it('can read the student once they accept', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    await linkAccepted(teacher.id, student.id)

    await expect(assertCanAccessStudent(asActor(teacher), student.id)).resolves.toBeUndefined()
    expect((await listStudents(teacher.id)).map((s) => s.id)).toEqual([student.id])
  })

  it('cannot accept on the student’s behalf', async () => {
    // The teacher holds the link id — it is their own request. Accepting is
    // scoped to the student the link names, so the id buys them nothing.
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    await requestStudentLink(teacher.id, student.id)
    const [request] = await listPendingLinkRequests(student.id)

    expect(await acceptTeacherLink(request!.id, teacher.id)).toBe(false)
    await expect(assertCanAccessStudent(asActor(teacher), student.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('cannot be accepted by a different student', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const bystander = await createUser('student')
    await requestStudentLink(teacher.id, student.id)
    const [request] = await listPendingLinkRequests(student.id)

    expect(await acceptTeacherLink(request!.id, bystander.id)).toBe(false)
    await expect(assertCanAccessStudent(asActor(teacher), student.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('lists only the requests addressed to that student', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const bystander = await createUser('student')
    await requestStudentLink(teacher.id, student.id)

    expect(await listPendingLinkRequests(bystander.id)).toEqual([])
    expect(await listPendingLinkRequests(student.id)).toHaveLength(1)
  })

  it('does not re-activate a link the student revoked', async () => {
    // The old code did `onConflictDoUpdate ... set status = 'active'`, so a
    // teacher who had been disconnected got back in by retyping the address.
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const linkId = await linkAccepted(teacher.id, student.id)
    expect(await revokeTeacherLink(linkId, student.id)).toBe(true)

    const { outcome } = await requestStudentLink(teacher.id, student.id)

    expect(outcome).toBe('revoked')
    await expect(assertCanAccessStudent(asActor(teacher), student.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('does not disturb an accepted link when the request is repeated', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    await linkAccepted(teacher.id, student.id)

    const [before] = await db
      .select()
      .from(teacherStudentLinks)
      .where(eq(teacherStudentLinks.teacherId, teacher.id))

    const { outcome } = await requestStudentLink(teacher.id, student.id)
    const [after] = await db
      .select()
      .from(teacherStudentLinks)
      .where(eq(teacherStudentLinks.teacherId, teacher.id))

    expect(outcome).toBe('already_active')
    expect(after).toEqual(before)
  })

  it('lets an admin approve for a student, and records that it was the admin', async () => {
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    const admin = await createUser('admin')
    await requestStudentLink(teacher.id, student.id)
    const [request] = await listPendingLinkRequests(student.id)

    expect(await approveLinkAsAdmin(request!.id, admin.id)).toBe(true)

    const [link] = await db
      .select({ consentedBy: teacherStudentLinks.consentedBy })
      .from(teacherStudentLinks)
      .where(eq(teacherStudentLinks.id, request!.id))
    expect(link?.consentedBy).toBe(admin.id)
    await expect(assertCanAccessStudent(asActor(teacher), student.id)).resolves.toBeUndefined()
  })

  it('refuses an active link that carries no consent behind it', async () => {
    // What every pre-migration row looks like. The migration turns these back
    // to pending; this proves the runtime check does not depend on it having
    // run, so a row written by any other route is refused too.
    const teacher = await createUser('teacher')
    const student = await createUser('student')
    await db
      .insert(teacherStudentLinks)
      .values({ teacherId: teacher.id, studentId: student.id, status: 'active' })

    await expect(assertCanAccessStudent(asActor(teacher), student.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('still refuses a student reaching for another student', async () => {
    const a = await createUser('student')
    const b = await createUser('student')
    await expect(assertCanAccessStudent(asActor(a), b.id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

/* ═══════════ P0-2 · protected writes refuse an unconsented link ═════════ */

describe.skipIf(!hasDatabase)('protected work on a student', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('refuses an assignment and a star while the link is pending, and writes nothing', async () => {
    const { findOrCreateVocabulary } = await import('@/lib/data/vocabulary')
    const { addToSet, assignSet, createSet } = await import('@/lib/data/teacher')
    const { markImportant } = await import('@/lib/data/study')
    const { assignments, userVocabularyState } = await import('@/lib/db/schema')

    const teacher = await createUser('teacher')
    const student = await createUser('student')
    await verifyTeacher(teacher.id)
    await requestStudentLink(teacher.id, student.id)

    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'consent' })
    const setId = await createSet({ ownerId: teacher.id, title: '범위' })
    await addToSet(setId, [vocabularyId])

    // The order that matters: the gate runs before the write, so a refused
    // request cannot leave half of itself behind.
    await expect(assertCanAccessStudent(asActor(teacher), student.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    )

    const guarded = async (fn: () => Promise<unknown>) => {
      await assertCanAccessStudent(asActor(teacher), student.id)
      return fn()
    }
    await expect(
      guarded(() => assignSet({ setId, studentId: student.id, assignedBy: teacher.id })),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      guarded(() =>
        markImportant({
          userId: student.id,
          vocabularyId,
          important: true,
          reason: 'teacher_selected',
          markedBy: teacher.id,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(await db.select().from(assignments)).toEqual([])
    expect(await db.select().from(userVocabularyState)).toEqual([])
  })

  it('allows the same work once the student has accepted', async () => {
    const { findOrCreateVocabulary } = await import('@/lib/data/vocabulary')
    const { addToSet, assignSet, createSet } = await import('@/lib/data/teacher')
    const { assignments } = await import('@/lib/db/schema')

    const teacher = await createUser('teacher')
    const student = await createUser('student')
    await verifyTeacher(teacher.id)
    await linkAccepted(teacher.id, student.id)

    const { id: vocabularyId } = await findOrCreateVocabulary({ lemma: 'consent' })
    const setId = await createSet({ ownerId: teacher.id, title: '범위' })
    await addToSet(setId, [vocabularyId])

    await assertCanAccessStudent(asActor(teacher), student.id)
    await assignSet({ setId, studentId: student.id, assignedBy: teacher.id })

    expect(await db.select().from(assignments)).toHaveLength(1)
  })
})
