import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import { reviewEvents, userConfusions, vocabularyTranslations } from '@/lib/db/schema'
import type { NodeType } from '@/lib/learning/nodes'
import { MAP_NODE_BUDGET, MAP_NODE_TARGET } from '@/lib/ai'
import { getMasterBrainMap, type MasterBrainMap } from './brain-map'
import { collectWordState, type WordStateRead } from './study'

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

export type Exercise =
  | {
      kind: 'choice'
      /** Sentence or cue shown above the options. */
      prompt: string
      options: string[]
      answer: string
      explanation: string
      /** Revealed only after answering. */
      concept?: string | null
    }
  | {
      kind: 'translate'
      prompt: string
      highlight: string | null
      answer: string
      concept?: string | null
    }

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
 * Attempts per individual item, read back out of `review_events.payload`.
 *
 * Per-item progress has no table of its own — `brain_map_node_progress` counts
 * whole categories. The event log is append-only and already carries the item
 * id, so the finer picture is derived rather than migrated for.
 */
async function itemTallies(
  userId: string,
  vocabularyId: string,
  db: Db,
): Promise<Map<string, ItemTally>> {
  const rows = await db
    .select({
      itemId: sql<string>`coalesce(
        ${reviewEvents.payload} ->> 'itemId',
        ${reviewEvents.payload} ->> 'pairId',
        ${reviewEvents.payload} ->> 'collocationId',
        ${reviewEvents.payload} ->> 'sentenceId'
      )`,
      correct: reviewEvents.correct,
    })
    .from(reviewEvents)
    .where(and(eq(reviewEvents.userId, userId), eq(reviewEvents.vocabularyId, vocabularyId)))
    .orderBy(desc(reviewEvents.reviewedAt))
    .limit(300)

  const tallies = new Map<string, ItemTally>()
  for (const row of rows) {
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
  opts: { approvedOnly?: boolean; state?: WordStateRead } = {},
  db: Db = defaultDb,
): Promise<SemanticMap | null> {
  const master = await getMasterBrainMap(
    vocabularyId,
    { approvedOnly: opts.approvedOnly ?? true },
    db,
  )
  if (!master) return null

  const [tallies, translations, confusions, wordState] = await Promise.all([
    itemTallies(userId, vocabularyId, db),
    db
      .select({ text: vocabularyTranslations.text, isPrimary: vocabularyTranslations.isPrimary })
      .from(vocabularyTranslations)
      .where(eq(vocabularyTranslations.vocabularyId, vocabularyId))
      .orderBy(desc(vocabularyTranslations.isPrimary), vocabularyTranslations.sortOrder),
    master.similarWords.length
      ? db
          .select({
            pairId: userConfusions.pairId,
            wrongCount: userConfusions.wrongCount,
            rightCount: userConfusions.rightCount,
          })
          .from(userConfusions)
          .where(
            and(
              eq(userConfusions.userId, userId),
              inArray(userConfusions.pairId, master.similarWords.map((p) => p.pairId)),
            ),
          )
      : Promise.resolve([]),
    opts.state ?? collectWordState(userId, vocabularyId, db),
  ])

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
      exercises: meaningExercises(master, master.meanings[0]?.ko ?? label),
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
      exercises: meaningExercises(master, meaning.ko),
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
      exercises: pair.questions.map((q) => ({
        kind: 'choice' as const,
        prompt: q.prompt,
        options: shuffleStable([master.lemma, pair.otherLemma], q.id),
        answer: q.answer,
        explanation: q.explanation,
        concept: pair.coreDifference,
      })),
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
      exercises: collocationExercises(collocation, master.collocations),
    })
  }

  // ── word family ────────────────────────────────────────────────────────
  const forms = [master.lemma, ...master.wordFamily.map((f) => f.lemma)]
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
      exercises: wordFamilyExercises(member, forms),
    })
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

/* ───────────────────────────── exercises ───────────────────────────── */

/**
 * Meaning is checked in context: read a real sentence, decide which sense of
 * the word it is carrying. Falls back to a translate-then-reveal when there is
 * only one sense to choose from.
 */
function meaningExercises(master: MasterBrainMap, sense: string): Exercise[] {
  const senses = [...new Set(master.meanings.map((m) => m.ko))]
  const forSense = master.sentences.filter(
    (s) => !s.targetMeaning || s.targetMeaning === sense || senses.length < 2,
  )
  const sentences = (forSense.length ? forSense : master.sentences).slice(0, 4)

  if (senses.length >= 2) {
    return sentences.map((sentence) => ({
      kind: 'choice' as const,
      prompt: sentence.text,
      options: shuffleStable(senses.slice(0, 4), sentence.id),
      answer: matchingSense(sentence.targetMeaning, senses, sense),
      explanation: sentence.ko,
      concept: master.meaningCoreKo,
    }))
  }

  return sentences.map((sentence) => ({
    kind: 'translate' as const,
    prompt: sentence.text,
    highlight: sentence.highlight,
    answer: sentence.ko,
    concept: master.meaningCoreKo,
  }))
}

