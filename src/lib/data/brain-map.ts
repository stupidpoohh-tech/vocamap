import { and, asc, desc, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  aiGenerationJobs,
  brainMapCollocations,
  brainMapMeanings,
  brainMapRevisions,
  brainMapSentences,
  brainMapSimilarWords,
  brainMapWordFamily,
  brainMaps,
  vocabularies,
  wordPairQuestions,
  wordPairs,
} from '@/lib/db/schema'
import {
  BRAIN_MAP_SYSTEM,
  PROMPT_VERSION,
  type BrainMapDraft,
  brainMapDraftSchema,
  brainMapPrompt,
  draftQualityNotes,
  getLLMProvider,
  validateDraftConsistency,
} from '@/lib/ai'
import { addTranslations, normaliseLemma } from './vocabulary'
import { ConflictError, NotFoundError } from './errors'

export type MasterBrainMap = {
  id: string
  vocabularyId: string
  lemma: string
  partOfSpeech: string | null
  status: 'draft_ai' | 'needs_review' | 'approved' | 'rejected'
  version: number
  meaningCoreKo: string | null
  meaningCoreEn: string | null
  meanings: Array<{
    id: string
    ko: string
    enDefinition: string | null
    enDefinitionKo: string | null
    connectionNote: string | null
    exampleChunk: string | null
  }>
  sentences: Array<{
    id: string
    text: string
    ko: string
    targetMeaning: string | null
    highlight: string | null
    difficulty: number | null
  }>
  collocations: Array<{
    id: string
    expression: string
    ko: string
    exampleSentence: string | null
    importance: number
  }>
  wordFamily: Array<{
    id: string
    lemma: string
    partOfSpeech: string
    ko: string
    exampleSentence: string | null
  }>
  similarWords: Array<{
    pairId: string
    otherLemma: string
    coreDifference: string
    usageRule: string | null
    questions: Array<{ id: string; prompt: string; answer: string; explanation: string }>
  }>
}

/**
 * The English definitions of the other words a student is learning alongside
 * this one.
 *
 * Wrong answers for the meaning node's fallback question. A word whose list
 * gave a definition but no translation of it has nothing to reveal, so it is
 * asked instead — and a question needs rivals, which have to come from outside
 * the word.
 *
 * Words the teacher put in the same set come first: those are the words that
 * turn up together on the paper. The rest of the library fills in behind them.
 */
export async function listRivalDefinitions(
  vocabularyId: string,
  limit = 12,
  db: Db = defaultDb,
): Promise<string[]> {
  const sharesASet = sql<boolean>`${brainMaps.vocabularyId} in (
    select shared.vocabulary_id
    from vocabulary_set_items shared
    where shared.set_id in (
      select mine.set_id from vocabulary_set_items mine
      where mine.vocabulary_id = ${vocabularyId}
    )
  )`

  const rows = await db
    .select({ definition: brainMapMeanings.enDefinition, near: sharesASet })
    .from(brainMapMeanings)
    .innerJoin(brainMaps, eq(brainMaps.id, brainMapMeanings.brainMapId))
    .where(
      and(
        eq(brainMaps.status, 'approved'),
        isNotNull(brainMapMeanings.enDefinition),
        ne(brainMaps.vocabularyId, vocabularyId),
      ),
    )
    .orderBy(desc(sharesASet))
    .limit(limit)

  return [...new Set(rows.map((row) => row.definition).filter((d): d is string => Boolean(d)))]
}

/**
 * Reads the shared master map. `approvedOnly` is the student-facing default:
 * students never see unreviewed AI output.
 */
