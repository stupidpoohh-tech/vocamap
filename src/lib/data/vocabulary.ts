import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  brainMaps,
  vocabularies,
  vocabularySetItems,
  vocabularyTranslations,
} from '@/lib/db/schema'

export type VocabularyInput = {
  lemma: string
  language?: string
  partOfSpeech?: string | null
  level?: string | null
  /** As printed in the wordbook, without brackets. */
  pronunciation?: string | null
  translations?: string[]
  isSeed?: boolean
  createdBy?: string | null
}

/** Lookup key for the shared knowledge base. Must match `vocabularies_natural_key`. */
export function normaliseLemma(lemma: string): string {
  return lemma.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * The single entry point for putting a word into the shared knowledge base.
 *
 * A teacher importing 100 words for a new student must land on the *existing*
 * rows for the 87 we already know, so that their Brain Maps are reused rather
 * than regenerated. That reuse hinges entirely on this function being the only
 * writer — never insert into `vocabularies` directly.
 */
export async function findOrCreateVocabulary(
  input: VocabularyInput,
  db: Db = defaultDb,
): Promise<{ id: string; created: boolean }> {
  const lemma = normaliseLemma(input.lemma)
  if (!lemma) throw new Error('lemma is required')
  const language = input.language ?? 'en'
  const partOfSpeech = input.partOfSpeech?.trim() || null

  const pronunciation = input.pronunciation?.trim() || null

  const existing = await findVocabulary({ lemma, language, partOfSpeech }, db)
  if (existing) {
    if (input.translations?.length) await addTranslations(existing.id, input.translations, db)
    // Fills a gap, never overwrites: a word already carrying a transcription
    // was given one deliberately, and a later import of the same word from a
    // list that has none should not erase it.
    if (pronunciation) {
      await db
        .update(vocabularies)
        .set({ pronunciation })
        .where(and(eq(vocabularies.id, existing.id), isNull(vocabularies.pronunciation)))
    }
    return { id: existing.id, created: false }
  }

  // Concurrent imports of the same word race here; the unique index is the
  // arbiter and the loser falls through to the re-select below.
  const inserted = await db
    .insert(vocabularies)
    .values({
      lemma,
      language,
      partOfSpeech,
      pronunciation,
      level: input.level ?? null,
      isSeed: input.isSeed ?? false,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: vocabularies.id })

  const id = inserted[0]?.id ?? (await findVocabulary({ lemma, language, partOfSpeech }, db))?.id
  if (!id) throw new Error(`Failed to upsert vocabulary "${lemma}"`)

  if (input.translations?.length) await addTranslations(id, input.translations, db)
  return { id, created: inserted.length > 0 }
}

async function findVocabulary(
  key: { lemma: string; language: string; partOfSpeech: string | null },
  db: Db,
) {
  const [row] = await db
    .select({ id: vocabularies.id })
    .from(vocabularies)
    .where(
      and(
        sql`lower(${vocabularies.lemma}) = ${key.lemma}`,
        eq(vocabularies.language, key.language),
        sql`coalesce(${vocabularies.partOfSpeech}, '') = ${key.partOfSpeech ?? ''}`,
      ),
    )
    .limit(1)
  return row ?? null
}

export async function addTranslations(
  vocabularyId: string,
  texts: string[],
  db: Db = defaultDb,
): Promise<void> {
  const cleaned = [...new Set(texts.map((t) => t.trim()).filter(Boolean))]
  if (!cleaned.length) return

  const existing = await db
    .select({ id: vocabularyTranslations.id })
    .from(vocabularyTranslations)
    .where(and(eq(vocabularyTranslations.vocabularyId, vocabularyId), eq(vocabularyTranslations.isPrimary, true)))
    .limit(1)
  const hasPrimary = existing.length > 0

  await db
    .insert(vocabularyTranslations)
    .values(
      cleaned.map((text, i) => ({
        vocabularyId,
        text,
        language: 'ko',
        isPrimary: !hasPrimary && i === 0,
        sortOrder: i,
      })),
    )
    .onConflictDoNothing()
}

/** Bulk import used by CSV / paste-a-list. Returns per-row outcome. */
export async function importVocabularyList(
  rows: VocabularyInput[],
  db: Db = defaultDb,
): Promise<{ created: string[]; reused: string[] }> {
  const created: string[] = []
  const reused: string[] = []
  for (const row of rows) {
    const result = await findOrCreateVocabulary(row, db)
    ;(result.created ? created : reused).push(result.id)
  }
  return { created, reused }
}

export type VocabularySummary = {
  id: string
  lemma: string
  partOfSpeech: string | null
  level: string | null
  translation: string | null
}

/**
 * Search accepts English or Korean. Plain Postgres, deliberately: at a few
 * thousand words a prefix index answers this in under a millisecond, and there
 * is no semantic-search requirement to justify pgvector yet.
 */
export async function searchVocabulary(
  query: string,
  limit = 20,
  db: Db = defaultDb,
): Promise<VocabularySummary[]> {
  const q = query.trim()
  if (!q) return []
  const pattern = `${q.toLowerCase()}%`
  const contains = `%${q.toLowerCase()}%`

  const matches = await db
    .selectDistinct({ id: vocabularies.id })
    .from(vocabularies)
    .leftJoin(vocabularyTranslations, eq(vocabularyTranslations.vocabularyId, vocabularies.id))
    .where(
      or(
        sql`lower(${vocabularies.lemma}) like ${pattern}`,
        ilike(vocabularyTranslations.text, contains),
      ),
    )
    .limit(limit)

  if (!matches.length) return []
  return listVocabularySummaries(
    matches.map((m) => m.id),
    db,
  )
}

export async function listVocabularySummaries(
  ids: string[],
  db: Db = defaultDb,
): Promise<VocabularySummary[]> {
  if (!ids.length) return []
  const rows = await db
    .select({
      id: vocabularies.id,
      lemma: vocabularies.lemma,
      partOfSpeech: vocabularies.partOfSpeech,
      level: vocabularies.level,
      translation: vocabularyTranslations.text,
      isPrimary: vocabularyTranslations.isPrimary,
      sortOrder: vocabularyTranslations.sortOrder,
    })
    .from(vocabularies)
    .leftJoin(vocabularyTranslations, eq(vocabularyTranslations.vocabularyId, vocabularies.id))
    .where(inArray(vocabularies.id, ids))
    .orderBy(asc(vocabularies.lemma), asc(vocabularyTranslations.sortOrder))

  const byId = new Map<string, VocabularySummary>()
  for (const row of rows) {
    const current = byId.get(row.id)
    if (!current) {
      byId.set(row.id, {
        id: row.id,
        lemma: row.lemma,
        partOfSpeech: row.partOfSpeech,
        level: row.level,
        translation: row.translation,
      })
    } else if (row.isPrimary && row.translation) {
      current.translation = row.translation
    }
  }
  return [...byId.values()]
}

/* ─────────────────────── the curator's word list ─────────────────────── */

export type BrainMapState = 'approved' | 'draft' | 'none'

export type LibraryWord = VocabularySummary & {
  brainMapStatus: BrainMapState
  bookmarked: boolean
}

/**
 * The shared word library, as a teacher needs to see it: every word with the
 * state of its Brain Map, worst first.
 *
 * Students read `assignments`; a teacher is not assigned anything, so showing
 * them that same list leaves them staring at an empty page with no route into
 * a word — which is where Brain Maps are made.
 */
export async function listLibraryWords(
  opts: { setId?: string; limit?: number; order?: 'needsWork' | 'alphabetical' } = {},
  db: Db = defaultDb,
): Promise<LibraryWord[]> {
  // Words with nothing yet are the ones needing attention, so they lead.
  const rank = sql<number>`case
    when ${brainMaps.status} is null then 0
    when ${brainMaps.status} = 'approved' then 2
    else 1
  end`

  const rows = await db
    .select({
      id: vocabularies.id,
      lemma: vocabularies.lemma,
      partOfSpeech: vocabularies.partOfSpeech,
      level: vocabularies.level,
      translation: vocabularyTranslations.text,
      status: brainMaps.status,
      rank,
    })
    .from(vocabularies)
    .leftJoin(
      vocabularyTranslations,
      and(
        eq(vocabularyTranslations.vocabularyId, vocabularies.id),
        eq(vocabularyTranslations.isPrimary, true),
      ),
    )
    .leftJoin(brainMaps, eq(brainMaps.vocabularyId, vocabularies.id))
    .where(
      opts.setId
        ? inArray(
            vocabularies.id,
            db
              .select({ id: vocabularySetItems.vocabularyId })
              .from(vocabularySetItems)
              .where(eq(vocabularySetItems.setId, opts.setId)),
          )
        : sql`true`,
    )
    // Curators are working a queue, so the words needing a Brain Map lead.
    // A learner is browsing, and "which of these lacks content" is not their
    // question — they get plain alphabetical.
    .orderBy(...(opts.order === 'alphabetical' ? [asc(vocabularies.lemma)] : [rank, asc(vocabularies.lemma)]))
    .limit(opts.limit ?? 200)

  return rows.map((row) => ({
    id: row.id,
    lemma: row.lemma,
    partOfSpeech: row.partOfSpeech,
    level: row.level,
    translation: row.translation,
    brainMapStatus:
      row.status === 'approved' ? 'approved' : row.status ? 'draft' : 'none',
    bookmarked: false,
  }))
}

/** Brain Map state for a set of words, keyed by vocabulary id. */
export async function brainMapStates(
  vocabularyIds: string[],
  db: Db = defaultDb,
): Promise<Map<string, BrainMapState>> {
  if (!vocabularyIds.length) return new Map()
  const rows = await db
    .select({ vocabularyId: brainMaps.vocabularyId, status: brainMaps.status })
    .from(brainMaps)
    .where(inArray(brainMaps.vocabularyId, vocabularyIds))

  const states = new Map<string, BrainMapState>()
  for (const id of vocabularyIds) states.set(id, 'none')
  for (const row of rows) {
    states.set(row.vocabularyId, row.status === 'approved' ? 'approved' : 'draft')
  }
  return states
}
