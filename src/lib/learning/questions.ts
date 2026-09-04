import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db'
import { db as defaultDb } from '@/lib/db'
import {
  brainMapCollocations,
  brainMapMeanings,
  brainMapSentences,
  brainMapWordFamily,
  brainMaps,
  vocabularies,
  vocabularySetItems,
  vocabularyTranslations,
} from '@/lib/db/schema'
import type { QueueItem } from '@/lib/data/study'
import type { Direction } from './scheduler'

/**
 * How a word is being asked about.
 *
 * `gloss` is the plain dictionary question every word can be asked. The rest
 * are only possible for a word whose Brain Map carries the material, and they
 * are what makes a mapped word worth having a map.
 */
export type QuestionKind = 'gloss' | 'context' | 'sense' | 'collocation' | 'family'

export type RecallQuestion = {
  vocabularyId: string
  direction: Direction
  isNew: boolean
  kind: QuestionKind
  /** What the student is shown. */
  prompt: string
  /** The correct response. */
  answer: string
  /** Four options including the answer, already shuffled. */
  options: string[]
  /** Shown after answering, when the question needs a word of explanation. */
  note?: string
}

const OPTION_COUNT = 4

/**
 * Turns a due queue into answerable multiple-choice questions.
 *
 * Distractors come from the word's own set first.
 *
 * They used to be drawn from anywhere in the library, which made the questions
 * far easier than they looked: asked for `govern`, a student who saw
 * `refrigeration`, `celebrity` and `magnetic` beside it could cross all three
 * off by topic without knowing the word at all. Words a teacher grouped into
 * one set are the words that turn up together on the paper, and they are
 * exactly the ones worth telling apart.
 *
 * The library is still there as a fallback, for a word in no set or a set too
 * small to fill four options.
 */
export async function buildQuestions(
  userId: string,
  queue: QueueItem[],
  db: Db = defaultDb,
): Promise<RecallQuestion[]> {
  if (!queue.length) return []

  const queueIds = [...new Set(queue.map((q) => q.vocabularyId))]

  const [neighbours, pool, material] = await Promise.all([
    setNeighbours(queueIds, db),
    libraryPool(db),
    mapMaterial(queueIds, db),
  ])

  const questions: RecallQuestion[] = []

  for (const item of queue) {
    const isEnKo = item.direction === 'en_ko'
    const answer = isEnKo ? item.translation : item.lemma
    const prompt = isEnKo ? item.lemma : item.translation

    const usable = (words: PoolWord[]) =>
      words
        .filter((w) => w.vocabularyId !== item.vocabularyId)
        .map((w) => (isEnKo ? w.translation : w.lemma))
        .filter((value) => value && value !== answer)

    // Set first, library only to top up.
    const near = shuffle([...new Set(usable(neighbours.get(item.vocabularyId) ?? []))])
    const far = shuffle([...new Set(usable(pool))])
    const distractors = [...new Set([...near, ...far])].slice(0, OPTION_COUNT - 1)

    // A word with a Brain Map is asked a different way each time it comes
    // round. The map is not extra homework — it is a better question about the
    // word that was due anyway, so the schedule is untouched.
    const richer = mapQuestion(item, material.get(item.vocabularyId), neighbours, material)
    if (richer) {
      questions.push({ ...richer, vocabularyId: item.vocabularyId, direction: item.direction, isNew: item.isNew })
      continue
    }

    questions.push({
      vocabularyId: item.vocabularyId,
      direction: item.direction,
      isNew: item.isNew,
      kind: 'gloss',
      prompt,
      answer,
      options: shuffle([answer, ...distractors]),
    })
  }

  // Interleave rather than grouping by direction: seeing `maintain → 유지하다`
  // immediately followed by `유지하다 → maintain` tests recognition, not recall.
  return interleave(questions, queueIds.length)
}

type PoolWord = { vocabularyId: string; lemma: string; translation: string }