export async function getMasterBrainMap(
  vocabularyId: string,
  opts: { approvedOnly?: boolean } = {},
  db: Db = defaultDb,
): Promise<MasterBrainMap | null> {
  // Every read here is keyed on the word, not on the map's id, so they all
  // leave together. Waiting for the head first and then asking for its parts
  // was a second round trip for a fact the unique index already fixes: a
  // vocabulary has at most one map.
  const ofThisWord = () =>
    db.select({ id: brainMaps.id }).from(brainMaps).where(eq(brainMaps.vocabularyId, vocabularyId))

  const [heads, meanings, sentences, collocations, family, similarLinks, allQuestions] =
    await Promise.all([
      db
        .select({
          id: brainMaps.id,
          vocabularyId: brainMaps.vocabularyId,
          lemma: vocabularies.lemma,
          partOfSpeech: vocabularies.partOfSpeech,
          status: brainMaps.status,
          version: brainMaps.version,
          meaningCoreKo: brainMaps.meaningCoreKo,
          meaningCoreEn: brainMaps.meaningCoreEn,
        })
        .from(brainMaps)
        .innerJoin(vocabularies, eq(vocabularies.id, brainMaps.vocabularyId))
        .where(eq(brainMaps.vocabularyId, vocabularyId))
        .limit(1),
      db
        .select()
        .from(brainMapMeanings)
        .where(inArray(brainMapMeanings.brainMapId, ofThisWord()))
        .orderBy(asc(brainMapMeanings.sortOrder)),
      db
        .select()
        .from(brainMapSentences)
        .where(inArray(brainMapSentences.brainMapId, ofThisWord()))
        .orderBy(asc(brainMapSentences.sortOrder)),
      db
        .select()
        .from(brainMapCollocations)
        .where(inArray(brainMapCollocations.brainMapId, ofThisWord()))
        .orderBy(asc(brainMapCollocations.importance), asc(brainMapCollocations.sortOrder)),
      db
        .select()
        .from(brainMapWordFamily)
        .where(inArray(brainMapWordFamily.brainMapId, ofThisWord()))
        .orderBy(asc(brainMapWordFamily.sortOrder)),
      db
        .select({
          pairId: wordPairs.id,
          lemmaA: wordPairs.lemmaA,
          lemmaB: wordPairs.lemmaB,
          coreDifference: wordPairs.coreDifference,
          usageRule: wordPairs.usageRule,
          status: wordPairs.status,
          sortOrder: brainMapSimilarWords.sortOrder,
        })
        .from(brainMapSimilarWords)
        .innerJoin(wordPairs, eq(wordPairs.id, brainMapSimilarWords.pairId))
        .where(inArray(brainMapSimilarWords.brainMapId, ofThisWord()))
        .orderBy(asc(brainMapSimilarWords.sortOrder)),
      // Reached through the map rather than through the pair ids, so it travels
      // with the rest instead of waiting a round trip for them to be named.
      db
        .select({
          id: wordPairQuestions.id,
          pairId: wordPairQuestions.pairId,
          prompt: wordPairQuestions.prompt,
          answer: wordPairQuestions.answer,
          explanation: wordPairQuestions.explanation,
          sortOrder: wordPairQuestions.sortOrder,
        })
        .from(wordPairQuestions)
        .innerJoin(brainMapSimilarWords, eq(brainMapSimilarWords.pairId, wordPairQuestions.pairId))
        .where(inArray(brainMapSimilarWords.brainMapId, ofThisWord()))
        .orderBy(asc(wordPairQuestions.sortOrder)),
    ])

  const head = heads[0]
  if (!head) return null
  if (opts.approvedOnly && head.status !== 'approved') return null

  const visiblePairs = opts.approvedOnly
    ? similarLinks.filter((p) => p.status === 'approved')
    : similarLinks

  const visibleIds = new Set(visiblePairs.map((p) => p.pairId))
  const questions = allQuestions.filter((q) => visibleIds.has(q.pairId))

  const target = normaliseLemma(head.lemma)

  return {
    ...head,
    meanings: meanings.map((m) => ({
      id: m.id,
      ko: m.ko,
      enDefinition: m.enDefinition,
      enDefinitionKo: m.enDefinitionKo,
      connectionNote: m.connectionNote,
      exampleChunk: m.exampleChunk,
    })),
    sentences: sentences.map((s) => ({
      id: s.id,
      text: s.text,
      ko: s.ko,
      targetMeaning: s.targetMeaning,
      highlight: s.highlight,
      difficulty: s.difficulty,
    })),
    collocations: collocations.map((c) => ({
      id: c.id,
      expression: c.expression,
      ko: c.ko,
      exampleSentence: c.exampleSentence,
      importance: c.importance,
    })),
    wordFamily: family.map((f) => ({
      id: f.id,
      lemma: f.lemma,
      partOfSpeech: f.partOfSpeech,
      ko: f.ko,
      exampleSentence: f.exampleSentence,
    })),
    similarWords: visiblePairs.map((p) => ({
      pairId: p.pairId,
      // The pair is stored symmetrically; show the student the *other* word.
      otherLemma: normaliseLemma(p.lemmaA) === target ? p.lemmaB : p.lemmaA,
      coreDifference: p.coreDifference,
      usageRule: p.usageRule,
      questions: questions
        .filter((q) => q.pairId === p.pairId)
        .map((q) => ({ id: q.id, prompt: q.prompt, answer: q.answer, explanation: q.explanation })),
    })),
  }
}

