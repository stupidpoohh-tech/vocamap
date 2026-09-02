import { z } from 'zod'
import { MAP_NODE_TARGET } from './prompts'

/**
 * The contract for every Brain Map the LLM produces. Nothing reaches the
 * database that has not passed this. Two rules shape it:
 *
 *  1. Arrays are allowed to be empty. The model is never told it must fill a
 *     node — a fabricated derivative or a strained "synonym" is worse than a
 *     missing one, and a curator can always add it later.
 *  2. Arrays have hard maximums. The point of a Brain Map is selection.
 */

const shortText = z.string().trim().min(1).max(200)
const sentenceText = z.string().trim().min(5).max(180)

export const meaningSchema = z.object({
  ko: shortText.describe('한국어 뜻. 사전식 나열이 아니라 하나의 용법.'),
  enDefinition: z.string().trim().max(240).nullable(),
  connectionNote: z
    .string()
    .trim()
    .max(300)
    .describe('이 뜻이 meaning core에서 어떻게 파생되는지 한국어 한두 문장으로 설명'),
  exampleChunk: z.string().trim().max(80).nullable().describe('예: "maintain health"'),
})

export const sentenceSchema = z.object({
  text: sentenceText.describe('자연스러운 실제 영어 문장'),
  ko: shortText.describe('자연스러운 한국어 번역'),
  targetMeaning: shortText.describe('이 문장이 보여주는 용법'),
  highlight: z
    .string()
    .trim()
    .max(60)
    .describe('text 안에 그대로 등장하는 부분 문자열. target word를 포함해야 함'),
  difficulty: z.number().int().min(1).max(5),
})

export const collocationSchema = z.object({
  expression: shortText,
  ko: shortText,
  exampleSentence: sentenceText.nullable(),
  importance: z.number().int().min(1).max(3).describe('1 = 반드시 알아야 함, 3 = 알면 좋음'),
})

export const wordFamilySchema = z.object({
  lemma: shortText,
  partOfSpeech: z.enum(['noun', 'verb', 'adjective', 'adverb', 'other']),
  ko: shortText,
  exampleSentence: sentenceText.nullable(),
})

export const similarWordSchema = z.object({
  lemma: shortText.describe('학생이 실제로 혼동할 만한 단어'),
  coreDifference: z.string().trim().min(5).max(300).describe('두 단어의 핵심 차이 (한국어)'),
  usageRule: z.string().trim().max(300).nullable(),
  questions: z
    .array(
      z.object({
        prompt: sentenceText.describe('빈칸 ___ 을 정확히 하나 포함한 문장'),
        answer: shortText,
        explanation: z.string().trim().min(5).max(300),
      }),
    )
    .max(5),
})

/**
 * The caps are the density rule made structural.
 *
 * A Brain Map is 3-5 nodes: one core meaning, at most one confusable, one or
 * two collocations, at most one further sense. Each cap leaves the model less
 * room than that and the curator one slot of headroom on top, so the screen
 * cannot fill up with true-but-unnecessary material even when the model
 * ignores the instruction.
 *
 * Sentences and word family are not nodes. Sentences are the drill material
 * behind the meaning node, and derived forms are reference the student can
 * look at — neither earns a place on the map, so both are capped at what they
 * are actually used for rather than at what could be produced.
 */
export const brainMapDraftSchema = z.object({
  meaningCoreKo: z
    .string()
    .trim()
    .min(5)
    .max(200)
    .describe('모든 용법을 관통하는 중심 개념. 사전 뜻 나열 금지.'),
  meaningCoreEn: z.string().trim().max(200).nullable(),
  primaryTranslations: z.array(shortText).min(1).max(4),
  meanings: z.array(meaningSchema).max(3).describe('대표 의미 1개, 정말 필요할 때만 1개 추가.'),
  sentences: z.array(sentenceSchema).max(4).describe('의미 노드의 연습 재료. 노드가 아님.'),
  collocations: z.array(collocationSchema).max(3).describe('실제로 자주 쓰는 표현 1~2개.'),
  wordFamily: z.array(wordFamilySchema).max(3).describe('참고용 파생어. 노드가 되지 않음.'),
  similarWords: z.array(similarWordSchema).max(2).describe('정말 혼동하는 단어 0~1개.'),
})