export type MapMaterial = {
  senses: string[]
  sentences: Array<{ text: string; ko: string; highlight: string | null; targetMeaning: string | null }>
  collocations: Array<{ expression: string; ko: string }>
  family: Array<{ lemma: string; ko: string }>
}

/**
 * Everything a mapped word can be asked about, for the whole queue at once.
 *
 * Four queries for a session rather than one per word: a test is a couple of
 * dozen words and each would otherwise cost its own round trip.
 */
async function mapMaterial(
  vocabularyIds: string[],
  db: Db,
): Promise<Map<string, MapMaterial>> {
  const byWord = new Map<string, MapMaterial>()
  if (!vocabularyIds.length) return byWord

  const maps = await db
    .select({ id: brainMaps.id, vocabularyId: brainMaps.vocabularyId })
    .from(brainMaps)
    .where(
      and(
        inArray(brainMaps.vocabularyId, vocabularyIds),
        // Drafts are not questions. A student never meets unreviewed material.
        eq(brainMaps.status, 'approved'),
      ),
    )
  if (!maps.length) return byWord

  const mapIds = maps.map((m) => m.id)
  const wordOf = new Map(maps.map((m) => [m.id, m.vocabularyId]))
  for (const m of maps) {
    byWord.set(m.vocabularyId, { senses: [], sentences: [], collocations: [], family: [] })
  }

  const [meanings, sentences, collocations, family] = await Promise.all([
    db
      .select({ brainMapId: brainMapMeanings.brainMapId, ko: brainMapMeanings.ko })
      .from(brainMapMeanings)
      .where(inArray(brainMapMeanings.brainMapId, mapIds))
      .orderBy(brainMapMeanings.sortOrder),
    db
      .select({
        brainMapId: brainMapSentences.brainMapId,
        text: brainMapSentences.text,
        ko: brainMapSentences.ko,
        highlight: brainMapSentences.highlight,
        targetMeaning: brainMapSentences.targetMeaning,
      })
      .from(brainMapSentences)
      .where(inArray(brainMapSentences.brainMapId, mapIds))
      .orderBy(brainMapSentences.sortOrder),
    db
      .select({
        brainMapId: brainMapCollocations.brainMapId,
        expression: brainMapCollocations.expression,
        ko: brainMapCollocations.ko,
      })
      .from(brainMapCollocations)
      .where(inArray(brainMapCollocations.brainMapId, mapIds))
      .orderBy(brainMapCollocations.sortOrder),
    db
      .select({
        brainMapId: brainMapWordFamily.brainMapId,
        lemma: brainMapWordFamily.lemma,
        ko: brainMapWordFamily.ko,
      })
      .from(brainMapWordFamily)
      .where(inArray(brainMapWordFamily.brainMapId, mapIds))
      .orderBy(brainMapWordFamily.sortOrder),
  ])

  const into = (mapId: string) => byWord.get(wordOf.get(mapId) ?? '')
  for (const row of meanings) into(row.brainMapId)?.senses.push(row.ko)
  for (const row of sentences) into(row.brainMapId)?.sentences.push(row)
  for (const row of collocations) into(row.brainMapId)?.collocations.push(row)
  for (const row of family) into(row.brainMapId)?.family.push(row)

  return byWord
}

/**
 * Every word that shares a set with something in the queue, by queue word.
 *
 * One query for the whole session rather than one per question: a set is a
 * couple of dozen words, and a test is a couple of dozen questions.
 */
