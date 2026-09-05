import { z } from 'zod'

/**
 * Pronunciation, in bulk.
 *
 * A student who cannot say a word has not learned it, and the wordbooks these
 * words come from print no phonetics — so the symbols have to come from
 * somewhere. One call covers a whole batch rather than one call per word: the
 * task is a lookup, the answers are short, and a set of forty words is the unit
 * the tutor works in.
 */
export const PRONUNCIATION_SYSTEM = `You transcribe English words into IPA for Korean high-school learners.

RULES
- General American, broad transcription. No slashes, no brackets, no stress-free shortcuts: mark primary stress with ˈ and secondary with ˌ.
- One transcription per word, the most common pronunciation. Do not list variants.
- Use ordinary IPA symbols: ə ɪ iː ʊ uː e æ ʌ ɑː ɔː ɜːr ər aɪ aʊ ɔɪ eɪ oʊ θ ð ʃ ʒ tʃ dʒ ŋ.
- Return every word you were given, spelled exactly as given, in the same order.
- For a multi-word phrase, transcribe the whole phrase with a space between words.`

export function pronunciationPrompt(lemmas: string[]): string {
  return `Transcribe each of these ${lemmas.length} entries.\n\n${lemmas.map((l) => `- ${l}`).join('\n')}`
}

export const pronunciationBatchSchema = z.object({
  entries: z
    .array(
      z.object({
        lemma: z.string().min(1).max(80).describe('the entry exactly as it was given'),
        ipa: z.string().min(1).max(80).describe('IPA, without slashes or brackets'),
      }),
    )
    .min(1),
})

export type PronunciationBatch = z.infer<typeof pronunciationBatchSchema>

/** Strips the wrapping a model adds anyway, so the column stores bare IPA. */
export function cleanIpa(value: string): string | null {
  const trimmed = value
    .trim()
    .replace(/^[/[]+/, '')
    .replace(/[/\]]+$/, '')
    .trim()
  if (!trimmed) return null
  // A model that answers in prose, or respells the word in plain letters, has
  // not answered — and a sentence in the phonetics slot is worse than an empty
  // one. Real transcriptions are short, unpunctuated, and break their plain
  // letters up with IPA symbols within a few characters.
  if (trimmed.length > 60) return null
  if (/[.,;:!?()"]/.test(trimmed)) return null
  if (/[a-zA-Z]{8,}/.test(trimmed)) return null
  return trimmed
}
