import 'server-only'
import type { Actor } from '@/lib/auth/session'
import { writeDraft } from '@/lib/data/brain-map'
import { addToSet, assignSet, assertCanAccessStudent, createSet } from '@/lib/data/teacher'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { parseWordbook, type ParseProblem } from './wordbook'
import { toBrainMapDraft } from './to-draft'

export type ImportSummary = {
  setId: string
  words: number
  created: number
  reused: number
  /** Synonyms read but not imported — see `toBrainMapDraft`. */
  synonymsSkipped: number
  /** Words whose example had no translation, so it makes no question. */
  withoutQuestions: string[]
  problems: ParseProblem[]
}

/**
 * A typed-out wordbook page, all the way into the library.
 *
 * The text is parsed here rather than trusted from the browser. The paste
 * screen parses the same text to draw its preview, which is a convenience for
 * the person typing — it is not a source of truth, and a request that skipped
 * the screen entirely has to produce the same result.
 *
 * Written in as `approved`. The material was copied from a published book by
 * the teacher who is about to teach it; the review queue exists to catch what a
 * model invented, and there is nothing here that a model touched.
 */
export async function importWordbook(
  input: { text: string; title: string; actor: Actor; studentId?: string },
): Promise<ImportSummary> {
  const { entries, problems } = parseWordbook(input.text)
  if (!entries.length) {
    return {
      setId: '',
      words: 0,
      created: 0,
      reused: 0,
      synonymsSkipped: 0,
      withoutQuestions: [],
      problems,
    }
  }

  const setId = await createSet({ ownerId: input.actor.id, title: input.title })

  const ids: string[] = []
  let created = 0
  let synonymsSkipped = 0
  const withoutQuestions: string[] = []

  for (const entry of entries) {
    const draft = toBrainMapDraft(entry)
    synonymsSkipped += entry.synonyms.length

    const vocabulary = await findOrCreateVocabulary({
      lemma: entry.lemma,
      partOfSpeech: entry.senses[0]?.partOfSpeech ?? null,
      pronunciation: entry.pronunciation,
      translations: draft.primaryTranslations,
      createdBy: input.actor.id,
    })
    if (vocabulary.created) created += 1
    ids.push(vocabulary.id)

    await writeDraft(vocabulary.id, draft, {
      status: 'approved',
      createdBy: input.actor.id,
      model: null,
      reviewNote: '단어장 직접 입력',
    })

    // Worth naming: a word whose only example arrived without a translation
    // still gets a map, but its meaning node has nothing to ask.
    if (!draft.sentences.length) withoutQuestions.push(entry.lemma)
  }

  await addToSet(setId, ids)

  if (input.studentId) {
    await assertCanAccessStudent(input.actor, input.studentId)
    await assignSet({ setId, studentId: input.studentId, assignedBy: input.actor.id })
  }

  return {
    setId,
    words: entries.length,
    created,
    reused: ids.length - created,
    synonymsSkipped,
    withoutQuestions,
    problems,
  }
}