async function setNeighbours(
  queueIds: string[],
  db: Db,
): Promise<Map<string, PoolWord[]>> {
  const byWord = new Map<string, PoolWord[]>()
  if (!queueIds.length) return byWord

  const rows = await db
    .select({
      setId: vocabularySetItems.setId,
      vocabularyId: vocabularies.id,
      lemma: vocabularies.lemma,
      translation: vocabularyTranslations.text,
    })
    .from(vocabularySetItems)
    .innerJoin(vocabularies, eq(vocabularies.id, vocabularySetItems.vocabularyId))
    .innerJoin(
      vocabularyTranslations,
      and(
        eq(vocabularyTranslations.vocabularyId, vocabularies.id),
        eq(vocabularyTranslations.isPrimary, true),
      ),
    )
    .where(
      inArray(
        vocabularySetItems.setId,
        db
          .select({ setId: vocabularySetItems.setId })
          .from(vocabularySetItems)
          .where(inArray(vocabularySetItems.vocabularyId, queueIds)),
      ),
    )

  const membersOf = new Map<string, PoolWord[]>()
  const setsOf = new Map<string, string[]>()
  for (const row of rows) {
    const word = { vocabularyId: row.vocabularyId, lemma: row.lemma, translation: row.translation }
    const members = membersOf.get(row.setId)
    if (members) members.push(word)
    else membersOf.set(row.setId, [word])

    const sets = setsOf.get(row.vocabularyId)
    if (sets) sets.push(row.setId)
    else setsOf.set(row.vocabularyId, [row.setId])
  }

  for (const id of queueIds) {
    const words = (setsOf.get(id) ?? []).flatMap((setId) => membersOf.get(setId) ?? [])
    byWord.set(id, words)
  }
  return byWord
}

/** The last resort: any word with a gloss, for a word that is in no set. */
async function libraryPool(db: Db): Promise<PoolWord[]> {
  return db
    .select({
      vocabularyId: vocabularies.id,
      lemma: vocabularies.lemma,
      translation: vocabularyTranslations.text,
    })
    .from(vocabularies)
    .innerJoin(
      vocabularyTranslations,
      and(
        eq(vocabularyTranslations.vocabularyId, vocabularies.id),
        eq(vocabularyTranslations.isPrimary, true),
      ),
    )
    .limit(400)
}

/**
 * The richer question a mapped word can be asked, or null for the plain one.
 *
 * Which one it is rotates with the word's due date, so a word answered today
 * and again next week is not asked the same thing twice — but stays fixed
 * within a session, so refreshing the page cannot reroll a question.
 *
 * The variants are split by direction because that is what the schedule
 * already tracks: producing the English form belongs with `ko_en`, choosing a
 * Korean meaning with `en_ko`. Nothing new is scheduled.
 */
function mapQuestion(
  item: QueueItem,
  material: MapMaterial | undefined,
  neighbours: Map<string, PoolWord[]>,
  everything: Map<string, MapMaterial>,
): Pick<RecallQuestion, 'kind' | 'prompt' | 'answer' | 'options' | 'note'> | null {
  if (!material) return null

  const seed = `${item.vocabularyId}:${item.dueAt.toISOString()}`
  const variants =
    item.direction === 'en_ko'
      ? [senseQuestion(item, material)]
      : [
          contextQuestion(item, material, neighbours),
          collocationQuestion(item, material, everything, neighbours),
          familyQuestion(item, material, everything, neighbours),
        ]

  const usable = variants.filter((v): v is NonNullable<typeof v> => v !== null)
  if (!usable.length) return null
  return usable[hash(seed) % usable.length]!
}

/** Which of its meanings is at work here? Needs the word to have two. */
function senseQuestion(
  item: QueueItem,
  material: MapMaterial,
): Pick<RecallQuestion, 'kind' | 'prompt' | 'answer' | 'options' | 'note'> | null {
  const senses = [...new Set(material.senses)]
  if (senses.length < 2) return null

  const sentence = material.sentences.find(
    (s) => s.targetMeaning && senses.includes(s.targetMeaning),
  )
  if (!sentence) return null

  return {
    kind: 'sense',
    prompt: sentence.text,
    answer: sentence.targetMeaning!,
    options: shuffle(senses.slice(0, OPTION_COUNT)),
    note: sentence.ko,
  }
}

/**
 * The word taken out of its own sentence.
 *
 * The blank stands where the sentence's own inflection was — "governed", not
 * "govern" — but the options are dictionary forms, because inflecting three
 * other words to match would go wrong the moment one of them is irregular. The
 * sentence is shown whole once the answer is in.
 */
