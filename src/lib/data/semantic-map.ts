import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  brainMaps,
  brainMapSimilarWords,
  userConfusions,
  vocabularyTranslations,
} from '@/lib/db/schema'
import type { NodeType } from '@/lib/learning/nodes'
import {
  collocationExercises,
  confusableExercises,
  forMastery,
  meaningExercises,
  wordFamilyExercises,
  type Exercise,
} from '@/lib/learning/exercises'
import { MAP_NODE_BUDGET, MAP_NODE_TARGET } from '@/lib/ai'
import { getMasterBrainMap, type MasterBrainMap } from './brain-map'
import { collectWordState, type Awaitable, type WordAnswer, type WordStateRead } from './study'
import { listTranslations } from './personal'

/**
 * Turns the shared Brain Map content into a semantic network of the word.
 *
 * The nodes are the things a student has to remember — "raise an issue",
 * "issue vs problem" — not the drawers they are filed in. Categories survive
 * only as a small tag and as the `progressNode` each answer is recorded under,
 * which keeps every existing analytic and the node-level progress table intact.
 */

export type NodeKind =
  | 'coreMeaning'
  | 'secondaryMeaning'
  | 'confusable'
  | 'collocation'
  | 'wordFamily'

export type NodeStatus = 'unseen' | 'learning' | 'needsReview' | 'weak' | 'completed'

/**
 * Re-exported so the components that render a card keep importing the map's
 * own vocabulary. The questions themselves are built in
 * `@/lib/learning/exercises`, which knows nothing about the database.
 */
export type { Exercise }

export type SemanticNode = {
  id: string
  kind: NodeKind
  /** The vocabulary itself. Always the largest text on the card. */
  label: string
  /** Korean gloss or a short gloss line. */
  secondaryLabel: string | null
  /** Tiny tag. Never the main text. */
  eyebrow: string
  importance: number
  relationStrength: number
  status: NodeStatus
  recommended: boolean
  /** Which of the five progress buckets an answer here counts towards. */
  progressNode: NodeType
  /**
   * Whether this node earns a place on the map itself.
   *
   * A curriculum decision, not a layout one, so it is made here rather than in
   * the component: a Brain Map is the few connections that must survive in the
   * student's head, and everything true that does not earn a place costs the
   * ones that did. What misses out is still reachable in the list below the
   * map — nothing a curator wrote becomes unreachable.
   */
  onMap: boolean
  /** Carried into `review_events.payload` so per-item status can be derived. */
  itemId: string
  pairId?: string
  exercises: Exercise[]
}

export type SemanticMap = {
  lemma: string
  partOfSpeech: string | null
  meaningCoreKo: string | null
  status: MasterBrainMap['status']
  brainMapId: string
  nodes: SemanticNode[]
  /** Node the student should start with, if any stands out. */
  recommendedNodeId: string | null
}

const EYEBROW: Record<NodeKind, string> = {
  coreMeaning: '핵심 의미',
  secondaryMeaning: '확장 의미',
  confusable: '자주 헷갈림',
  collocation: '함께 쓰는 표현',
  wordFamily: '파생어',
}

const PROGRESS_NODE: Record<NodeKind, NodeType> = {
  coreMeaning: 'meaning_core',
  secondaryMeaning: 'sentences',
  confusable: 'similar_words',
  collocation: 'collocations',
  wordFamily: 'word_family',
}

export function nodeEyebrow(kind: NodeKind): string {
  return EYEBROW[kind]
}

/* ───────────────────── per-item status from the event log ───────────────────── */

type ItemTally = { attempts: number; correct: number }

/**
 * Attempts per individual item, counted off the answers already in hand.
 *
 * Per-item progress has no table of its own — `brain_map_node_progress` counts
 * whole categories. The event log is append-only and already carries the item
 * id, so the finer picture is derived rather than migrated for. It used to be
 * derived from a second read of the same rows `collectWordState` had just
 * loaded; now that read carries the item id and this only counts.
 */
function itemTallies(events: WordAnswer[]): Map<string, ItemTally> {
  const tallies = new Map<string, ItemTally>()
  for (const row of events) {
    if (!row.itemId) continue
    const tally = tallies.get(row.itemId) ?? { attempts: 0, correct: 0 }
    tally.attempts += 1
    if (row.correct) tally.correct += 1
    tallies.set(row.itemId, tally)
  }
  return tallies
}

function statusFor(tally: ItemTally | undefined): NodeStatus {
  if (!tally || tally.attempts === 0) return 'unseen'
  const accuracy = tally.correct / tally.attempts
  if (accuracy < 0.5) return 'weak'
  if (tally.attempts >= 3 && accuracy >= 0.8) return 'completed'
  if (accuracy < 0.75) return 'needsReview'
  return 'learning'
}

/* ─────────────────────────── building the nodes ─────────────────────────── */

