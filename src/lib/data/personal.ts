import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  brainMapNodeProgress,
  userVocabularyCards,
  userVocabularyState,
  vocabularies,
  vocabularyTranslations,
} from '@/lib/db/schema'
import { NODE_TYPES, type NodeStatus, type NodeType } from '@/lib/learning/nodes'
import {
  classifyWord,
  deriveNodeStatus,
  type Recommendation,
  type WordSignals,
} from '@/lib/learning/brain-map-policy'
import {
  type Direction,
  estimatedRetention,
  retentionBand,
  type RetentionBand,
} from '@/lib/learning/scheduler'
import { getMasterBrainMap, type MasterBrainMap } from './brain-map'
import { collectWordState, isOutstandingRecommendation, type WordStateRead } from './study'

export type DirectionState = {
  direction: Direction
  reps: number
  lapses: number
  dueAt: Date | null
  retention: number
  band: RetentionBand
}

/**
 * HOW THIS STUDENT KNOWS THE WORD.
 *
 * Deliberately a separate read from `getMasterBrainMap`: the master content is
 * shared and cacheable, this is per student and never is. They are joined only
 * at the point of rendering.
 */
export type PersonalBrainMap = {
  vocabularyId: string
  lemma: string
  translation: string | null
  isImportant: boolean
  recommendedAt: Date | null
  openedAt: Date | null
  directions: DirectionState[]
  nodes: Array<{ node: NodeType; status: NodeStatus; attempts: number; correct: number }>
  recommendation: Recommendation
}

export async function getPersonalBrainMap(
  userId: string,
  vocabularyId: string,
  opts: { state?: WordStateRead } = {},
  db: Db = defaultDb,
): Promise<PersonalBrainMap | null> {
  const [vocab] = await db
    .select({ id: vocabularies.id, lemma: vocabularies.lemma })
    .from(vocabularies)
    .where(eq(vocabularies.id, vocabularyId))
    .limit(1)
  if (!vocab) return null

  // Cards and per-word state come from the shared read rather than being
  // fetched again here: they are the same rows `collectWordState` already
  // loaded, and reading them twice is what made this page's round trips double.
  const [translations, progress, wordState] = await Promise.all([
    db
      .select({ text: vocabularyTranslations.text, isPrimary: vocabularyTranslations.isPrimary })
      .from(vocabularyTranslations)
      .where(eq(vocabularyTranslations.vocabularyId, vocabularyId))
      .orderBy(desc(vocabularyTranslations.isPrimary), vocabularyTranslations.sortOrder),
    db
      .select()
      .from(brainMapNodeProgress)
      .where(
        and(
          eq(brainMapNodeProgress.userId, userId),
          eq(brainMapNodeProgress.vocabularyId, vocabularyId),
        ),
      ),
    opts.state ?? collectWordState(userId, vocabularyId, db),
  ])

  const cards = wordState.cards
  const state = wordState.state ? [wordState.state] : []
  const signals = wordState.signals

  const now = new Date()
  const directions: DirectionState[] = (['en_ko', 'ko_en'] as Direction[]).map((direction) => {
    const card = cards.find((c) => c.direction === direction)
    if (!card) {
      return { direction, reps: 0, lapses: 0, dueAt: null, retention: 0, band: 'at_risk' as const }
    }
    const retention = estimatedRetention(
      {
        stability: card.stability,
        difficulty: card.difficulty,
        fsrsState: card.fsrsState,
        dueAt: card.dueAt,
        lastReviewedAt: card.lastReviewedAt,
        elapsedDays: card.elapsedDays,
        scheduledDays: card.scheduledDays,
        learningSteps: card.learningSteps,
        reps: card.reps,
        lapses: card.lapses,
        consecutiveCorrect: card.consecutiveCorrect,
      },
      now,
    )
    return {
      direction,
      reps: card.reps,
      lapses: card.lapses,
      dueAt: card.dueAt,
      retention,
      band: retentionBand(retention),
    }
  })

  return {
    vocabularyId,
    lemma: vocab.lemma,
    translation: translations[0]?.text ?? null,
    isImportant: state[0]?.isImportant ?? false,
    recommendedAt: state[0]?.brainMapRecommendedAt ?? null,
    openedAt: state[0]?.brainMapOpenedAt ?? null,
    directions,
    nodes: NODE_TYPES.map((node) => {
      const row = progress.find((p) => p.node === node)
      return {
        node,
        status: row?.status ?? 'available',
        attempts: row?.attempts ?? 0,
        correct: row?.correct ?? 0,
      }
    }),
    recommendation: classifyWord(signals),
  }
}

