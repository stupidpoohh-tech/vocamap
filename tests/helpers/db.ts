import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

export const hasDatabase = Boolean(process.env.DATABASE_URL)

/** Wipes every table. Only ever called against the test database. */
export async function resetDatabase(): Promise<void> {
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
