import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import { vocabularies } from '@/lib/db/schema'
import {
  PRONUNCIATION_SYSTEM,
  cleanIpa,
  getLLMProvider,
  pronunciationBatchSchema,
  pronunciationPrompt,
  type PronunciationBatch,
} from '@/lib/ai'

/**
 * Filling in the phonetics the wordbooks did not print.
 *
 * Done a batch at a time on the tutor's say-so rather than during import: the
 * import path is deliberately free of model calls, and this is one call for
 * forty words that only ever has to be made once per word.
 */
export const PRONUNCIATION_BATCH = 40

export type PronunciationFill = {
  /** Words that had no transcription before this run. */
  attempted: number
  filled: number
  /** Still blank after this run — another batch, or the model had no answer. */
  remaining: number
}

export async function countMissingPronunciation(db: Db = defaultDb): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(vocabularies)
    .where(isNull(vocabularies.pronunciation))
  return row?.value ?? 0
}

export async function fillPronunciations(
  opts: { limit?: number } = {},
  db: Db = defaultDb,
): Promise<PronunciationFill> {
  const limit = Math.min(opts.limit ?? PRONUNCIATION_BATCH, 100)

  const words = await db
    .select({ id: vocabularies.id, lemma: vocabularies.lemma })
    .from(vocabularies)
    .where(isNull(vocabularies.pronunciation))
    .orderBy(asc(vocabularies.lemma))
    .limit(limit)

  if (!words.length) return { attempted: 0, filled: 0, remaining: 0 }

  const provider = getLLMProvider()
  const result = await provider.generateStructured<PronunciationBatch>({
    system: PRONUNCIATION_SYSTEM,
    prompt: pronunciationPrompt(words.map((word) => word.lemma)),
    schema: pronunciationBatchSchema,
    schemaName: 'pronunciation_batch',
    maxTokens: 4000,
  })

  // Matched on the word, not on position: a model that drops or reorders an
  // entry must not hand `aspire`'s transcription to `assert`.
  const byLemma = new Map<string, string>()
  for (const entry of result.data.entries) {
    const ipa = cleanIpa(entry.ipa)
    if (ipa) byLemma.set(entry.lemma.trim().toLowerCase(), ipa)
  }

  let filled = 0
  for (const word of words) {
    const ipa = byLemma.get(word.lemma.trim().toLowerCase())
    if (!ipa) continue
    await db
      .update(vocabularies)
      .set({ pronunciation: ipa })
      // Only where it is still blank: a tutor who typed one in from the book
      // outranks the model.
      .where(and(eq(vocabularies.id, word.id), isNull(vocabularies.pronunciation)))
    filled += 1
  }

  return { attempted: words.length, filled, remaining: await countMissingPronunciation(db) }
}
