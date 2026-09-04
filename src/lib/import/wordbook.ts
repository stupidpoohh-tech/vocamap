/**
 * Turns a page of a printed wordbook, typed out, into Brain Map drafts.
 *
 * The premise is that a tutor preparing a test already has the material: the
 * senses, the example, the collocations are all printed on the page in front of
 * them. Asking a model to invent them again costs money, takes time, and
 * produces something that has to be checked against the book anyway. Typing the
 * page is the cheaper and more faithful path, so this parser exists to make
 * typing it as close to transcription as possible.
 *
 * Deliberately line-based and prefix-driven, in the order the page itself
 * reads: headword, senses, example, collocations, derived forms. The prefixes
 * are the ones the book already uses.
 *
 * Pure — no database, no network — so the whole format is testable.
 */

export type ParsedSense = {
  partOfSpeech: string | null
  ko: string
  /** Examples that belong to this sense, in the order they were written. */
  examples: Array<{ en: string; ko: string | null }>
}

export type ParsedEntry = {
  lemma: string
  senses: ParsedSense[]
  collocations: Array<{ expression: string; ko: string }>
  wordFamily: Array<{ lemma: string; partOfSpeech: string | null; ko: string }>
  /** Kept so the importer can say what it chose not to use. Not imported. */
  synonyms: Array<{ lemma: string; ko: string | null }>
  /** First line of the block, for error messages. */
  line: number
}

export type ParseProblem = { line: number; text: string; message: string }

export type ParseResult = { entries: ParsedEntry[]; problems: ParseProblem[] }

/**
 * Part-of-speech marks, as a wordbook writes them.
 *
 * A sense line is recognised by one of these followed by a full stop, which is
 * what keeps a sense apart from a headword: both are otherwise just text.
 */
const PART_OF_SPEECH: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  a: 'adjective',
  adj: 'adjective',
  ad: 'adverb',
  adv: 'adverb',
  prep: 'preposition',
  conj: 'conjunction',
  pron: 'pronoun',
  명: 'noun',
  동: 'verb',
  형: 'adjective',
  부: 'adverb',
}

const SENSE_LINE = /^([A-Za-z가-힣]{1,4})\.\s*(.+)$/
/** `뜻:` and friends, for anyone who would rather write the label out. */
const LABELLED_SENSE = /^(뜻|의미)\s*[:：]\s*(.+)$/

export function parseWordbook(input: string): ParseResult {
  const problems: ParseProblem[] = []
  const entries: ParsedEntry[] = []

  for (const block of splitBlocks(input)) {
    const entry = parseBlock(block, problems)
    if (entry) entries.push(entry)
  }

  return { entries, problems }
}

type Line = { text: string; number: number }

/** Blank lines separate words. Comments and stray whitespace never survive. */
function splitBlocks(input: string): Line[][] {
  const blocks: Line[][] = []
  let current: Line[] = []

  input.split('\n').forEach((raw, index) => {
    const text = raw.trim()
    if (!text || text.startsWith('#')) {
      if (text.startsWith('#')) return
      if (current.length) blocks.push(current)
      current = []
      return
    }
    current.push({ text, number: index + 1 })
  })

  if (current.length) blocks.push(current)
  return blocks
}

