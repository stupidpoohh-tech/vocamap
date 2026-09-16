'use server'

import { revalidatePath } from 'next/cache'
import { fillDefinitionReadings } from '@/lib/data/definition-reading'
import { eq, sql } from 'drizzle-orm'
import { requireCurator } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import {
  addToSet,
  assignSet,
  assertCanAccessStudent,
  findOrCreateSet,
  deleteWordSet,
  requestStudentLink,
} from '@/lib/data/teacher'
import { ForbiddenError, NotFoundError } from '@/lib/data/errors'
import { importVocabularyList } from '@/lib/data/vocabulary'
import { markImportant } from '@/lib/data/study'
import { importWordbook } from '@/lib/import/import-wordbook'

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
  const actor = await requireCurator()

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
  // Same name, same set — see `findOrCreateSet`.
  const { id: setId } = await findOrCreateSet({ ownerId: actor.id, title })
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
  const actor = await requireCurator()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!email) return { error: '학생 이메일을 입력해 주세요.' }

  const [student] = await db
    .select({ id: users.id, role: users.role, displayName: users.displayName })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)

  if (!student) return { error: '해당 이메일로 가입한 사용자가 없습니다.' }
  if (student.role !== 'student') return { error: '학생 계정만 추가할 수 있습니다.' }

  // A request, not an addition. The teacher does not get the student's record
  // until the student says yes on their own screen.
  const { outcome } = await requestStudentLink(actor.id, student.id)
  revalidatePath('/teacher')

  switch (outcome) {
    case 'already_active':
      return { message: `${student.displayName} 학생은 이미 연결되어 있습니다.` }
    case 'already_pending':
      return { message: `${student.displayName} 학생의 수락을 기다리는 중입니다.` }
    case 'revoked':
      // Saying so plainly, and not re-requesting. A student who disconnected
      // does not get re-linked because the teacher retyped their address.
      return {
        message: `${student.displayName} 학생이 연결을 해제한 상태입니다. 학생이 직접 다시 수락해야 합니다.`,
      }
    default:
      return {
        message: `${student.displayName} 학생에게 연결을 요청했습니다. 학생이 수락하면 기록을 볼 수 있어요.`,
      }
  }
}

export async function flagImportant(studentId: string, vocabularyId: string): Promise<void> {
  const actor = await requireCurator()
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
  const actor = await requireCurator()

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
  const actor = await requireCurator()

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

  // Which set the words landed in is the first thing the teacher needs to know
  // when the name was one they had used before — otherwise "50개 단어"
  // reads as a new set of fifty.
  const already = summary.words - summary.addedToSet
  const notes = [
    summary.setCreated
      ? `'${title}' 세트를 만들었어요`
      : `기존 '${title}' 세트에 넣었어요${already ? ` (이미 있던 ${already}개는 그대로)` : ''}`,
    `${summary.words}개 단어 · 새로 ${summary.created}개, 기존 ${summary.reused}개`,
    summary.synonymsSkipped ? `유의어 ${summary.synonymsSkipped}개는 넣지 않았어요` : null,
    summary.filledMeanings.length
      ? `뜻이 비어 있던 단어에 뜻을 채웠어요: ${summary.filledMeanings.join(', ')}`
      : null,
    // Said plainly, because the alternative is a teacher believing the new
    // wording went in. Nothing was merged and nothing was replaced: the map
    // that was already there is the one students still see.
    summary.keptExistingMap.length
      ? `이미 맵이 있는 단어는 기존 맵을 그대로 두었어요 (이번 입력 미반영): ${summary.keptExistingMap.join(', ')}`
      : null,
    summary.withoutQuestions.length
      ? `낼 문제가 없는 단어: ${summary.withoutQuestions.join(', ')}`
      : null,
  ].filter(Boolean)

  return { message: notes.join(' · '), problems }
}

/* ────────────────────────── definition readings ────────────────────────── */

export type ReadingState = { error?: string; message?: string }

/**
 * Translates a batch of English definitions that have none.
 *
 * One model call for forty, on the tutor's say-so. The import path stays free
 * of model calls — this is the one place that spends anything, and only for
 * definitions that have never been read.
 */
export async function fillDefinitionReadingBatch(): Promise<ReadingState> {
  await requireCurator()
  try {
    const result = await fillDefinitionReadings()
    if (result.attempted === 0) return { message: '해석이 없는 영영 풀이가 없어요.' }

    revalidatePath('/teacher')
    revalidatePath('/study')
    return {
      message:
        result.remaining > 0
          ? `${result.filled}개 채웠어요. ${result.remaining}개 남았어요 — 한 번 더 누르면 이어서 채워요.`
          : `${result.filled}개 채웠어요. 남은 풀이가 없어요.`,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '해석을 가져오지 못했어요.' }
  }
}
