/**
 * The questions a Brain Map node asks.
 *
 * Pure module — it takes the content of a map and returns exercises, so the
 * rules about what is worth asking are testable without a database, the way
 * `brain-map-policy.ts` is.
 *
 * One fact about the screen decides the shape of all of them: **the node's
 * label is printed above the question.** The workspace heads every card with
 * the thing being studied, and the map behind it says the same word again. For
 * three of the five kinds of node that label is the answer — `raise an issue`
 * over a sentence missing `raise`, `maintenance` over a sentence missing
 * `maintenance`, `문제, 쟁점` over a list of meanings to pick from. A question
 * whose answer is written above it is not a question.
 *
 * So the direction is reversed. The item is the given, not the answer, and
 * what is asked is where it belongs:
 *
 *     '문제, 쟁점' — 이 뜻으로 쓰인 문장은?
 *     'raise an issue' — 어느 문장에 들어갈까요?
 *
 * Nothing on the screen answers that, and answering it means reading each
 * candidate rather than matching a string. Then the sentence it belongs in is
 * translated, which the label cannot give away either.
 */

const BLANK = '______'

/**
 * How much the exercise demands.
 *
 *  1. place the item — choose the context it belongs to
 *  2. translate the sentence it belongs in, unaided
 *
 * A student who has already answered a node correctly is not asked level 1
 * again; see `forMastery`.
 */
export type ExerciseLevel = 1 | 2

export type Exercise =
  | {
      kind: 'choice'
      prompt: string
      options: string[]
      answer: string
      explanation: string
      /** Revealed only after answering. */
      concept?: string | null
      level: ExerciseLevel
    }
  | {
      kind: 'translate'
      prompt: string
      highlight: string | null
      answer: string
      concept?: string | null
      level: ExerciseLevel
    }

/* ─────────────────────────── content it reads ─────────────────────────── */

/**
 * Structural shapes rather than imports from the data layer: this module must
 * not reach the database, and `MasterBrainMap`'s members satisfy these as they
 * stand.
 */
export type SentenceContent = {
  id: string
  text: string
  ko: string
  targetMeaning: string | null
  highlight: string | null
  difficulty: number | null
}

export type CollocationContent = {
  id: string
  expression: string
  ko: string
  exampleSentence: string | null
}

export type FamilyContent = {
  id: string
  lemma: string
  partOfSpeech: string
  ko: string
  exampleSentence: string | null
}

export type PairContent = {
  pairId: string
  otherLemma: string
  coreDifference: string
  usageRule: string | null
  questions: Array<{ id: string; prompt: string; answer: string; explanation: string }>
}

/** At most this many candidates in one placement question. */
const MAX_OPTIONS = 4

/* ───────────────────────────── meaning ───────────────────────────── */

/**
 * A sense is checked by finding it at work: here is the meaning, which of
 * these sentences is carrying it. Every candidate contains the word, so the
 * choice cannot be made by spotting it — only by reading.
 *
 * The sentence held back for translation is never one of the candidates. A
 * placement question prints the chosen sentence's Korean when it explains
 * itself, and asking a student to translate a sentence they were handed the
 * translation of two screens ago is not a second question.
 */
export function meaningExercises(input: {
  /** The node's label — the sense being studied, as the student sees it. */
  label: string
  /** The sense this node is about, as the sentences record it. */
  sense: string
  sentences: SentenceContent[]
  meaningCoreKo: string | null
  /** Why this sense follows from the core idea. Shown after answering. */
  connectionNote?: string | null
}): Exercise[] {
  const concept = input.connectionNote ?? input.meaningCoreKo
  const { mine, others } = splitBySense(input.sentences, input.sense)
  if (!mine.length) return []

  // Easiest first, so the node opens with a way in rather than with its
  // hardest sentence. `difficulty` has been on every sentence since the schema
  // was written and was never read.
  const ordered = byDifficulty(mine)
  const toTranslate = ordered[ordered.length - 1]!
  // Every sentence but the one being held back — unless the sense has only the
  // one, and then it is both placed and translated, in that order.
  const toPlace = ordered.length > 1 ? ordered.slice(0, -1) : ordered

  const exercises: Exercise[] = []

  const rivals = others.slice(0, MAX_OPTIONS - 1)

  for (const sentence of toPlace.slice(0, 2)) {
    const options = shuffleStable([sentence.text, ...rivals.map((s) => s.text)], sentence.id)
    // One candidate is not a choice.
    if (options.length < 2) continue
    exercises.push({
      kind: 'choice',
      // The use the curator wrote for this sentence, not the node's label.
      // "issue" has two sentences under 문제·쟁점 — a public one and a personal
      // complaint — and asking for 문제·쟁점 makes both of them right. Asking
      // for 사회적 쟁점 has one answer, and it is the distinction that was
      // worth writing down.
      prompt: `'${sentence.targetMeaning ?? input.label}' — 이 뜻으로 쓰인 문장은?`,
      options,
      answer: sentence.text,
      // Naming what the others were, rather than translating this one, when
      // this sentence is the one about to be translated: the Korean is the
      // next question's answer.
      explanation:
        sentence.id === toTranslate.id ? rivalNote(rivals, input.label) : sentence.ko,
      concept,
      level: 1,
    })
  }

  exercises.push({
    kind: 'translate',
    prompt: toTranslate.text,
    highlight: toTranslate.highlight,
    answer: toTranslate.ko,
    concept,
    level: 2,
  })

  return exercises
}

