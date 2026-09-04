import type { BrainMapDraft } from '@/lib/ai/schema'
import type { ParsedEntry } from './wordbook'

/**
 * A typed-out wordbook entry, as a Brain Map draft.
 *
 * The same shape the model produces, so it goes through `writeDraft` unchanged
 * and every screen downstream — the map, the questions, the review editor —
 * cannot tell where the material came from. What differs is the confidence:
 * this was copied from a published book by the teacher who is going to teach
 * it, so it is written straight in as approved rather than queued for review.
 *
 * Nothing here invents. Fields the book does not print stay empty, which is
 * what keeps a wordbook map honest about being a wordbook map.
 */
export function toBrainMapDraft(entry: ParsedEntry): BrainMapDraft {
  const senses = entry.senses.filter((sense) => sense.ko.trim())

  return {
    // The book's first sense is its organising one. Calling it the "meaning
    // core" is as far as we go: a core that unifies every sense is a piece of
    // teaching the book did not print, and guessing one is how a map starts
    // telling students things nobody checked.
    meaningCoreKo: senses[0]?.ko ?? entry.lemma,
    meaningCoreEn: null,
    primaryTranslations: senses.slice(0, 4).map((sense) => sense.ko),

    meanings: senses.map((sense) => ({
      ko: sense.ko,
      enDefinition: null,
      connectionNote: '',
      exampleChunk: null,
    })),

    // Flattened, but each sentence remembers the sense it was written under —
    // that is what lets the meaning question ask which sense a sentence shows
    // rather than asking about the word in general.
    sentences: senses.flatMap((sense) =>
      sense.examples
        .filter((example) => example.ko)
        .map((example) => ({
          text: example.en,
          ko: example.ko!,
          targetMeaning: sense.ko,
          highlight: findForm(example.en, entry.lemma) ?? '',
          difficulty: 3,
        })),
    ),

    collocations: entry.collocations.map((collocation, index) => ({
      expression: collocation.expression,
      ko: collocation.ko,
      // The book prints the phrase and its meaning, not a sentence using it.
      exampleSentence: null,
      // The first two are what the map has room for; the rest are reference.
      importance: index < 2 ? 1 : 2,
    })),

    wordFamily: entry.wordFamily.map((member) => ({
      lemma: member.lemma,
      partOfSpeech: asPartOfSpeech(member.partOfSpeech),
      ko: member.ko,
      exampleSentence: null,
    })),

    // Not imported. A wordbook lists synonyms without saying how they differ,
    // and a "자주 헷갈림" node whose whole job is to teach the difference would
    // have to invent one. `entry.synonyms` is kept so the importer can report
    // what it left behind.
    similarWords: [],
  }
}

type PartOfSpeech = BrainMapDraft['wordFamily'][number]['partOfSpeech']

function asPartOfSpeech(value: string | null): PartOfSpeech {
  switch (value) {
    case 'noun':
    case 'verb':
    case 'adjective':
    case 'adverb':
      return value
    default:
      return 'other'
  }
}

/**
 * The word as the sentence actually spells it.
 *
 * The highlight has to be a substring of the sentence verbatim — it is used to
 * mark the word up on screen — and a sentence almost never uses the dictionary
 * form. `govern` appears as "governed", `celebrity` as "celebrities". Returns
 * the text as written, so the mark keeps the sentence's own capitalisation.
 */
export function findForm(sentence: string, lemma: string): string | null {
  for (const candidate of inflections(lemma)) {
    // Word boundaries, so `sue` does not match inside "issue".
    const pattern = new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'i')
    const found = pattern.exec(sentence)
    if (found) return found[0]
  }
  return null
}

/** Longest first, so "governed" wins over "govern" and marks the whole word. */
function inflections(lemma: string): string[] {
  const base = lemma.trim()
  if (!base) return []

  const forms = new Set<string>([base])
  const stem = base.slice(0, -1)

  if (base.endsWith('y')) {
    forms.add(`${stem}ies`)
    forms.add(`${stem}ied`)
  }
  if (base.endsWith('e')) {
    forms.add(`${base}s`)
    forms.add(`${base}d`)
    forms.add(`${stem}ing`)
  } else {
    forms.add(`${base}s`)
    forms.add(`${base}es`)
    forms.add(`${base}ed`)
    forms.add(`${base}ing`)
  }

  return [...forms].sort((a, b) => b.length - a.length)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