/* ───────────────────────────── generation ───────────────────────────── */

/**
 * How long a generation may run before another request may take the word back.
 * A real call finishes in well under a minute; anything past this is wreckage.
 */
export const STALE_JOB_MS = 3 * 60 * 1000

export type EnsureResult =
  | { outcome: 'reused'; brainMapId: string }
  | { outcome: 'generated'; brainMapId: string; jobId: string }
  | { outcome: 'in_progress'; jobId: string }

/**
 * Reuse-or-generate. This is the function that keeps the knowledge base shared:
 * a word already carrying a map is never sent to the LLM again, and two
 * simultaneous requests for the same new word produce one generation, not two —
 * the partial unique index on `ai_generation_jobs` is the lock.
 */
export async function ensureBrainMap(
  vocabularyId: string,
  opts: { requestedBy?: string | null; force?: boolean } = {},
  db: Db = defaultDb,
): Promise<EnsureResult> {
  const [existing] = await db
    .select({ id: brainMaps.id })
    .from(brainMaps)
    .where(eq(brainMaps.vocabularyId, vocabularyId))
    .limit(1)

  if (existing && !opts.force) return { outcome: 'reused', brainMapId: existing.id }

  const [vocab] = await db
    .select()
    .from(vocabularies)
    .where(eq(vocabularies.id, vocabularyId))
    .limit(1)
  if (!vocab) throw new NotFoundError(`Vocabulary ${vocabularyId} not found`)

  // A Worker that dies mid-generation — CPU limit, eviction, a deploy — leaves
  // its job row at `running` forever. The partial unique index then refuses
  // every later attempt on this word, and the caller just sees `in_progress`
  // with nothing happening. Nothing else ever clears these, so reclaim them
  // here: a generation that has not finished in STALE_JOB_MS is not going to.
  await db
    .update(aiGenerationJobs)
    .set({
      status: 'failed',
      error: 'Abandoned: no result before the reclaim window elapsed.',
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(aiGenerationJobs.vocabularyId, vocabularyId),
        eq(aiGenerationJobs.kind, 'brain_map'),
        inArray(aiGenerationJobs.status, ['pending', 'running']),
        lt(aiGenerationJobs.createdAt, new Date(Date.now() - STALE_JOB_MS)),
      ),
    )

  const claimed = await db
    .insert(aiGenerationJobs)
    .values({
      vocabularyId,
      kind: 'brain_map',
      status: 'running',
      promptVersion: PROMPT_VERSION,
      requestedBy: opts.requestedBy ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: aiGenerationJobs.id })

  const job = claimed[0]
  if (!job) {
    const [inflight] = await db
      .select({ id: aiGenerationJobs.id })
      .from(aiGenerationJobs)
      .where(
        and(
          eq(aiGenerationJobs.vocabularyId, vocabularyId),
          eq(aiGenerationJobs.kind, 'brain_map'),
          inArray(aiGenerationJobs.status, ['pending', 'running']),
        ),
      )
      .limit(1)
    if (!inflight) throw new ConflictError('Generation job could not be claimed')
    return { outcome: 'in_progress', jobId: inflight.id }
  }

  const provider = getLLMProvider()
  try {
    const result = await provider.generateStructured<BrainMapDraft>({
      system: BRAIN_MAP_SYSTEM,
      prompt: brainMapPrompt({
        lemma: vocab.lemma,
        partOfSpeech: vocab.partOfSpeech,
        level: vocab.level,
      }),
      schema: brainMapDraftSchema,
      schemaName: 'brain_map',
      maxTokens: 6000,
    })

    const problems = validateDraftConsistency(result.data)
    if (problems.length) {
      throw new Error(`Draft failed consistency checks: ${problems.join('; ')}`)
    }

    const brainMapId = await writeDraft(
      vocabularyId,
      result.data,
      {
        model: result.model,
        createdBy: opts.requestedBy ?? null,
        // Quality notes ride along for the curator rather than rejecting a draft
        // that already cost money to produce.
        reviewNote: draftQualityNotes(result.data).join('\n') || null,
      },
      db,
    )

    await db
      .update(aiGenerationJobs)
      .set({
        status: 'succeeded',
        provider: result.provider,
        model: result.model,
        rawResponse: result.raw,
        finishedAt: new Date(),
      })
      .where(eq(aiGenerationJobs.id, job.id))

    return { outcome: 'generated', brainMapId, jobId: job.id }
  } catch (error) {
    await db
      .update(aiGenerationJobs)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .where(eq(aiGenerationJobs.id, job.id))
    throw error
  }
}

