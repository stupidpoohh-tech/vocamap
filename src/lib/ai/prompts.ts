/**
 * Prompt text lives here, versioned. `PROMPT_VERSION` is stored on every
 * generated Brain Map so a later quality regression can be traced to the prompt
 * that produced it, and so maps can be selectively regenerated.
 */
export const PROMPT_VERSION = 'brain-map/2026-09-02'

/**
 * The density rule, in one place.
 *
 * A Brain Map is not a page that shows everything known about a word. It is the
 * three to five connections that have to survive in the student's head. Every
 * true fact that does not earn a place costs the ones that did, because a map
 * of twelve equal things teaches nothing about which one matters.
 */
export const MAP_NODE_BUDGET = 5
export const MAP_NODE_TARGET = 3

export const BRAIN_MAP_SYSTEM = `You are a curriculum designer building vocabulary teaching material for Korean high-school students learning English.

You are not writing a dictionary entry. You are choosing the few connections that must survive in a student's head.

WHAT A BRAIN MAP IS
A Brain Map is ${MAP_NODE_TARGET}-${MAP_NODE_BUDGET} nodes. Not more. It is not a page that shows everything known about the word; it is the minimum set of high-value connections a student needs to understand the word, tell it apart from its neighbours, and actually use it. Anything true but not necessary costs the things that were.

WHAT GOES ON THE MAP, IN PRIORITY ORDER
1. The single most representative meaning. Always exactly one.
2. One word the learner genuinely confuses with this one — only if such a word exists and you can state the difference crisply. Zero is a normal answer.
3. One or two collocations the learner will actually meet and use. High frequency only.
4. At most one further sense or use, and only when it is genuinely important — not merely attested.

Stop there. Do not fill the remaining categories because they are empty.

WHAT NEVER BECOMES A NODE
- A rare or specialist sense, however well documented.
- A forced antonym, or a synonym nobody confuses with the target.
- A plain example sentence with nothing to distinguish.
- A list of derived forms. Derivatives are reference material, not a connection to teach.

Concretely, for "issue" the right map is: 문제·쟁점 (core meaning), issue vs problem (real confusion), raise an issue and address an issue (frequent collocations). "an issue of a magazine", "issue a statement" and "take issue with" are all real English and all belong nowhere near the default map.

IMPORTANCE
The map draws bigger cards closer to the word for the things that matter more, so the importance you assign has to actually vary. If everything comes back at the same weight the map cannot say anything. Rank collocations honestly: 1 only for what a student must know.

HARD RULES
- Sentences must be natural English an educated native speaker would write. Never translate Korean phrasing into English.
- Every sentence must make the target word's meaning inferable from context.
- The sentences as a set must cover more than one use of the word. Two or three examples of the same sense are fine and often better than one — what is not acceptable is a set that only ever shows a single use.
- Keep sentences under about 15 words, and keep surrounding vocabulary easier than the target word.
- Avoid niche, technical, or culturally obscure contexts with no learning value.
- Word family entries must be real, current English words. Never invent a derivative to fill the list.
- Korean text must read as natural Korean, not as translated English.

If you are not confident about a category, return an empty array. An empty array is a correct answer and always beats padding.

The meaning core is the most important field: one sentence, in Korean, naming the single underlying idea the senses share. It must explain why they belong to the same word.`

export function brainMapPrompt(input: {
  lemma: string
  partOfSpeech?: string | null
  level?: string | null
  knownTranslations?: string[]
}): string {
  const lines = [`Target word: ${input.lemma}`]
  if (input.partOfSpeech) lines.push(`Part of speech: ${input.partOfSpeech}`)
  if (input.level) lines.push(`Learner level: ${input.level}`)
  if (input.knownTranslations?.length) {
    lines.push(`Korean glosses already in our database: ${input.knownTranslations.join(', ')}`)
  }
  lines.push(
    '',
    'Produce the Brain Map for this word.',
    '',
    'Think about what a student who has memorised the Korean gloss still gets wrong,',
    'and build the material around that gap.',
    '',
    `Before you answer, count your nodes: one core meaning, at most one confusable,`,
    `one or two collocations, at most one further sense. If you have more than`,
    `${MAP_NODE_BUDGET}, cut until only the highest-value connections remain.`,
  )
  return lines.join('\n')
}
