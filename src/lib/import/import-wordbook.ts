import 'server-only'
import type { Actor } from '@/lib/auth/session'
import { writeDraft } from '@/lib/data/brain-map'
import { addToSet, assignSet, assertCanAccessStudent, createSet } from '@/lib/data/teacher'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { parseWordbook, type ParseProblem } from './wordbook'
import { draftHasQuestions, toBrainMapDraft } from './to-draft'
import { WRITE_CONCURRENCY, inBatches } from './batches'

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

  // A definition question draws its wrong answers from the rest of the range,
  // so whether any word can be asked that way is a fact about the paste, not
  // about the word.
  const rivalDefinitions =
    entries.filter((entry) => entry.senses.some((sense) => sense.enDefinition)).length >= 2

  const setId = await createSet({ ownerId: input.actor.id, title: input.title })

  // Words are written several at a time rather than one after another.
  //
  // Each word costs about seventeen round trips — find it, insert it, its
  // glosses, then the map's head and every part of it inside a transaction —
  // and fifty of them in a row is eight hundred and fifty round trips in
  // series. Locally that is under a second; against a database three hops away
  // at fifty milliseconds a trip it is most of a minute, which is what the
  // teacher was staring at.
  //
  // Nothing about one word depends on another, so the wait is pure latency and
  // overlapping it is the whole fix. The width is the connection pool's, not a
  // guess: past that the queries queue on the client instead.
  const written = await inBatches(entries, WRITE_CONCURRENCY, async (entry) => {
    const draft = toBrainMapDraft(entry)

    // `findOrCreateVocabulary` is safe to run beside itself — the natural key
    // is the arbiter and the loser re-reads — so a list that repeats a word
    // still lands on one row.
    const vocabulary = await findOrCreateVocabulary({
      lemma: entry.lemma,
      partOfSpeech: entry.senses[0]?.partOfSpeech ?? null,
      translations: draft.primaryTranslations,
      createdBy: input.actor.id,
    })

    await writeDraft(vocabulary.id, draft, {
      status: 'approved',
      createdBy: input.actor.id,
      model: null,
      reviewNote: '단어장 직접 입력',
    })

    return {
      id: vocabulary.id,
      created: vocabulary.created,
      synonyms: entry.synonyms.length,
      // Worth naming: a word the list gave nothing askable for still gets a
      // map, but every node on it is a card with no question under it.
      askable: draftHasQuestions(draft, { rivalDefinitions }),
      lemma: entry.lemma,
    }
  })

  // In the order they were typed, whatever order they finished in.
  const ids = written.map((word) => word.id)
  const created = written.filter((word) => word.created).length
  const synonymsSkipped = written.reduce((n, word) => n + word.synonyms, 0)
  const withoutQuestions = written.filter((word) => !word.askable).map((word) => word.lemma)

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
