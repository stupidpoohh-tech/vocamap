import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import { brainMapMeanings, brainMaps, vocabularies } from '@/lib/db/schema'
import {
  DEFINITION_READING_PROMPT_VERSION,
  DEFINITION_READING_SYSTEM,
  cleanReading,
  definitionReadingBatchSchema,
  definitionReadingPrompt,
  getLLMProvider,
  type DefinitionReadingBatch,
} from '@/lib/ai'

/**
 * Filling in what the English definitions say, in Korean.
 *
 * Done a batch at a time on the tutor's say-so rather than during import: the
 * import path is deliberately free of model calls, and this only ever has to
 * be made once per definition.
 */
export const DEFINITION_READING_BATCH = 40

export type DefinitionReadingFill = {
  /** Definitions that had no reading before this run. */
  attempted: number
  filled: number
  /** Still blank after this run — another batch, or the model had no answer. */
  remaining: number
}

/**
 * Definitions with nothing to show and nothing proposed. The number on the
 * button.
 *
 * A definition whose candidate is waiting for a curator is not counted: it
 * needs a decision, not another generation, and counting it would leave the
 * button offering to do work that would be refused.
 */
export async function countMissingReadings(db: Db = defaultDb): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(brainMapMeanings)
    .where(
      and(
        isNotNull(brainMapMeanings.enDefinition),
        isNull(brainMapMeanings.enDefinitionKo),
        isNull(brainMapMeanings.enDefinitionKoDraft),
      ),
    )
  return row?.value ?? 0
}

export async function fillDefinitionReadings(
  opts: { limit?: number } = {},
  db: Db = defaultDb,
): Promise<DefinitionReadingFill> {
  const limit = Math.min(opts.limit ?? DEFINITION_READING_BATCH, 100)

  // The word comes along because the model translates better with the term in
  // hand, and because `cleanReading` needs the gloss to catch the one failure
  // that matters: answering with the gloss instead of the definition.
  const rows = await db
    .select({
      id: brainMapMeanings.id,
      gloss: brainMapMeanings.ko,
      definition: brainMapMeanings.enDefinition,
      lemma: vocabularies.lemma,
    })
    .from(brainMapMeanings)
    .innerJoin(brainMaps, eq(brainMaps.id, brainMapMeanings.brainMapId))
    .innerJoin(vocabularies, eq(vocabularies.id, brainMaps.vocabularyId))
    .where(
      and(
        isNotNull(brainMapMeanings.enDefinition),
        isNull(brainMapMeanings.enDefinitionKo),
        // Already proposed. Generating a second candidate would replace one a
        // curator may be part-way through reading, and cost a model call to do
        // it.
        isNull(brainMapMeanings.enDefinitionKoDraft),
      ),
    )
    .orderBy(asc(vocabularies.lemma))
    .limit(limit)

  if (!rows.length) return { attempted: 0, filled: 0, remaining: 0 }

  const entries = rows.map((row) => ({
    id: row.id,
    lemma: row.lemma,
    definition: row.definition!,
  }))

  const provider = getLLMProvider()
  const result = await provider.generateStructured<DefinitionReadingBatch>({
    system: DEFINITION_READING_SYSTEM,
    prompt: definitionReadingPrompt(entries),
    schema: definitionReadingBatchSchema,
    schemaName: 'definition_reading_batch',
    maxTokens: 8000,
  })

  // Matched on the number the entry was given, not on position in the reply: a
  // model that drops or reorders one must not hand `goal`'s reading to `dot`.
  const byNumber = new Map(result.data.entries.map((entry) => [entry.number, entry.ko]))

  const writes: Array<{ id: string; ko: string }> = []
  rows.forEach((row, index) => {
    const raw = byNumber.get(index + 1)
    const ko = raw ? cleanReading(raw, row.gloss) : null
    if (ko) writes.push({ id: row.id, ko })
  })

  // Into the draft column, never the published one.
  //
  // This used to write `en_definition_ko` directly, which put text no human had
  // read in front of every student and guest the moment the model answered.
  // The draft sits beside the live reading instead: students see nothing new
  // until a curator approves it, and a word that already had a reading keeps
  // showing it throughout.
  //
  // One statement rather than forty. Everything here is a round trip to a
  // database that is not in this building — see `src/lib/import/batches.ts`.
  const generatedAt = new Date()
  let filled = 0
  if (writes.length) {
    const updated = await db
      .update(brainMapMeanings)
      .set({
        enDefinitionKoDraft: sql`case ${sql.join(
          writes.map((write) => sql`when ${brainMapMeanings.id} = ${write.id} then ${write.ko}`),
          sql` `,
        )} end`,
        enDefinitionKoModel: provider.model,
        enDefinitionKoPromptVersion: DEFINITION_READING_PROMPT_VERSION,
        enDefinitionKoGeneratedAt: generatedAt,
      })
      .where(
        and(
          inArray(
            brainMapMeanings.id,
            writes.map((write) => write.id),
          ),
          // Two guards, both re-checked at write time rather than at read time,
          // so a run that started before a curator typed something does not
          // land on top of it when it finishes.
          //
          // Still blank: a human who wrote the reading outranks the model.
          isNull(brainMapMeanings.enDefinitionKo),
          // Still unproposed: two runs over the same batch — a double click, a
          // second tab — leave one candidate, not the later one silently
          // replacing the one a curator may already be looking at.
          isNull(brainMapMeanings.enDefinitionKoDraft),
        ),
      )
      .returning({ id: brainMapMeanings.id })
    filled = updated.length
  }

  return {
    attempted: rows.length,
    filled,
    remaining: await countMissingReadings(db),
  }
}

