import { z } from 'zod'

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

export const brainMapDraftSchema = z.object({
  meaningCoreKo: z
    .string()
    .trim()
    .min(5)
    .max(200)
    .describe('모든 용법을 관통하는 중심 개념. 사전 뜻 나열 금지.'),
  meaningCoreEn: z.string().trim().max(200).nullable(),
  primaryTranslations: z.array(shortText).min(1).max(4),
  meanings: z.array(meaningSchema).max(5),
  sentences: z.array(sentenceSchema).max(6),
  collocations: z.array(collocationSchema).max(5),
  wordFamily: z.array(wordFamilySchema).max(6),
  similarWords: z.array(similarWordSchema).max(3),
})

export type BrainMapDraft = z.infer<typeof brainMapDraftSchema>
export type SimilarWordDraft = z.infer<typeof similarWordSchema>

/**
 * Checks the schema cannot express: cross-field consistency. A `highlight` that
 * does not occur in its sentence would break the UI, and a cloze prompt without
 * a blank is not answerable.
 */
export function validateDraftConsistency(draft: BrainMapDraft): string[] {
  const problems: string[] = []

  draft.sentences.forEach((s, i) => {
    if (s.highlight && !s.text.toLowerCase().includes(s.highlight.toLowerCase())) {
      problems.push(`sentences[${i}].highlight is not a substring of the sentence`)
    }
  })

  const seenMeanings = new Set<string>()
  draft.sentences.forEach((s, i) => {
    const key = s.targetMeaning.toLowerCase()
    if (seenMeanings.has(key) && draft.sentences.length > 2) {
      problems.push(`sentences[${i}] repeats usage "${s.targetMeaning}"`)
    }
    seenMeanings.add(key)
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

export const brainMapJsonSchema = z.toJSONSchema(brainMapDraftSchema, { io: 'output' })