/**
 * Writes a map for a word that has none, and does nothing at all for a word
 * that has one.
 *
 * This exists because `writeDraft` is a replacement. It is the right function
 * behind a curator pressing "regenerate" — they are looking at the map and
 * asking for a new one. It was also what bulk import called for every word it
 * touched, including words it had merely found again, which made pasting a
 * vocabulary list a way to delete an approved public map: the head row was
 * updated in place, its version bumped, its approval reset, and every child row
 * dropped and rebuilt with new ids.
 *
 * The guard is the unique index on `brain_maps.vocabulary_id`, not a look
 * first. Two imports of the same new word run at the same time under a
 * connection pool: both would see no map, both would decide to write one, and
 * `writeDraft`'s upsert would let the second overwrite the first. Here the
 * insert is the test — the loser's `on conflict do nothing` returns no row, and
 * it stops before touching a single child table.
 *
 * Returns `created: false` when a map was already there. The caller reports
 * that to the person importing rather than merging anything: the existing map
 * has been reviewed and studied against, and a second opinion typed into a
 * paste box is not grounds for replacing it.
 */
export async function createMapIfAbsent(
  vocabularyId: string,
  draft: BrainMapDraft,
  meta: {
    model?: string | null
    createdBy?: string | null
    status?: 'draft_ai' | 'approved'
    reviewNote?: string | null
  } = {},
  db: Db = defaultDb,
): Promise<{ created: boolean; brainMapId: string | null }> {
  const [vocab] = await db
    .select()
    .from(vocabularies)
    .where(eq(vocabularies.id, vocabularyId))
    .limit(1)
  if (!vocab) throw new NotFoundError(`Vocabulary ${vocabularyId} not found`)

  return db.transaction(async (tx) => {
    const [head] = await tx
      .insert(brainMaps)
      .values({
        vocabularyId,
        status: meta.status ?? 'draft_ai',
        meaningCoreKo: draft.meaningCoreKo,
        meaningCoreEn: draft.meaningCoreEn,
        generatedByModel: meta.model ?? null,
        promptVersion: PROMPT_VERSION,
        reviewNote: meta.reviewNote ?? null,
        createdBy: meta.createdBy ?? null,
      })
      .onConflictDoNothing({ target: brainMaps.vocabularyId })
      .returning({ id: brainMaps.id, version: brainMaps.version })

    // Somebody else owns this word's map. Nothing below this line runs, which
    // is the whole guarantee: no delete, no translation, no revision row.
    if (!head) return { created: false, brainMapId: null }

    await writeDraftBody(head.id, vocabularyId, vocab.lemma, draft, head.version, meta, tx)
    return { created: true, brainMapId: head.id }
  })
}