export async function buildSemanticMap(
  userId: string,
  vocabularyId: string,
  /**
   * `state` lets a caller that has already read this student's state for the
   * word hand it over. The word page renders the personal map and the semantic
   * map side by side, and each used to collect the same four reads for itself —
   * eight round trips for one set of numbers.
   */
  opts: {
    approvedOnly?: boolean
    /**
     * A promise is fine, and is what the word page hands over: passing the
     * value would mean the caller had to await it first, and that await is a
     * round trip this page cannot spare.
     */
    state?: Awaitable<WordStateRead>
    /** The same glosses the personal view reads. See `listTranslations`. */
    translations?: Awaitable<Array<{ text: string; isPrimary: boolean }>>
  } = {},
  db: Db = defaultDb,
): Promise<SemanticMap | null> {
  // Everything that depends only on the student and the word starts now,
  // alongside the map itself. Waiting for the map first turned four reads that
  // could have travelled with it into a round trip of their own — and over a
  // pooled connection to a database three hops away, round trips are what this
  // page costs.
  const [master, translations, confusions, wordState] = await Promise.all([
    getMasterBrainMap(vocabularyId, { approvedOnly: opts.approvedOnly ?? true }, db),
    opts.translations ?? listTranslations(vocabularyId, db),
    // Reached through the word rather than through the pair ids, which are
    // only known once the map has landed.
    db
      .select({
        pairId: userConfusions.pairId,
        wrongCount: userConfusions.wrongCount,
        rightCount: userConfusions.rightCount,
      })
      .from(userConfusions)
      .innerJoin(brainMapSimilarWords, eq(brainMapSimilarWords.pairId, userConfusions.pairId))
      .innerJoin(brainMaps, eq(brainMaps.id, brainMapSimilarWords.brainMapId))
      .where(and(eq(userConfusions.userId, userId), eq(brainMaps.vocabularyId, vocabularyId))),
    opts.state ?? collectWordState(userId, vocabularyId, db),
  ])
  if (!master) return null

  const tallies = itemTallies(wordState.events)

  const nodes: SemanticNode[] = []

  // ── core meaning ───────────────────────────────────────────────────────
  // Glosses arrive both as single words and as comma-joined lists, and the
  // same sense often appears in both — split and dedupe or the node reads
  // "문제, 쟁점, 문제".
  const glosses = [
    ...new Set(
      translations
        .flatMap((t) => t.text.split(','))
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ]
  if (glosses.length || master.meaningCoreKo) {
    const label = glosses.slice(0, 2).join(', ') || (master.meanings[0]?.ko ?? master.lemma)
    nodes.push({
      id: `core:${master.id}`,
      kind: 'coreMeaning',
      label,
      secondaryLabel: master.meaningCoreKo,
      eyebrow: EYEBROW.coreMeaning,
      importance: 0.95,
      relationStrength: 1,
      status: statusFor(tallies.get(`core:${master.id}`)),
      recommended: false,
      onMap: false,
      progressNode: 'meaning_core',
      itemId: `core:${master.id}`,
      exercises: meaningExercises({
        label,
        sense: master.meanings[0]?.ko ?? label,
        sentences: master.sentences,
        meaningCoreKo: master.meaningCoreKo,
        connectionNote: master.meanings[0]?.connectionNote,
      }),
    })
  }

  // ── further senses, labelled by the phrase that shows them ─────────────
  master.meanings.slice(1).forEach((meaning, index) => {
    nodes.push({
      id: meaning.id,
      kind: 'secondaryMeaning',
      label: meaning.exampleChunk?.trim() || meaning.ko,
      secondaryLabel: meaning.exampleChunk ? meaning.ko : meaning.enDefinition,
      eyebrow: EYEBROW.secondaryMeaning,
      importance: Math.max(0.3, 0.62 - index * 0.12),
      relationStrength: Math.max(0.35, 0.7 - index * 0.12),
      status: statusFor(tallies.get(meaning.id)),
      recommended: false,
      onMap: false,
      progressNode: 'sentences',
      itemId: meaning.id,
      exercises: meaningExercises({
        label: meaning.ko,
        sense: meaning.ko,
        sentences: master.sentences,
        meaningCoreKo: master.meaningCoreKo,
        connectionNote: meaning.connectionNote,
      }),
    })
  })

  // ── confusable pairs ───────────────────────────────────────────────────
  for (const pair of master.similarWords) {
    const confusion = confusions.find((c) => c.pairId === pair.pairId)
    const wrong = confusion?.wrongCount ?? 0
    const tally = tallies.get(pair.pairId)

    nodes.push({
      id: pair.pairId,
      kind: 'confusable',
      label: `${master.lemma} vs ${pair.otherLemma}`,
      secondaryLabel: '구별',
      eyebrow: EYEBROW.confusable,
      // A pair the student actually mixes up is the most important thing on
      // the map; one they have never met is merely useful.
      importance: wrong >= 2 ? 1 : wrong === 1 ? 0.92 : 0.85,
      relationStrength: 0.95,
      status: wrong >= 2 ? 'weak' : statusFor(tally),
      recommended: false,
      onMap: false,
      progressNode: 'similar_words',
      itemId: pair.pairId,
      pairId: pair.pairId,
      exercises: confusableExercises({ lemma: master.lemma, pair }),
    })
  }

  // ── collocations ───────────────────────────────────────────────────────
  for (const collocation of master.collocations) {
    nodes.push({
      id: collocation.id,
      kind: 'collocation',
      label: collocation.expression,
      secondaryLabel: collocation.ko,
      eyebrow: EYEBROW.collocation,
      importance: collocation.importance === 1 ? 0.82 : collocation.importance === 2 ? 0.66 : 0.52,
      relationStrength: collocation.importance === 1 ? 0.85 : 0.6,
      status: statusFor(tallies.get(collocation.id)),
      recommended: false,
      onMap: false,
      progressNode: 'collocations',
      itemId: collocation.id,
      exercises: collocationExercises({
        lemma: master.lemma,
        collocation,
        siblings: master.collocations,
      }),
    })
  }

  // ── word family ────────────────────────────────────────────────────────
  for (const member of master.wordFamily) {
    nodes.push({
      id: member.id,
      kind: 'wordFamily',
      label: member.lemma,
      secondaryLabel: member.ko,
      eyebrow: EYEBROW.wordFamily,
      importance: 0.44,
      relationStrength: 0.5,
      status: statusFor(tallies.get(member.id)),
      recommended: false,
      onMap: false,
      progressNode: 'word_family',
      itemId: member.id,
      exercises: wordFamilyExercises({ member, family: master.wordFamily }),
    })
  }

  // A student who has already answered a node correctly is not shown the way
  // in again. The status is known only here, where the event log has been
  // read, so the pruning happens here rather than inside the builders.
  for (const node of nodes) {
    if (node.status === 'learning' || node.status === 'completed') {
      node.exercises = forMastery(node.exercises)
    }
  }

  selectMapNodes(nodes)

  // ── what to start with ─────────────────────────────────────────────────
  // On-map nodes first, so the recommendation lands where the eye already is
  // whenever an equally good candidate sits on the map.
  const startable = nodes
    .filter((n) => n.exercises.length > 0)
    .sort((a, b) => Number(b.onMap) - Number(a.onMap))
  const recommended =
    // Weak beats merely important: being shaky on something that matters is
    // the reason this word was expanded at all.
    startable.find((n) => n.status === 'weak' && n.importance >= 0.7) ??
    startable.find((n) => n.status === 'weak') ??
    startable.find((n) => n.status === 'needsReview') ??
    startable.find((n) => n.status === 'unseen' && n.importance >= 0.85) ??
    startable[0] ??
    null

  if (recommended) recommended.recommended = true

  return {
    lemma: master.lemma,
    partOfSpeech: master.partOfSpeech,
    meaningCoreKo: master.meaningCoreKo,
    status: master.status,
    brainMapId: master.id,
    nodes,
    recommendedNodeId: recommended?.id ?? null,
  }
}

/**
 * Chooses the handful of nodes that go on the map, in priority order:
 * the one core meaning, the confusable the student actually mixes up, the one
 * or two collocations they will really meet, and — only if there is room — one
 * further sense.
 *
 * Derived forms are deliberately never picked. A list of derivatives is
 * reference material; putting it on the map spends the student's attention on
 * the least useful thing there.
 *
 * Applied to stored content as well as to fresh generations, because the rule
 * is about what a student should see, not about what the model happened to
 * produce — maps written before the rule existed obey it too.
 */
function selectMapNodes(nodes: SemanticNode[]): void {
  const strongestFirst = (a: SemanticNode, b: SemanticNode) => b.importance - a.importance
  const of = (kind: NodeKind) => nodes.filter((n) => n.kind === kind).sort(strongestFirst)

  const picked: SemanticNode[] = []
  const take = (node: SemanticNode | undefined) => {
    if (!node || picked.length >= MAP_NODE_BUDGET || picked.includes(node)) return
    picked.push(node)
  }

  take(of('coreMeaning')[0])
  take(of('confusable')[0])
  for (const collocation of of('collocation').slice(0, 2)) take(collocation)

  // A further sense is the last thing in, and only when the map would otherwise
  // be too thin to be a map. For "issue" that means 문제·쟁점, issue vs problem
  // and two collocations fill the budget, so "이번 호" and "issue a statement"
  // — both real English — stay off it, which is the point.
  if (picked.length < MAP_NODE_TARGET) take(of('secondaryMeaning')[0])

  for (const node of picked) node.onMap = true
}
