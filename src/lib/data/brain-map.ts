import { and, asc, eq, inArray, sql } from 'drizzle-orm'
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
  meanings: Array<{ id: string; ko: string; enDefinition: string | null; connectionNote: string | null; exampleChunk: string | null }>
  sentences: Array<{ id: string; text: string; ko: string; targetMeaning: string | null; highlight: string | null; difficulty: number | null }>
  collocations: Array<{ id: string; expression: string; ko: string; exampleSentence: string | null; importance: number }>
  wordFamily: Array<{ id: string; lemma: string; partOfSpeech: string; ko: string; exampleSentence: string | null }>
  similarWords: Array<{
    pairId: string
    otherLemma: string
    coreDifference: string
    usageRule: string | null
    questions: Array<{ id: string; prompt: string; answer: string; explanation: string }>
  }>
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
  const [head] = await db
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
    .limit(1)

  if (!head) return null
  if (opts.approvedOnly && head.status !== 'approved') return null

  const [meanings, sentences, collocations, family, similarLinks] = await Promise.all([
    db.select().from(brainMapMeanings).where(eq(brainMapMeanings.brainMapId, head.id)).orderBy(asc(brainMapMeanings.sortOrder)),
    db.select().from(brainMapSentences).where(eq(brainMapSentences.brainMapId, head.id)).orderBy(asc(brainMapSentences.sortOrder)),
    db.select().from(brainMapCollocations).where(eq(brainMapCollocations.brainMapId, head.id)).orderBy(asc(brainMapCollocations.importance), asc(brainMapCollocations.sortOrder)),
    db.select().from(brainMapWordFamily).where(eq(brainMapWordFamily.brainMapId, head.id)).orderBy(asc(brainMapWordFamily.sortOrder)),
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
      .where(eq(brainMapSimilarWords.brainMapId, head.id))
      .orderBy(asc(brainMapSimilarWords.sortOrder)),
  ])

  const visiblePairs = opts.approvedOnly
    ? similarLinks.filter((p) => p.status === 'approved')
    : similarLinks

  const questions = visiblePairs.length
    ? await db
        .select()
        .from(wordPairQuestions)
        .where(inArray(wordPairQuestions.pairId, visiblePairs.map((p) => p.pairId)))
        .orderBy(asc(wordPairQuestions.sortOrder))
    : []

  const target = normaliseLemma(head.lemma)

  return {
    ...head,
    meanings: meanings.map((m) => ({
      id: m.id,
      ko: m.ko,
      enDefinition: m.enDefinition,
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

    const brainMapId = await writeDraft(vocabularyId, result.data, {
      model: result.model,
      createdBy: opts.requestedBy ?? null,
    }, db)

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
 * Persists a validated draft as `draft_ai`, replacing the previous body but
 * keeping the row identity — so `brain_map_node_progress` and `review_events`,
 * which reference the vocabulary rather than the content, survive untouched.
 */
export async function writeDraft(
  vocabularyId: string,
  draft: BrainMapDraft,
  meta: { model?: string | null; createdBy?: string | null; status?: 'draft_ai' | 'approved' } = {},
  db: Db = defaultDb,
): Promise<string> {
  const [vocab] = await db.select().from(vocabularies).where(eq(vocabularies.id, vocabularyId)).limit(1)
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
          updatedAt: new Date(),
        },
      })
      .returning({ id: brainMaps.id, version: brainMaps.version })

    if (!head) throw new Error('Failed to write brain map head')
    const id = head.id

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
          lemmaA: vocab.lemma,
          lemmaB: similar.lemma,
          coreDifference: similar.coreDifference,
          usageRule: similar.usageRule,
          status: meta.status ?? 'draft_ai',
          model: meta.model ?? null,
          questions: similar.questions,
        },
        tx as unknown as Db,
      )
      await tx
        .insert(brainMapSimilarWords)
        .values({ brainMapId: id, pairId, sortOrder: i })
        .onConflictDoNothing()
    }

    if (draft.primaryTranslations.length) {
      await addTranslations(vocabularyId, draft.primaryTranslations, tx as unknown as Db)
    }

    await tx.insert(brainMapRevisions).values({
      brainMapId: id,
      version: head.version,
      changeKind: meta.status === 'approved' ? 'seed' : 'ai_generated',
      changedBy: meta.createdBy ?? null,
      snapshot: draft,
    })

    return id
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
  const [a, b] = [normaliseLemma(input.lemmaA), normaliseLemma(input.lemmaB)].sort() as [string, string]

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
    .returning({ id: brainMaps.id, version: brainMaps.version, vocabularyId: brainMaps.vocabularyId })

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
        .where(inArray(wordPairs.id, links.map((l) => l.pairId)))
    }
  }

  await db.insert(brainMapRevisions).values({
    brainMapId,
    version: row.version,
    changeKind: `status:${status}`,
    changedBy: actorId,
    snapshot: { status, note },
  }).onConflictDoNothing()
}