/** What the sentences that were not the answer were showing instead. */
function rivalNote(rivals: SentenceContent[], label: string): string {
  const senses = [...new Set(rivals.map((s) => s.targetMeaning).filter(Boolean))]
  if (!senses.length) return `이 문장이 '${label}'의 쓰임입니다.`
  return `나머지 문장은 ${senses.map((s) => `'${s}'`).join(', ')}의 쓰임입니다.`
}

/**
 * Sentences that show this sense, and sentences that show a different one.
 *
 * The two sides were not written to line up. A meaning is filed as
 * "(기계·건물을) 정비하다, 관리하다" and the sentence that shows it is filed as
 * "기계를 정비하다", so matching the strings exactly leaves the meaning with no
 * sentences at all — which is how the core meaning of `maintain` ends up with
 * nothing to ask. They are matched on a shared word instead: a curator naming
 * the same use twice reaches for the same verb both times.
 *
 * A sentence with no sense recorded belongs to no sense in particular and is
 * never offered as the wrong answer. If nothing matches, every sentence counts
 * as this sense's — a node with content always has something to ask, and a
 * wrong guess about which sentence shows which use costs a placement question,
 * not the node.
 */
function splitBySense(sentences: SentenceContent[], sense: string) {
  const mine: SentenceContent[] = []
  const others: SentenceContent[] = []
  for (const sentence of sentences) {
    if (!sentence.targetMeaning?.trim()) mine.push(sentence)
    else if (sharesAWord(sense, sentence.targetMeaning)) mine.push(sentence)
    else others.push(sentence)
  }
  return mine.length ? { mine, others } : { mine: sentences, others: [] }
}

/**
 * Whether two descriptions of a use name it with the same word. Single
 * syllables and stray particles are too common to mean anything, so only words
 * of two characters or more count.
 */
function sharesAWord(a: string, b: string): boolean {
  const other = b.toLowerCase()
  const parts = a
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const words = parts.filter((word) => word.length >= 2)
  // A description made only of single syllables has no word worth matching on,
  // so it is compared whole rather than dropped.
  return (words.length ? words : parts).some((word) => other.includes(word))
}

/** Easiest first. Sentences with no difficulty recorded sit in the middle. */
function byDifficulty(sentences: SentenceContent[]): SentenceContent[] {
  return [...sentences].sort((a, b) => (a.difficulty ?? 3) - (b.difficulty ?? 3))
}

/* ──────────────────────────── confusable ──────────────────────────── */

/**
 * The one node whose label — `issue vs problem` — names both candidates and
 * gives neither away, so it can be asked either way round.
 *
 * It is asked as a comparison first: two sentences, one of which takes this
 * word. A blank with two options under it is a coin flip on the node that
 * matters most; choosing between two contexts is the judgement the pair exists
 * to teach. The two sentences it uses are not then asked again on their own —
 * their answers have just been displayed.
 *
 * `usageRule` reaches the student here. It was written for exactly this moment
 * and until now only the review screen ever showed it.
 */
export function confusableExercises(input: { lemma: string; pair: PairContent }): Exercise[] {
  const { lemma, pair } = input
  const concept = [pair.coreDifference, pair.usageRule].filter(Boolean).join(' ')

  const isTarget = (answer: string) => sameWord(answer, lemma)
  const mine = pair.questions.filter((q) => isTarget(q.answer))
  const theirs = pair.questions.filter((q) => !isTarget(q.answer))

  const exercises: Exercise[] = []
  const used = new Set<string>()

  if (mine.length && theirs.length) {
    const a = mine[0]!
    const b = theirs[0]!
    used.add(a.id).add(b.id)
    exercises.push({
      kind: 'choice',
      // No particle after the lemma: the word is English and Korean particles
      // pick themselves by the sound of what comes before them.
      prompt: `'${lemma}' — 어느 문장에 들어갈까요?`,
      options: shuffleStable([a.prompt, b.prompt], pair.pairId),
      answer: a.prompt,
      explanation: a.explanation,
      concept,
      level: 1,
    })
  }

  for (const question of pair.questions) {
    if (used.has(question.id)) continue
    exercises.push({
      kind: 'choice',
      prompt: question.prompt,
      options: shuffleStable([lemma, pair.otherLemma], question.id),
      answer: question.answer,
      explanation: question.explanation,
      concept,
      level: 1,
    })
  }

  return exercises
}