export type BrainMapView = {
  master: MasterBrainMap | null
  personal: PersonalBrainMap
  /** Node states after reconciling personal progress against available content. */
  nodes: Array<{ node: NodeType; status: NodeStatus; itemCount: number }>
}

/**
 * The word-detail page's single read. A node is `locked` when the master map
 * has nothing to show for it — a student is never invited into an empty node.
 */
export async function getBrainMapView(
  userId: string,
  vocabularyId: string,
  opts: { approvedOnly?: boolean } = {},
  db: Db = defaultDb,
): Promise<BrainMapView | null> {
  const [master, personal] = await Promise.all([
    getMasterBrainMap(vocabularyId, { approvedOnly: opts.approvedOnly ?? true }, db),
    getPersonalBrainMap(userId, vocabularyId, {}, db),
  ])
  if (!personal) return null

  const counts: Record<NodeType, number> = {
    meaning_core: master?.meaningCoreKo ? 1 + master.meanings.length : 0,
    sentences: master?.sentences.length ?? 0,
    similar_words: master?.similarWords.length ?? 0,
    collocations: master?.collocations.length ?? 0,
    word_family: master?.wordFamily.length ?? 0,
  }

  return {
    master,
    personal,
    nodes: NODE_TYPES.map((node) => {
      const p = personal.nodes.find((n) => n.node === node)!
      return {
        node,
        itemCount: counts[node],
        status: deriveNodeStatus({
          attempts: p.attempts,
          correct: p.correct,
          available: counts[node] > 0,
        }),
      }
    }),
  }
}

/**
 * Records that the student opened this word's map. Always overwrites, so the
 * column means "last opened" — `listRecommendedWords` compares it against the
 * recommendation time, and a first-open timestamp from weeks ago would wrongly
 * suppress every future recommendation for the word.
 */
export async function markBrainMapOpened(
  userId: string,
  vocabularyId: string,
  db: Db = defaultDb,
): Promise<void> {
  const now = new Date()
  await db
    .insert(userVocabularyState)
    .values({ userId, vocabularyId, brainMapOpenedAt: now })
    .onConflictDoUpdate({
      target: [userVocabularyState.userId, userVocabularyState.vocabularyId],
      set: { brainMapOpenedAt: now, updatedAt: now },
    })
}

export type RecommendedWord = {
  vocabularyId: string
  lemma: string
  translation: string | null
}

/** Words the system (or a human) has flagged, that the student has not opened yet. */
export async function listRecommendedWords(
  userId: string,
  limit = 10,
  db: Db = defaultDb,
): Promise<RecommendedWord[]> {
  const rows = await db
    .select({
      vocabularyId: userVocabularyState.vocabularyId,
      lemma: vocabularies.lemma,
    })
    .from(userVocabularyState)
    .innerJoin(vocabularies, eq(vocabularies.id, userVocabularyState.vocabularyId))
    .where(and(eq(userVocabularyState.userId, userId), isOutstandingRecommendation()))
    .orderBy(desc(userVocabularyState.brainMapRecommendedAt))
    .limit(limit)

  if (!rows.length) return []

  const translations = await db
    .select({
      vocabularyId: vocabularyTranslations.vocabularyId,
      text: vocabularyTranslations.text,
    })
    .from(vocabularyTranslations)
    .where(
      and(
        inArray(vocabularyTranslations.vocabularyId, rows.map((r) => r.vocabularyId)),
        eq(vocabularyTranslations.isPrimary, true),
      ),
    )

  // No per-word signal read here on purpose. This used to call
  // `collectWordSignals` in a loop — four queries per recommended word, in
  // series — to produce a one-line message that nothing rendered.
  return rows.map((row) => ({
    vocabularyId: row.vocabularyId,
    lemma: row.lemma,
    translation: translations.find((t) => t.vocabularyId === row.vocabularyId)?.text ?? null,
  }))
}