export type BrainMapDraft = z.infer<typeof brainMapDraftSchema>
export type SimilarWordDraft = z.infer<typeof similarWordSchema>

/**
 * Faults that would break the screen, so a draft carrying one is not worth
 * storing: a highlight the sentence does not contain has nothing to mark up,
 * and a cloze prompt without exactly one blank is not answerable.
 *
 * Judgement calls about quality do NOT belong here — see `draftQualityNotes`.
 * A generation costs money, and throwing one away over a matter of taste is
 * the wrong trade when a curator reviews every draft anyway.
 */
export function validateDraftConsistency(draft: BrainMapDraft): string[] {
  const problems: string[] = []

  draft.sentences.forEach((s, i) => {
    if (s.highlight && !s.text.toLowerCase().includes(s.highlight.toLowerCase())) {
      problems.push(`sentences[${i}].highlight is not a substring of the sentence`)
    }
  })

  draft.similarWords.forEach((p, i) => {
    p.questions.forEach((q, j) => {
      const blanks = q.prompt.match(/_{2,}/g)?.length ?? 0
      if (blanks !== 1) {
        problems.push(`similarWords[${i}].questions[${j}].prompt must contain exactly one blank`)
      }
    })
  })

  return problems
}

/**
 * Quality notes shown to the curator. Never block a draft.
 *
 * The rule being checked is that the sentences show more than one use of the
 * word — not that every sentence shows a different one. A word with two senses
 * and six sentences *should* repeat: three examples of each is good material,
 * and demanding uniqueness rejected exactly that.
 */
export function draftQualityNotes(draft: BrainMapDraft): string[] {
  const notes = [...densityNotes(draft)]
  const total = draft.sentences.length
  if (total < 3) return notes

  const counts = new Map<string, number>()
  for (const sentence of draft.sentences) {
    const key = sentence.targetMeaning.trim().toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  if (counts.size < 2) {
    notes.push(`예문 ${total}개가 모두 같은 용법입니다. 다른 쓰임을 보여주는 예문이 필요합니다.`)
    return notes
  }

  // Half the set on one usage is fine (two senses, evenly covered). Beyond that
  // the other senses are being crowded out.
  const limit = Math.ceil(total / 2)
  for (const [usage, count] of counts) {
    if (count > limit) {
      notes.push(`예문 ${total}개 중 ${count}개가 "${usage}" 한 용법에 몰려 있습니다.`)
    }
  }

  return notes
}

/**
 * How many cards this draft would put on the map, under the same priority the
 * map itself applies: the core meaning, one confusable, up to two collocations,
 * one further sense. Derived forms never make it.
 */
export function plannedNodeCount(draft: BrainMapDraft): number {
  const chosen =
    1 + Math.min(1, draft.similarWords.length) + Math.min(2, draft.collocations.length)
  const spareSense = draft.meanings.length > 1 && chosen < MAP_NODE_TARGET ? 1 : 0
  return chosen + spareSense
}

/**
 * Density warnings for the curator.
 *
 * Deliberately narrow. "This draft has three collocations and the map shows
 * two" is the rule working, not a defect — the review screen says so in the
 * section itself, and the extras are still drill material and still reachable
 * under the map. Warning about it on every polysemous word would train the
 * curator to ignore the warnings that matter.
 *
 * A flat importance ranking is a defect: it is the model declining to say what
 * matters, and it leaves the map unable to size or place anything.
 */
function densityNotes(draft: BrainMapDraft): string[] {
  const notes: string[] = []
  const { collocations } = draft

  if (collocations.length > 2 && collocations.every((c) => c.importance === collocations[0]!.importance)) {
    notes.push(
      `표현 ${collocations.length}개의 중요도가 모두 같아요. 맵에는 2개만 올라가니, 반드시 알아야 할 표현에 1을 주세요.`,
    )
  }

  return notes
}

export const brainMapJsonSchema = z.toJSONSchema(brainMapDraftSchema, { io: 'output' })
