import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import { brainMapMeanings, brainMaps, vocabularies } from '@/lib/db/schema'
import {
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

/** Definitions with no reading yet. The number on the button. */
export async function countMissingReadings(db: Db = defaultDb): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(brainMapMeanings)
    .where(and(isNotNull(brainMapMeanings.enDefinition), isNull(brainMapMeanings.enDefinitionKo)))
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
    .where(and(isNotNull(brainMapMeanings.enDefinition), isNull(brainMapMeanings.enDefinitionKo)))
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

  // One statement rather than forty. Everything here is a round trip to a
  // database that is not in this building — see `src/lib/import/batches.ts`.
  if (writes.length) {
    await db
      .update(brainMapMeanings)
      .set({
        enDefinitionKo: sql`case ${sql.join(
          writes.map((write) => sql`when ${brainMapMeanings.id} = ${write.id} then ${write.ko}`),
          sql` `,
        )} end`,
      })
      .where(
        and(
          inArray(
            brainMapMeanings.id,
            writes.map((write) => write.id),
          ),
          // Only where it is still blank: a teacher who typed the column in
          // outranks the model.
          isNull(brainMapMeanings.enDefinitionKo),
        ),
      )
  }

  return {
    attempted: rows.length,
    filled: writes.length,
    remaining: await countMissingReadings(db),
  }
}
