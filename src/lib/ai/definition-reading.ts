import { z } from 'zod'

/**
 * Turning English definitions into Korean, in bulk.
 *
 * The map puts an English definition in front of the student and holds back
 * what it says until they ask. That reveal is only worth pressing if what
 * comes back is the definition's own reading — the word's gloss is already on
 * the map and says nothing about whether the English was understood.
 *
 * A teacher's list rarely carries that column, and typing fifty of them by
 * hand is the reason the feature would go unused. One call covers a batch:
 * the task is translation, the answers are one line each, and a range is the
 * unit the tutor works in.
 *
 * Paid for once per definition, like every other generated thing here — the
 * map is shared, so the cost follows the number of words and not the number
 * of students.
 */
export const DEFINITION_READING_SYSTEM = `You translate English dictionary definitions into Korean for high-school learners.

WHAT YOU ARE TRANSLATING
Each entry is a definition of an English word, as a learner's dictionary writes it — "a quality or ability that gives you an advantage", "to agree to take part in an organized activity". You render that phrase in Korean.

RULES
- Translate the definition itself. Do NOT return the headword's dictionary gloss: for "a small round mark" the answer is "작고 둥근 표시", never "점".
- Keep the grammatical shape. A noun phrase stays a noun phrase; a definition that begins "to ..." becomes a "~하다" phrase.
- Natural Korean a student would read aloud, not a word-for-word transfer of English structure.
- One line per entry. No brackets, no alternatives, no notes, no quotation marks.
- Do not explain, expand, or add anything the definition does not say.
- Return every entry you were given, with its number, in the same order.`

export function definitionReadingPrompt(
  entries: Array<{ id: string; lemma: string; definition: string }>,
): string {
  const lines = entries.map(
    (entry, index) => `${index + 1}. (${entry.lemma}) ${entry.definition}`,
  )
  return `Translate each of these ${entries.length} definitions.\n\n${lines.join('\n')}`
}

export const definitionReadingBatchSchema = z.object({
  entries: z
    .array(
      z.object({
        number: z.number().int().min(1).describe('the number the entry was given'),
        ko: z.string().min(1).max(240).describe('the definition in Korean'),
      }),
    )
    .min(1),
})

export type DefinitionReadingBatch = z.infer<typeof definitionReadingBatchSchema>

/**
 * Whether a returned line is a translation of the definition at all.
 *
 * The failure worth catching is the model answering with the headword's gloss
 * — "점" for "a small round mark" — which is the one thing this exists to
 * avoid and is indistinguishable from a correct answer to any length or
 * character check. It is caught by comparing against the gloss we already
 * hold. Everything else here is the ordinary shape of a wrong answer: English
 * left untranslated, or a sentence of commentary instead of a rendering.
 */
export function cleanReading(value: string, gloss: string | null): string | null {
  const trimmed = value.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  if (!trimmed) return null
  if (!/[가-힣]/.test(trimmed)) return null

  // Mostly Latin letters means the definition came back barely touched.
  const latin = (trimmed.match(/[A-Za-z]/g) ?? []).length
  if (latin > trimmed.length / 3) return null

  if (gloss && sameText(trimmed, gloss)) return null
  return trimmed
}

function sameText(a: string, b: string): boolean {
  const bare = (value: string) => value.replace(/[\s,·]/g, '')
  return bare(a) === bare(b)
}
