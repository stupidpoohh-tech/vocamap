import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL)

/**
 * Wipes every table.
 *
 * Guarded twice over, because getting this wrong destroys a developer's local
 * seed data: `tests/setup.ts` only ever exposes `TEST_DATABASE_URL`, and this
 * refuses to run unless the target database name marks itself as a test
 * database. Name your test database `vocamap_test` (or anything containing
 * "test").
 */
export async function resetDatabase(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? ''
  const database = url.split('/').pop()?.split('?')[0] ?? ''
  if (!/test/i.test(database)) {
    throw new Error(
      `Refusing to truncate "${database}": TEST_DATABASE_URL must name a test database.`,
    )
  }

  await db.execute(sql`
    truncate table
      review_events, learning_events, brain_map_node_progress, user_confusions,
      user_vocabulary_cards, user_vocabulary_state, assignments,
      vocabulary_set_items, vocabulary_sets, ai_generation_jobs,
      brain_map_revisions, brain_map_similar_words, word_pair_questions,
      word_pairs, brain_map_word_family, brain_map_collocations,
      brain_map_sentences, brain_map_meanings, brain_maps,
      vocabulary_translations, vocabularies, teacher_student_links,
      sessions, users
    restart identity cascade
  `)
}

let counter = 0

export async function createUser(role: 'student' | 'teacher' | 'admin' = 'student') {
  counter += 1
  const email = `${role}-${counter}-${Date.now()}@test.local`
  const [row] = await db
    .insert(users)
    .values({ email, displayName: `${role} ${counter}`, role, passwordHash: 'x' })
    .returning()
  if (!row) throw new Error('failed to create user')
  return { id: row.id, email: row.email, displayName: row.displayName, role }
}

/**
 * A teacher and student who have actually agreed.
 *
 * Most tests care about what an accepted link permits, not about how it comes
 * to exist, and writing `status: 'active'` by hand in a fixture would quietly
 * skip the consent this codebase now requires. So the fixture plays out the
 * real path: the teacher asks, the student says yes.
 */
export async function linkAccepted(teacherId: string, studentId: string): Promise<string> {
  const { requestStudentLink, listPendingLinkRequests, acceptTeacherLink } = await import(
    '@/lib/data/teacher'
  )
  await requestStudentLink(teacherId, studentId)
  const [pending] = await listPendingLinkRequests(studentId)
  if (!pending) throw new Error('link request was not created')
  if (!(await acceptTeacherLink(pending.id, studentId))) throw new Error('accept failed')
  return pending.id
}

/** Marks a teacher account as vouched for, the way an admin would. */
export async function verifyTeacher(teacherId: string): Promise<void> {
  const { db } = await import('@/lib/db')
  const { users } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')
  await db.update(users).set({ teacherVerifiedAt: new Date() }).where(eq(users.id, teacherId))
}