function matchingSense(target: string | null, senses: string[], fallback: string): string {
  if (target && senses.includes(target)) return target
  return senses.includes(fallback) ? fallback : (senses[0] ?? fallback)
}

/**
 * A collocation is checked by putting its own example back together — blank
 * the partner word and choose among the other collocations' partners.
 *
 * When the source printed no sentence for it, the meaning is asked instead:
 * given the Korean, pick the expression. A wordbook lists phrases with their
 * glosses and no sentences, and that is exactly the question a wordbook test
 * asks, so the fallback is not a lesser question — it is the native one for
 * material that came from a book.
 */
function collocationExercises(
  collocation: MasterBrainMap['collocations'][number],
  siblings: MasterBrainMap['collocations'],
): Exercise[] {
  const cloze = collocationCloze(collocation, siblings.map((c) => c.expression))
  if (cloze.length) return cloze

  const distractors = siblings
    .filter((c) => c.id !== collocation.id && c.expression !== collocation.expression)
    .map((c) => c.expression)
    .slice(0, 3)

  // One expression on its own has nothing to be told apart from, and a
  // single-option question teaches nothing.
  if (!distractors.length) return []

  return [
    {
      kind: 'choice',
      prompt: `'${collocation.ko}' — 알맞은 표현은?`,
      options: shuffleStable([collocation.expression, ...distractors], collocation.id),
      answer: collocation.expression,
      explanation: `${collocation.expression} — ${collocation.ko}`,
      concept: null,
    },
  ]
}

function collocationCloze(
  collocation: MasterBrainMap['collocations'][number],
  allExpressions: string[],
): Exercise[] {
  const sentence = collocation.exampleSentence
  const partner = partnerWord(collocation.expression)
  if (!sentence || !partner) return []

  const pattern = new RegExp(escapeRegExp(partner), 'i')
  if (!pattern.test(sentence)) return []

  const distractors = allExpressions
    .filter((e) => e !== collocation.expression)
    .map(partnerWord)
    .filter((w): w is string => Boolean(w) && w !== partner)
    .slice(0, 3)

  if (!distractors.length) return []

  return [
    {
      kind: 'choice',
      prompt: sentence.replace(pattern, '______'),
      options: shuffleStable([partner, ...distractors], collocation.id),
      answer: partner,
      explanation: `${collocation.expression} — ${collocation.ko}`,
      concept: null,
    },
  ]
}

/** The half of a collocation that is not the head word, e.g. "order" in "maintain order". */
function partnerWord(expression: string): string | null {
  const words = expression.trim().split(/\s+/).filter((w) => !/^(a|an|the)$/i.test(w))
  return words.length >= 2 ? (words[words.length - 1] ?? null) : null
}

/**
 * A derived form is checked by blanking it in its own sentence — or, when there
 * is none, by asking which form carries the meaning. The distractors are the
 * word's own family, so the student has to tell `legislate` from `legislative`
 * rather than from an unrelated word.
 */
function wordFamilyExercises(
  member: MasterBrainMap['wordFamily'][number],
  forms: string[],
): Exercise[] {
  const options = shuffleStable(forms.slice(0, 4), member.id)
  const explanation = `${member.lemma} (${member.partOfSpeech}) — ${member.ko}`
  const sentence = member.exampleSentence

  if (sentence) {
    const pattern = new RegExp(escapeRegExp(member.lemma), 'i')
    if (pattern.test(sentence)) {
      return [
        {
          kind: 'choice',
          prompt: sentence.replace(pattern, '______'),
          options,
          answer: member.lemma,
          explanation,
          concept: null,
        },
      ]
    }
  }

  // The headword is always in `forms`, so there is at least one distractor.
  if (options.length < 2) return []

  return [
    {
      kind: 'choice',
      prompt: `'${member.ko}' — 알맞은 형태는?`,
      options,
      answer: member.lemma,
      explanation,
      concept: null,
    },
  ]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Order that varies per item but never between renders of the same item. */
function shuffleStable<T>(items: T[], seed: string): T[] {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return [...items].sort((a, b) => {
    const ha = (h ^ String(a).length * 2654435761) >>> 0
    const hb = (h ^ String(b).length * 2654435761) >>> 0
    return ha === hb ? String(a).localeCompare(String(b)) : ha - hb
  })
}