/* ─────────────────────────── collocation ─────────────────────────── */

/**
 * A collocation is two words that belong together, and the card already prints
 * both of them. What it does not print is where the pairing is used, so that
 * is what is asked: the word's other expressions supply the rival contexts,
 * and every candidate has its own expression blanked out so the answer cannot
 * be spotted, only judged.
 *
 * This replaces a blank over the last word of the expression. For every
 * expression whose target word comes last — `raise an issue`, `address an
 * issue` — that blank was the word whose page this is, printed in the middle
 * of the map and again above the question.
 */
export function collocationExercises(input: {
  lemma: string
  collocation: CollocationContent
  siblings: CollocationContent[]
}): Exercise[] {
  const { lemma, collocation, siblings } = input
  const sentence = collocation.exampleSentence
  const exercises: Exercise[] = []

  const mine = sentence ? blankExpression(sentence, collocation.expression, lemma) : null
  const candidates = siblings
    .filter((c) => c.id !== collocation.id && c.exampleSentence)
    .map((c) => blankExpression(c.exampleSentence!, c.expression, lemma))
    .filter((text): text is string => Boolean(text))

  if (mine && candidates.length) {
    exercises.push({
      kind: 'choice',
      prompt: `'${collocation.expression}' — 어느 문장에 들어갈까요?`,
      options: shuffleStable([mine, ...candidates.slice(0, MAX_OPTIONS - 1)], collocation.id),
      answer: mine,
      // The expression and its gloss, not the sentence's translation: the
      // sentence is about to be translated and this must not answer it.
      explanation: `${collocation.expression} — ${collocation.ko}`,
      concept: null,
      level: 1,
    })
  } else {
    exercises.push(
      ...glossExercise({
        seed: collocation.id,
        prompt: `'${collocation.expression}' — 무슨 뜻일까요?`,
        answer: collocation.ko,
        distractors: siblings.filter((c) => c.id !== collocation.id).map((c) => c.ko),
        explanation: `${collocation.expression} — ${collocation.ko}`,
      }),
    )
  }

  if (sentence) {
    exercises.push({
      kind: 'translate',
      prompt: sentence,
      highlight: surfaceFormIn(sentence, partnerWord(collocation.expression, lemma) ?? lemma),
      answer: `${collocation.ko} — ${collocation.expression}`,
      concept: null,
      level: 2,
    })
  }

  return exercises
}

/**
 * What a phrase from a wordbook can still be asked.
 *
 * A book prints an expression and its meaning and no sentence at all, so there
 * is no context to place it in. The gloss is the one thing about the item that
 * the screen does not already show — the card prints the expression, never its
 * meaning — so it is what can honestly be asked for. The rival meanings are
 * the word's other expressions, which is the question the book itself sets.
 */
function glossExercise(input: {
  seed: string
  prompt: string
  answer: string
  distractors: string[]
  explanation: string
}): Exercise[] {
  const distractors = [
    ...new Set(input.distractors.map((d) => d.trim()).filter((d) => d && d !== input.answer.trim())),
  ].slice(0, MAX_OPTIONS - 1)

  // One option is not a question.
  if (!distractors.length) return []

  return [
    {
      kind: 'choice',
      prompt: input.prompt,
      options: shuffleStable([input.answer, ...distractors], input.seed),
      answer: input.answer,
      explanation: input.explanation,
      concept: null,
      level: 1,
    },
  ]
}

/**
 * Blanks out what makes the expression this expression.
 *
 * The half that is not the head word carries the information — `raise`, not
 * `issue`; `directly`, not `affect` — so that is what goes, leaving a sentence
 * that still reads as English and no longer names which expression it is.
 */
function blankExpression(sentence: string, expression: string, lemma: string): string | null {
  const partner = partnerWord(expression, lemma)
  if (!partner) return null
  const surface = surfaceFormIn(sentence, partner)
  if (!surface) return null
  return replaceOnce(sentence, surface, BLANK)
}

/**
 * The half of the expression that is not the word this page is about.
 *
 * "maintain order" → order. "raise an issue" → raise. "be deeply affected by"
 * → deeply. Articles, forms of *be* and bare prepositions carry no collocation
 * information and are never the answer.
 */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the',
  'be', 'been', 'being', 'is', 'are', 'was', 'were',
  'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'about', 'by', 'into', 'over',
  'up', 'out', 'off', 'down',
])

