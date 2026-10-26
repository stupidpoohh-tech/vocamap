import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import { vocabularyTranslations } from '@/lib/db/schema'
import type { NodeType } from '@/lib/learning/nodes'
import {
  collocationExercises,
  forMastery,
  meaningExercises,
  wordFamilyExercises,
  type Exercise,
} from '@/lib/learning/exercises'
import { randomUUID } from 'node:crypto'
import {
  EYEBROW,
  PROGRESS_NODE,
  recommend,
  selectMapNodes,
  statusFor,
  type ItemTally,
  type NodeKind,
  type NodeStatus,
  type SemanticNode,
} from '@/lib/learning/semantic-nodes'
import { signQuestion } from '@/lib/learning/question-token'
import { getMasterBrainMap, listRivalDefinitions, type MasterBrainMap } from './brain-map'
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

/**
 * 노드의 모양과 규칙은 `@/lib/learning/semantic-nodes` 에 있다 — DB 를 모르는
 * 순수 모듈이라 브라우저도 같은 것을 쓴다. 여기서 다시 내보내는 것은 카드를
 * 그리는 컴포넌트들이 이미 이 이름으로 들여오고 있기 때문이다.
 */
export type {
  NodeKind,
  NodeStatus,
  IssuedExercise,
  SemanticNode,
} from '@/lib/learning/semantic-nodes'
export { nodeEyebrow } from '@/lib/learning/semantic-nodes'

/**
 * Re-exported so the components that render a card keep importing the map's
 * own vocabulary. The questions themselves are built in
 * `@/lib/learning/exercises`, which knows nothing about the database.
 */
export type { Exercise }

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

/* ───────────────────── per-item status from the event log ───────────────────── */

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
    /**
     * Definitions of the words beside this one. Only the meaning node's
     * fallback question needs them, but it is read here with everything else:
     * finding out whether it is needed would mean awaiting the map first, and
     * that await is a round trip of its own.
     */
    rivalDefinitions?: Awaitable<string[]>
  } = {},
  db: Db = defaultDb,
): Promise<SemanticMap | null> {
  // Everything that depends only on the student and the word starts now,
  // alongside the map itself. Waiting for the map first turned four reads that
  // could have travelled with it into a round trip of their own — and over a
  // pooled connection to a database three hops away, round trips are what this
  // page costs.
  const [master, translations, wordState, rivalDefinitions] = await Promise.all([
    getMasterBrainMap(vocabularyId, { approvedOnly: opts.approvedOnly ?? true }, db),
    opts.translations ?? listTranslations(vocabularyId, db),
    opts.state ?? collectWordState(userId, vocabularyId, db),
    opts.rivalDefinitions ?? listRivalDefinitions(vocabularyId, 12, db),
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
        enDefinition: master.meanings[0]?.enDefinition,
        enDefinitionKo: master.meanings[0]?.enDefinitionKo,
        rivalDefinitions,
        lemma: master.lemma,
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
        enDefinition: meaning.enDefinition,
        enDefinitionKo: meaning.enDefinitionKo,
        rivalDefinitions,
        lemma: master.lemma,
      }),
    })
  })

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

  // Every gradable exercise goes out with the server's signed record of it.
  //
  // The map's cards were the one answer path still grading itself: the page
  // computed `correct` and posted it, so anything that could call the action
  // could mark any node of any word right, as often as it liked. The reveal
  // cards are not signed because they are not graded — see `revealNode`.
  await Promise.all(
    nodes.flatMap((node) =>
      node.exercises.map(async (exercise, index) => {
        if (exercise.kind !== 'choice') return
        exercise.token = await signQuestion({
          userId,
          vocabularyId,
          direction: 'en_ko',
          kind: 'gloss',
          answer: exercise.answer,
          options: exercise.options,
          submissionId: randomUUID(),
          contentVersion: master.version,
          itemId: node.itemId,
          node: node.progressNode,
        })
        void index
      }),
    ),
  )

  selectMapNodes(nodes)
  const recommendedNodeId = recommend(nodes)

  return {
    lemma: master.lemma,
    partOfSpeech: master.partOfSpeech,
    meaningCoreKo: master.meaningCoreKo,
    status: master.status,
    brainMapId: master.id,
    nodes,
    recommendedNodeId,
  }
}