function contextQuestion(
  item: QueueItem,
  material: MapMaterial,
  neighbours: Map<string, PoolWord[]>,
): Pick<RecallQuestion, 'kind' | 'prompt' | 'answer' | 'options' | 'note'> | null {
  const sentence = material.sentences.find((s) => s.highlight && s.text.includes(s.highlight))
  if (!sentence) return null

  const others = (neighbours.get(item.vocabularyId) ?? [])
    .filter((w) => w.vocabularyId !== item.vocabularyId)
    .map((w) => w.lemma)
    .filter((lemma) => lemma !== item.lemma)

  const distractors = shuffle([...new Set(others)]).slice(0, OPTION_COUNT - 1)
  if (distractors.length < 2) return null

  return {
    kind: 'context',
    prompt: sentence.text.replace(sentence.highlight!, '______'),
    answer: item.lemma,
    options: shuffle([item.lemma, ...distractors]),
    note: `${sentence.text} — ${sentence.ko}`,
  }
}

/** Which expression carries this meaning? Distractors come from the set. */
function collocationQuestion(
  item: QueueItem,
  material: MapMaterial,
  everything: Map<string, MapMaterial>,
  neighbours: Map<string, PoolWord[]>,
): Pick<RecallQuestion, 'kind' | 'prompt' | 'answer' | 'options' | 'note'> | null {
  const own = material.collocations
  if (!own.length) return null
  const target = own[hash(item.vocabularyId) % own.length]!

  const siblings = own.filter((c) => c.expression !== target.expression).map((c) => c.expression)
  const fromSet = (neighbours.get(item.vocabularyId) ?? [])
    .flatMap((w) => everything.get(w.vocabularyId)?.collocations ?? [])
    .map((c) => c.expression)
    .filter((e) => e !== target.expression)

  const distractors = [...new Set([...shuffle(siblings), ...shuffle(fromSet)])].slice(
    0,
    OPTION_COUNT - 1,
  )
  if (!distractors.length) return null

  return {
    kind: 'collocation',
    prompt: `'${target.ko}' — 알맞은 표현은?`,
    answer: target.expression,
    options: shuffle([target.expression, ...distractors]),
  }
}

/** Which form of the word is this? Distractors are its own family first. */
function familyQuestion(
  item: QueueItem,
  material: MapMaterial,
  everything: Map<string, MapMaterial>,
  neighbours: Map<string, PoolWord[]>,
): Pick<RecallQuestion, 'kind' | 'prompt' | 'answer' | 'options' | 'note'> | null {
  const own = material.family
  if (!own.length) return null
  const target = own[hash(item.vocabularyId) % own.length]!

  const siblings = [item.lemma, ...own.map((f) => f.lemma)].filter((l) => l !== target.lemma)
  const fromSet = (neighbours.get(item.vocabularyId) ?? [])
    .flatMap((w) => everything.get(w.vocabularyId)?.family ?? [])
    .map((f) => f.lemma)
    .filter((l) => l !== target.lemma)

  const distractors = [...new Set([...siblings, ...shuffle(fromSet)])].slice(0, OPTION_COUNT - 1)
  if (!distractors.length) return null

  return {
    kind: 'family',
    prompt: `'${target.ko}' — 알맞은 형태는?`,
    answer: target.lemma,
    options: shuffle([target.lemma, ...distractors]),
  }
}

/** Stable, so a variant does not reroll when the page is refreshed. */
function hash(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

/** Spreads the two directions of the same word apart within the session. */
function interleave(questions: RecallQuestion[], _wordCount: number): RecallQuestion[] {
  const enKo = questions.filter((q) => q.direction === 'en_ko')
  const koEn = questions.filter((q) => q.direction === 'ko_en')
  const result: RecallQuestion[] = []
  const half = Math.max(enKo.length, koEn.length)
  for (let i = 0; i < half; i += 1) {
    if (enKo[i]) result.push(enKo[i]!)
    if (koEn[i]) result.push(koEn[i]!)
  }
  return result
}