function parseBlock(lines: Line[], problems: ParseProblem[]): ParsedEntry | null {
  const head = lines[0]!
  // A headword can carry the book's pronunciation; it is not vocabulary, so it
  // goes no further than this line.
  const lemma = head.text.replace(/\[[^\]]*\]/g, '').replace(/\/[^/]*\//g, '').trim()

  if (!lemma) {
    problems.push({ line: head.number, text: head.text, message: '단어를 읽을 수 없습니다.' })
    return null
  }
  if (/[가-힣]/.test(lemma)) {
    problems.push({
      line: head.number,
      text: head.text,
      message: '첫 줄은 영어 표제어여야 합니다. 빈 줄로 단어를 구분했는지 확인해 주세요.',
    })
    return null
  }

  const entry: ParsedEntry = {
    lemma,
    senses: [],
    collocations: [],
    wordFamily: [],
    synonyms: [],
    line: head.number,
  }

  for (const line of lines.slice(1)) {
    const { text, number } = line
    const marker = text[0]!
    const rest = text.slice(1).trim()

    if (marker === '-' || marker === '·') {
      const sense = currentSense(entry)
      if (!sense) {
        problems.push({ line: number, text, message: '예문보다 뜻이 먼저 와야 합니다.' })
        continue
      }
      if (!rest) {
        problems.push({ line: number, text, message: '예문이 비어 있습니다.' })
        continue
      }
      sense.examples.push({ en: rest, ko: null })
      continue
    }

    if (marker === '=') {
      // Binds to the example above it — that is the whole reason `=` is its own
      // line rather than a field on `-`: a sentence and its translation are
      // long, and one line each is what makes a block readable.
      const sense = currentSense(entry)
      const example = sense?.examples[sense.examples.length - 1]
      if (!example) {
        problems.push({ line: number, text, message: '해석 위에 예문(-)이 없습니다.' })
        continue
      }
      example.ko = rest || null
      continue
    }

    if (marker === '+' || marker === '⊕') {
      const [expression, ko] = splitFields(rest)
      if (!expression || !ko) {
        problems.push({ line: number, text, message: '연어는 "표현 / 뜻" 형태로 적어 주세요.' })
        continue
      }
      entry.collocations.push({ expression, ko })
      continue
    }

    if (marker === '*') {
      const [memberLemma, a, b] = splitFields(rest)
      // "lemma / 뜻" and "lemma / 품사 / 뜻" both read naturally, so both work.
      const ko = b ?? a
      const partOfSpeech = b ? normalisePos(a) : null
      if (!memberLemma || !ko) {
        problems.push({ line: number, text, message: '파생어는 "단어 / 뜻" 형태로 적어 주세요.' })
        continue
      }
      entry.wordFamily.push({ lemma: memberLemma, partOfSpeech, ko })
      continue
    }

    if (marker === '≒' || marker === '~') {
      const [synLemma, ko] = splitFields(rest)
      if (synLemma) entry.synonyms.push({ lemma: synLemma, ko: ko ?? null })
      continue
    }

    const labelled = LABELLED_SENSE.exec(text)
    if (labelled) {
      entry.senses.push({ partOfSpeech: null, ko: labelled[2]!.trim(), examples: [] })
      continue
    }

    const sense = SENSE_LINE.exec(text)
    if (sense && PART_OF_SPEECH[sense[1]!.toLowerCase()]) {
      entry.senses.push({
        partOfSpeech: PART_OF_SPEECH[sense[1]!.toLowerCase()]!,
        ko: sense[2]!.trim(),
        examples: [],
      })
      continue
    }

    problems.push({
      line: number,
      text,
      message: '알 수 없는 줄입니다. 뜻은 "n. 뜻", 예문은 "-", 해석은 "=" 으로 시작합니다.',
    })
  }

  if (!entry.senses.length) {
    problems.push({
      line: head.number,
      text: head.text,
      message: `${lemma}: 뜻이 없습니다. "n. 후보, 출마자" 처럼 품사와 뜻을 적어 주세요.`,
    })
    return null
  }

  return entry
}

function currentSense(entry: ParsedEntry): ParsedSense | undefined {
  return entry.senses[entry.senses.length - 1]
}

/** `/` separates fields; a Korean gloss never contains one, an expression may. */
function splitFields(value: string): string[] {
  return value.split('/').map((part) => part.trim()).filter(Boolean)
}

function normalisePos(value: string | undefined): string | null {
  if (!value) return null
  return PART_OF_SPEECH[value.replace(/\.$/, '').toLowerCase()] ?? null
}