/**
 * Persists a validated draft as `draft_ai`, replacing the previous body but
 * keeping the row identity — so `brain_map_node_progress` and `review_events`,
 * which reference the vocabulary rather than the content, survive untouched.
 */
export async function writeDraft(
  vocabularyId: string,
  draft: BrainMapDraft,
  meta: {
    model?: string | null
    createdBy?: string | null
    status?: 'draft_ai' | 'approved'
    reviewNote?: string | null
  } = {},
  db: Db = defaultDb,
): Promise<string> {
  const [vocab] = await db
    .select()
    .from(vocabularies)
    .where(eq(vocabularies.id, vocabularyId))
    .limit(1)
  if (!vocab) throw new NotFoundError(`Vocabulary ${vocabularyId} not found`)

  return db.transaction(async (tx) => {
    const [head] = await tx
      .insert(brainMaps)
      .values({
        vocabularyId,
        status: meta.status ?? 'draft_ai',
        meaningCoreKo: draft.meaningCoreKo,
        meaningCoreEn: draft.meaningCoreEn,
        generatedByModel: meta.model ?? null,
        promptVersion: PROMPT_VERSION,
        reviewNote: meta.reviewNote ?? null,
        createdBy: meta.createdBy ?? null,
      })
      .onConflictDoUpdate({
        target: brainMaps.vocabularyId,
        set: {
          status: meta.status ?? 'draft_ai',
          version: sql`${brainMaps.version} + 1`,
          meaningCoreKo: draft.meaningCoreKo,
          meaningCoreEn: draft.meaningCoreEn,
          generatedByModel: meta.model ?? null,
          promptVersion: PROMPT_VERSION,
          reviewNote: meta.reviewNote ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: brainMaps.id, version: brainMaps.version })

    if (!head) throw new Error('Failed to write brain map head')

    await writeDraftBody(head.id, vocabularyId, vocab.lemma, draft, head.version, meta, tx)
    return head.id
  })
}

/**
 * The children of a map: senses, sentences, collocations, derived forms, pairs,
 * the word's translations, and the revision row that records what was written.
 *
 * Shared by the two ways a map gets a body — `writeDraft`, which replaces one,
 * and `createMapIfAbsent`, which only ever fills a new one. Splitting it out
 * keeps those two from drifting apart, and makes it obvious that the delete at
 * the top belongs to replacement: on a freshly inserted head it matches
 * nothing.
 */
async function writeDraftBody(
  id: string,
  vocabularyId: string,
  lemma: string,
  draft: BrainMapDraft,
  version: number,
  meta: { model?: string | null; createdBy?: string | null; status?: 'draft_ai' | 'approved' },
  tx: Db,
): Promise<void> {
  await Promise.all([
    tx.delete(brainMapMeanings).where(eq(brainMapMeanings.brainMapId, id)),
    tx.delete(brainMapSentences).where(eq(brainMapSentences.brainMapId, id)),
    tx.delete(brainMapCollocations).where(eq(brainMapCollocations.brainMapId, id)),
    tx.delete(brainMapWordFamily).where(eq(brainMapWordFamily.brainMapId, id)),
    tx.delete(brainMapSimilarWords).where(eq(brainMapSimilarWords.brainMapId, id)),
  ])

  if (draft.meanings.length) {
    await tx.insert(brainMapMeanings).values(
      draft.meanings.map((m, i) => ({
        brainMapId: id,
        ko: m.ko,
        enDefinition: m.enDefinition,
        enDefinitionKo: m.enDefinitionKo ?? null,
        connectionNote: m.connectionNote,
        exampleChunk: m.exampleChunk,
        sortOrder: i,
      })),
    )
  }
  if (draft.sentences.length) {
    await tx.insert(brainMapSentences).values(
      draft.sentences.map((s, i) => ({
        brainMapId: id,
        text: s.text,
        ko: s.ko,
        targetMeaning: s.targetMeaning,
        highlight: s.highlight,
        difficulty: s.difficulty,
        sortOrder: i,
      })),
    )
  }
  if (draft.collocations.length) {
    await tx.insert(brainMapCollocations).values(
      draft.collocations.map((c, i) => ({
        brainMapId: id,
        expression: c.expression,
        ko: c.ko,
        exampleSentence: c.exampleSentence,
        importance: c.importance,
        sortOrder: i,
      })),
    )
  }
  if (draft.wordFamily.length) {
    await tx.insert(brainMapWordFamily).values(
      draft.wordFamily.map((f, i) => ({
        brainMapId: id,
        lemma: f.lemma,
        partOfSpeech: f.partOfSpeech,
        ko: f.ko,
        exampleSentence: f.exampleSentence,
        sortOrder: i,
      })),
    )
  }

  for (const [i, similar] of draft.similarWords.entries()) {
    const pairId = await upsertWordPair(
      {
        lemmaA: lemma,
        lemmaB: similar.lemma,
        coreDifference: similar.coreDifference,
        usageRule: similar.usageRule,
        status: meta.status ?? 'draft_ai',
        model: meta.model ?? null,
        questions: similar.questions,
      },
      tx,
    )
    await tx
      .insert(brainMapSimilarWords)
      .values({ brainMapId: id, pairId, sortOrder: i })
      .onConflictDoNothing()
  }

  if (draft.primaryTranslations.length) {
    await addTranslations(vocabularyId, draft.primaryTranslations, tx)
  }

  await tx.insert(brainMapRevisions).values({
    brainMapId: id,
    version,
    changeKind: meta.status === 'approved' ? 'seed' : 'ai_generated',
    changedBy: meta.createdBy ?? null,
    snapshot: draft,
  })
}

/**
 * Pairs are global and symmetric. Ordering the lemmas before writing makes
 * "maintain vs keep" and "keep vs maintain" the same row, so both words' maps
 * point at one definition of the difference and one set of battle questions.
 */
export async function upsertWordPair(
  input: {
    lemmaA: string
    lemmaB: string
    coreDifference: string
    usageRule?: string | null
    status?: 'draft_ai' | 'approved'
    model?: string | null
    questions: Array<{ prompt: string; answer: string; explanation: string }>
  },
  db: Db = defaultDb,
): Promise<string> {
  const [a, b] = [normaliseLemma(input.lemmaA), normaliseLemma(input.lemmaB)].sort() as [
    string,
    string,
  ]

  const [pair] = await db
    .insert(wordPairs)
    .values({
      lemmaA: a,
      lemmaB: b,
      coreDifference: input.coreDifference,
      usageRule: input.usageRule ?? null,
      status: input.status ?? 'draft_ai',
      generatedByModel: input.model ?? null,
    })
    .onConflictDoUpdate({
      target: [wordPairs.lemmaA, wordPairs.lemmaB],
      set: {
        coreDifference: input.coreDifference,
        usageRule: input.usageRule ?? null,
        version: sql`${wordPairs.version} + 1`,
      },
    })
    .returning({ id: wordPairs.id })

  if (!pair) throw new Error('Failed to upsert word pair')

  await db.delete(wordPairQuestions).where(eq(wordPairQuestions.pairId, pair.id))
  if (input.questions.length) {
    await db.insert(wordPairQuestions).values(
      input.questions.map((q, i) => ({
        pairId: pair.id,
        prompt: q.prompt,
        answer: q.answer,
        explanation: q.explanation,
        sortOrder: i,
      })),
    )
  }
  return pair.id
}

/* ───────────────────────────── curation ───────────────────────────── */

export async function listReviewQueue(limit = 50, db: Db = defaultDb) {
  return db
    .select({
      brainMapId: brainMaps.id,
      vocabularyId: brainMaps.vocabularyId,
      lemma: vocabularies.lemma,
      status: brainMaps.status,
      version: brainMaps.version,
      model: brainMaps.generatedByModel,
      createdAt: brainMaps.createdAt,
    })
    .from(brainMaps)
    .innerJoin(vocabularies, eq(vocabularies.id, brainMaps.vocabularyId))
    .where(inArray(brainMaps.status, ['draft_ai', 'needs_review']))
    .orderBy(asc(brainMaps.createdAt))
    .limit(limit)
}

export async function setBrainMapStatus(
  brainMapId: string,
  status: 'approved' | 'rejected' | 'needs_review',
  actorId: string,
  note: string | null = null,
  db: Db = defaultDb,
): Promise<void> {
  const [row] = await db
    .update(brainMaps)
    .set({
      status,
      reviewNote: note,
      approvedBy: status === 'approved' ? actorId : null,
      approvedAt: status === 'approved' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(brainMaps.id, brainMapId))
    .returning({
      id: brainMaps.id,
      version: brainMaps.version,
      vocabularyId: brainMaps.vocabularyId,
    })

  if (!row) throw new NotFoundError('Brain map not found')

  // Approving a map approves the pairs it teaches, otherwise the Similar Words
  // node would render empty for students.
  if (status === 'approved') {
    const links = await db
      .select({ pairId: brainMapSimilarWords.pairId })
      .from(brainMapSimilarWords)
      .where(eq(brainMapSimilarWords.brainMapId, brainMapId))
    if (links.length) {
      await db
        .update(wordPairs)
        .set({ status: 'approved', approvedBy: actorId, approvedAt: new Date() })
        .where(
          inArray(
            wordPairs.id,
            links.map((l) => l.pairId),
          ),
        )
    }
  }

  await db
    .insert(brainMapRevisions)
    .values({
      brainMapId,
      version: row.version,
      changeKind: `status:${status}`,
      changedBy: actorId,
      snapshot: { status, note },
    })
    .onConflictDoNothing()
}

/**
 * Whether a question built from this word's map still describes it.
 *
 * A token remembers the map's version at the moment the question went out. If
 * the map has been edited, re-approved, unapproved or deleted since, the
 * remembered answer is about text that no longer exists, and grading against it
 * would write a verdict on content nobody can look up. The answer is refused
 * instead — the reader is told the question went stale, not that they were
 * wrong.
 *
 * `itemId` is checked the same way: an item a curator deleted takes its
 * questions with it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function questionStillStands(
  input: { vocabularyId: string; version: number | null; itemId?: string | null },
  db: Db = defaultDb,
): Promise<boolean> {
  const [head] = await db
    .select({ id: brainMaps.id, version: brainMaps.version, status: brainMaps.status })
    .from(brainMaps)
    .where(eq(brainMaps.vocabularyId, input.vocabularyId))
    .limit(1)

  if (!head) return false
  if (head.status !== 'approved') return false
  if (input.version !== null && head.version !== input.version) return false
  if (!input.itemId) return true

  // The core-meaning node has no row of its own: its id is derived from the map
  // head (`core:<mapId>`), which the version check above has already settled.
  // Looking it up in the item tables would find nothing and refuse every answer
  // to the one card every mapped word has.
  if (!UUID.test(input.itemId)) return true

  // The item can be any of the four kinds of row a map holds, so all four are
  // asked at once rather than the caller having to say which it was.
  const [meaning, sentence, collocation, family] = await Promise.all([
    db.select({ id: brainMapMeanings.id }).from(brainMapMeanings).where(eq(brainMapMeanings.id, input.itemId)).limit(1),
    db.select({ id: brainMapSentences.id }).from(brainMapSentences).where(eq(brainMapSentences.id, input.itemId)).limit(1),
    db.select({ id: brainMapCollocations.id }).from(brainMapCollocations).where(eq(brainMapCollocations.id, input.itemId)).limit(1),
    db.select({ id: brainMapWordFamily.id }).from(brainMapWordFamily).where(eq(brainMapWordFamily.id, input.itemId)).limit(1),
  ])
  return Boolean(meaning[0] ?? sentence[0] ?? collocation[0] ?? family[0])
}
