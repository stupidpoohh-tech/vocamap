'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import {
  addToSet,
  assignSet,
  assertCanAccessStudent,
  createSet,
  deleteWordSet,
  linkStudent,
} from '@/lib/data/teacher'
import { ForbiddenError, NotFoundError } from '@/lib/data/errors'
import { importVocabularyList } from '@/lib/data/vocabulary'
import { markImportant } from '@/lib/data/study'
import { importWordbook } from '@/lib/import/import-wordbook'
import { fillPronunciations } from '@/lib/data/pronunciation'

export type ImportState = { error?: string; message?: string }

/**
 * Parses a pasted word list and turns it into an assigned set.
 *
 * Accepted per line: `maintain`, `maintain, 유지하다`, or
 * `maintain, 유지하다, verb` — the shapes a teacher actually has to hand from a
 * textbook or a spreadsheet. Existing words are reused, never re-created, so
 * the Brain Maps we already own come along for free.
 */
export async function importWords(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const actor = await requireRole('teacher', 'admin')

  const title = String(formData.get('title') ?? '').trim()
  const raw = String(formData.get('words') ?? '')
  const studentId = String(formData.get('studentId') ?? '').trim()

  if (!title) return { error: '세트 이름을 입력해 주세요.' }

  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [lemma, translation, partOfSpeech] = line.split(/[,\t]/).map((p) => p?.trim())
      return {
        lemma: lemma ?? '',
        translations: translation ? [translation] : [],
        partOfSpeech: partOfSpeech || null,
        createdBy: actor.id,
      }
    })
    .filter((row) => row.lemma.length > 0)

  if (!rows.length) return { error: '단어를 한 줄에 하나씩 입력해 주세요.' }

  const result = await importVocabularyList(rows)
  const setId = await createSet({ ownerId: actor.id, title })
  await addToSet(setId, [...result.created, ...result.reused])

  if (studentId) {
    await assertCanAccessStudent(actor, studentId)
    await assignSet({ setId, studentId, assignedBy: actor.id })
  }

  revalidatePath('/teacher')
  return {
    message: `${rows.length}개 처리 · 새 단어 ${result.created.length}개, 기존 단어 재사용 ${result.reused.length}개`,
  }
}

export type LinkState = { error?: string; message?: string }

export async function addStudent(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const actor = await requireRole('teacher', 'admin')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!email) return { error: '학생 이메일을 입력해 주세요.' }

  const [student] = await db
    .select({ id: users.id, role: users.role, displayName: users.displayName })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)

  if (!student) return { error: '해당 이메일로 가입한 사용자가 없습니다.' }
  if (student.role !== 'student') return { error: '학생 계정만 추가할 수 있습니다.' }

  await linkStudent(actor.id, student.id)
  revalidatePath('/teacher')
  return { message: `${student.displayName} 학생을 추가했습니다.` }
}

export async function flagImportant(studentId: string, vocabularyId: string): Promise<void> {
  const actor = await requireRole('teacher', 'admin')
  await assertCanAccessStudent(actor, studentId)
  await markImportant({
    userId: studentId,
    vocabularyId,
    important: true,
    reason: 'teacher_selected',
    markedBy: actor.id,
  })
  revalidatePath(`/teacher/students/${studentId}`)
}

/**
 * Deletes a set, but never its words.
 *
 * Worth saying out loud because the two are easy to confuse: the words stay in
 * the library with their Brain Maps and every student's history intact. What
 * goes is the grouping and the assignments that handed it out.
 */
export async function removeWordSet(
  input: { setId: string },
): Promise<{ ok: true; title: string } | { ok: false; message: string }> {
  const actor = await requireRole('teacher', 'admin')

  try {
    const { title } = await deleteWordSet({ setId: input.setId, actor })
    revalidatePath('/teacher')
    revalidatePath('/study')
    revalidatePath('/map')
    return { ok: true, title }
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      return { ok: false, message: error.message }
    }
    throw error
  }
}

export type WordbookState = { error?: string; message?: string; problems?: string[] }

/**
 * Builds Brain Maps straight from a typed-out wordbook page.
 *
 * The other importer takes a bare list and leaves the maps to be generated;
 * this one carries the whole entry — senses, example, collocations, derived
 * forms — so the map is finished the moment it lands, with no model call and
 * nothing to review.
 */
export async function importWordbookPage(
  _prev: WordbookState,
  formData: FormData,
): Promise<WordbookState> {
  const actor = await requireRole('teacher', 'admin')

  const title = String(formData.get('title') ?? '').trim()
  const text = String(formData.get('text') ?? '')
  const studentId = String(formData.get('studentId') ?? '').trim()

  if (!title) return { error: '세트 이름을 입력해 주세요.' }
  if (!text.trim()) return { error: '단어장 내용을 붙여넣어 주세요.' }

  const summary = await importWordbook({
    text,
    title,
    actor,
    studentId: studentId || undefined,
  })

  // Lines that could not be read are reported whether or not the rest imported:
  // a page that came in "successfully" while quietly dropping four lines is how
  // a set ends up missing words nobody notices until the test.
  const problems = summary.problems.map((p) => `${p.line}행: ${p.message}`)

  if (!summary.words) {
    return { error: '읽을 수 있는 단어가 없습니다.', problems }
  }

  revalidatePath('/teacher')
  revalidatePath('/study')
  revalidatePath('/map')

  const notes = [
    `${summary.words}개 단어 · 새로 ${summary.created}개, 기존 ${summary.reused}개`,
    summary.synonymsSkipped ? `유의어 ${summary.synonymsSkipped}개는 넣지 않았어요` : null,
    summary.withoutQuestions.length
      ? `예문 해석이 없어 문제를 못 만든 단어: ${summary.withoutQuestions.join(', ')}`
      : null,
  ].filter(Boolean)

  return { message: notes.join(' · '), problems }
}

/* ───────────────────────────── pronunciation ───────────────────────────── */

export type PronunciationState = { error?: string; message?: string }

/**
 * Fills in the phonetics for a batch of words that have none.
 *
 * One model call for forty words, on the tutor's say-so. The import path stays
 * free of model calls — this is the one place that spends anything, and only
 * for words that have never been transcribed.
 */
export async function fillPronunciationBatch(): Promise<PronunciationState> {
  await requireRole('teacher', 'admin')
  try {
    const result = await fillPronunciations()
    if (result.attempted === 0) return { message: '발음기호가 없는 단어가 없어요.' }

    revalidatePath('/teacher')
    revalidatePath('/study')
    return {
      message:
        result.remaining > 0
          ? `${result.filled}개 채웠어요. ${result.remaining}개 남았어요 — 한 번 더 누르면 이어서 채워요.`
          : `${result.filled}개 채웠어요. 남은 단어가 없어요.`,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '발음기호를 가져오지 못했어요.' }
  }
}