export function partnerWord(expression: string, lemma: string): string | null {
  const words = expression.trim().split(/\s+/).filter(Boolean)
  const candidates = words.filter(
    (word) => !FUNCTION_WORDS.has(word.toLowerCase()) && !sameWord(word, lemma),
  )
  return candidates[0] ?? null
}

/* ─────────────────────────── word family ─────────────────────────── */

/**
 * Which sentence takes this form. The rival sentences are the word's own other
 * derivatives, so telling `maintenance` from `maintainable` is the whole task,
 * and every candidate has its form blanked so the choice is grammatical
 * judgement rather than spotting.
 *
 * With no sibling sentence to compare against, the form's own sentence is
 * translated instead, and a form that arrived from a wordbook with no sentence
 * at all is asked for its meaning. Blanking the form in its own sentence and
 * listing the family underneath — what this used to do — asks for the word
 * printed at the top of the card.
 */
export function wordFamilyExercises(input: {
  member: FamilyContent
  /** Every derived form of the word, including this one. */
  family: FamilyContent[]
}): Exercise[] {
  const { member, family } = input
  const sentence = member.exampleSentence
  const explanation = `${member.lemma} (${member.partOfSpeech}) — ${member.ko}`
  const exercises: Exercise[] = []

  const mine = sentence ? blankForm(sentence, member.lemma) : null
  const candidates = family
    .filter((f) => f.id !== member.id && f.exampleSentence)
    .map((f) => blankForm(f.exampleSentence!, f.lemma))
    .filter((text): text is string => Boolean(text))

  if (mine && candidates.length) {
    exercises.push({
      kind: 'choice',
      prompt: `'${member.lemma}' — 어느 문장에 들어갈까요?`,
      options: shuffleStable([mine, ...candidates.slice(0, MAX_OPTIONS - 1)], member.id),
      answer: mine,
      explanation,
      concept: null,
      level: 1,
    })
  } else {
    exercises.push(
      ...glossExercise({
        seed: member.id,
        prompt: `'${member.lemma}' — 무슨 뜻일까요?`,
        answer: member.ko,
        distractors: family.filter((f) => f.id !== member.id).map((f) => f.ko),
        explanation,
      }),
    )
  }

  if (sentence) {
    exercises.push({
      kind: 'translate',
      prompt: sentence,
      highlight: surfaceFormIn(sentence, member.lemma),
      answer: explanation,
      concept: null,
      level: 2,
    })
  }

  return exercises
}

function blankForm(sentence: string, lemma: string): string | null {
  const surface = surfaceFormIn(sentence, lemma)
  if (!surface) return null
  return replaceOnce(sentence, surface, BLANK)
}

/* ────────────────────────────── ordering ────────────────────────────── */

/**
 * What to ask a student who has already answered this node correctly.
 *
 * Not the way in again. Placing the item is how someone gets started; asking
 * it of a student who is past it is the "이 항목 완료" screen with extra steps.
 * It stays only when the node has nothing else.
 */
export function forMastery(exercises: Exercise[]): Exercise[] {
  const harder = exercises.filter((e) => e.level > 1)
  return harder.length ? harder : exercises
}

/* ────────────────────────────── text helpers ────────────────────────────── */

/**
 * How the sentence spells the word.
 *
 * Sentences inflect — `raise` appears as "raised", `maintain` as "maintained" —
 * so an exact match finds the blank far less often than it should. Matching
 * from a stem catches the regular cases, and a stem short enough to collide
 * with unrelated words is not used at all.
 */
export function surfaceFormIn(sentence: string, word: string): string | null {
  const exact = sentence.match(new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i'))
  if (exact) return exact[0]

  if (/\s/.test(word.trim())) return null
  const stem = word.trim().replace(/e$/i, '')
  if (stem.length < 4) return null

  const inflected = sentence.match(new RegExp(`\\b${escapeRegExp(stem)}[a-z]{0,3}\\b`, 'i'))
  return inflected ? inflected[0] : null
}

function replaceOnce(sentence: string, target: string, replacement: string): string {
  const index = sentence.toLowerCase().indexOf(target.toLowerCase())
  if (index < 0) return sentence
  return sentence.slice(0, index) + replacement + sentence.slice(index + target.length)
}

function sameWord(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Order that varies per item but never between renders of the same item.
 *
 * Keyed on what each option says, not on how long it is. Mixing the seed with
 * the option's length alone ordered the choices by length — for a question
 * whose options are four sentences that is one arrangement for the whole set,
 * and the answer landed in the same place every time.
 */
export function shuffleStable<T>(items: T[], seed: string): T[] {
  return [...items]
    .map((item) => ({ item, key: hash(`${seed}\u0000${String(item)}`) }))
    .sort((a, b) => (a.key === b.key ? String(a.item).localeCompare(String(b.item)) : a.key - b.key))
    .map(({ item }) => item)
}

function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