/**
 * Candidates waiting for a curator, newest batch first.
 *
 * Read by the review screen. A row appears here only while it has a draft and
 * no published reading — approving or rejecting takes it out.
 */
export async function listReadingCandidates(limit = 50, db: Db = defaultDb) {
  return db
    .select({
      id: brainMapMeanings.id,
      lemma: vocabularies.lemma,
      gloss: brainMapMeanings.ko,
      definition: brainMapMeanings.enDefinition,
      draft: brainMapMeanings.enDefinitionKoDraft,
      model: brainMapMeanings.enDefinitionKoModel,
      promptVersion: brainMapMeanings.enDefinitionKoPromptVersion,
      generatedAt: brainMapMeanings.enDefinitionKoGeneratedAt,
    })
    .from(brainMapMeanings)
    .innerJoin(brainMaps, eq(brainMaps.id, brainMapMeanings.brainMapId))
    .innerJoin(vocabularies, eq(vocabularies.id, brainMaps.vocabularyId))
    .where(
      and(isNotNull(brainMapMeanings.enDefinitionKoDraft), isNull(brainMapMeanings.enDefinitionKo)),
    )
    .orderBy(asc(vocabularies.lemma))
    .limit(limit)
}

export async function countReadingCandidates(db: Db = defaultDb): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(brainMapMeanings)
    .where(
      and(isNotNull(brainMapMeanings.enDefinitionKoDraft), isNull(brainMapMeanings.enDefinitionKo)),
    )
  return row?.value ?? 0
}

/**
 * A curator publishing a candidate, possibly after editing it.
 *
 * `text` is what actually gets published — the reviewer's version if they
 * changed it, the model's if they did not. Either way the row records who
 * approved it and when, beside the model and prompt version that produced it,
 * so a reading can always be traced from what a student reads back to how it
 * came to say that.
 *
 * The write requires the draft to still be there and the published field to
 * still be empty. Two curators approving the same row at once means the second
 * writes nothing and is told so, rather than overwriting the first.
 */
export async function approveReading(
  input: { meaningId: string; text: string; approvedBy: string },
  db: Db = defaultDb,
): Promise<boolean> {
  const text = input.text.trim()
  if (!text) return false

  const updated = await db
    .update(brainMapMeanings)
    .set({
      enDefinitionKo: text,
      enDefinitionKoDraft: null,
      enDefinitionKoApprovedBy: input.approvedBy,
      enDefinitionKoApprovedAt: new Date(),
    })
    .where(
      and(
        eq(brainMapMeanings.id, input.meaningId),
        isNotNull(brainMapMeanings.enDefinitionKoDraft),
        isNull(brainMapMeanings.enDefinitionKo),
      ),
    )
    .returning({ id: brainMapMeanings.id })

  return updated.length > 0
}

/** Throwing a candidate away. The published reading, if any, is untouched. */
export async function rejectReading(meaningId: string, db: Db = defaultDb): Promise<boolean> {
  const updated = await db
    .update(brainMapMeanings)
    .set({
      enDefinitionKoDraft: null,
      enDefinitionKoModel: null,
      enDefinitionKoPromptVersion: null,
      enDefinitionKoGeneratedAt: null,
    })
    .where(
      and(eq(brainMapMeanings.id, meaningId), isNotNull(brainMapMeanings.enDefinitionKoDraft)),
    )
    .returning({ id: brainMapMeanings.id })
  return updated.length > 0
}
