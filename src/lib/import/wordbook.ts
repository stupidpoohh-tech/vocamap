/**
 * Turns a page of a printed wordbook, typed out, into Brain Map material.
 *
 * The premise is that a tutor preparing a test already has the material: the
 * senses, the example, the collocations are all printed on the page in front of
 * them. Asking a model to invent them again costs money, takes time, and
 * produces something that has to be checked against the book anyway. Typing the
 * page is the cheaper and more faithful path, so this parser exists to make
 * typing it as close to transcription as possible.
 *
 * It reads the shape a tutor actually types rather than a shape invented for
 * it. In that shape one marker, `*`, carries four different things — the
 * example sentence, a synonym, a collocation, a derived form — because that is
 * how the page reads to a person. So the marker is not what decides; the
 * content is:
 *
 *   no Korean in the line → the example sentence
 *   left side has a space → a collocation   (`impulse buying / 충동 구매`)
 *   left side is one word, sharing a stem with the headword
 *                       → a derived form    (`impulsive / a. 충동적인`)
 *   left side is one word, sharing nothing
 *                       → a synonym         (`rule / v. 다스리다`)
 *
 * Korean rather than the separator is what tells a sentence from a term: every
 * term the book prints carries a gloss, and no English sentence does. Reading
 * the separator instead filed "He works the 9/5 shift." as a collocation.
 *
 * Explicit markers still win where someone writes them: `+` is always a
 * collocation and `≒` always a synonym.
 *
 * Pure — no database, no network — so the whole format is testable.
 */

export type ParsedSense = {
  partOfSpeech: string | null
  ko: string
  /** The English definition, when the book prints one. */
  enDefinition: string | null
  /** Examples that belong to this sense, in the order they were written. */
  examples: Array<{ en: string; ko: string | null }>
}

export type ParsedEntry = {
  lemma: string
  /** As the book prints it, brackets stripped. Null when it printed none. */
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

/** Part-of-speech marks, as a wordbook writes them. */
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
  전: 'preposition',
  접: 'conjunction',
  대: 'pronoun',
}

/** `12. conversion` — how a test range is usually numbered. */
const NUMBERED_HEADWORD = /^\d+\s*[.)]\s*(.+)$/
const SENSE_LINE = /^([A-Za-z가-힣]{1,4})\.\s*(.+)$/
const LABELLED_SENSE = /^(뜻|의미)\s*[:：]\s*(.+)$/
const ITEM_MARKER = /^(?:[*\-·+≒~⊕↔]|cf\.|syn\.|ant\.)/i
/** Markers that name a relation we read but do not import. */
const RELATION_MARKER = /^(?:≒|~|↔|cf\.|syn\.|ant\.)/i

/**
 * How much of a word has to match the headword for it to count as derived.
 *
 * Four letters separates `refrigerate` from `fridge` and `celebration` from
 * `fame`, while leaving `abnormal` and `inadequate` on the synonym side — which
 * is where the books themselves group them, since what they teach there is a
 * contrast, not a family.
 */
const STEM_LENGTH = 4

export function parseWordbook(input: string): ParseResult {
  const table = parseTable(input)
  if (table) return table

  const problems: ParseProblem[] = []
  const entries: ParsedEntry[] = []

  for (const block of splitBlocks(input)) {
    const entry = parseBlock(block, problems)
    if (entry) entries.push(entry)
  }

  return { entries, problems }
}

/* ─────────────────────────────── a table ─────────────────────────────── */

/**
 * The other shape a vocabulary list arrives in: a table.
 *
 * A teacher's exam range is often a spreadsheet or a document table — 어휘,
 * 영영 풀이, 의미, one word a row — and pasting one into a parser that expects
 * "1. word / v. 뜻" reads no words at all and reports a failure on the header.
 *
 * Read column by column rather than by position, because the position is not
 * dependable: some lists number their rows and some do not, and the columns
 * come in whatever order the teacher typed them. What is dependable is what
 * each cell *is* — one is Korean, one is a word, one is a sentence about that
 * word — so that is what is matched on.
 */
function parseTable(input: string): ParseResult | null {
  const rows: Array<{ cells: string[]; number: number }> = []
  let candidates = 0

  input.split('\n').forEach((raw, index) => {
    const cells = splitCells(raw)
    if (!cells) return
    candidates += 1
    if (isSeparatorRow(cells) || isHeaderRow(cells)) return
    rows.push({ cells, number: index + 1 })
  })

  // Not a table. One stray line with a pipe in it is not a reason to abandon
  // the format the rest of the paste is written in.
  if (candidates < 2 || rows.length < 1) return null

  const problems: ParseProblem[] = []
  const entries: ParsedEntry[] = []

  for (const row of rows) {
    const entry = parseRow(row.cells, row.number, problems)
    if (entry) entries.push(entry)
  }

  return entries.length ? { entries, problems } : null
}

/**
 * The cells of one row, or null if the line is not one.
 *
 * Pipes and tabs both, because the same table reaches the clipboard as
 * `| a | b |` from a document and as tab-separated text from a spreadsheet.
 * Anything else — a page number, an image placeholder, a stray note — has
 * neither and is simply not a row.
 */
function splitCells(raw: string): string[] | null {
  const line = raw.trim()
  if (!line) return null

  const source = line.includes('\t')
    ? line.split('\t')
    : line.includes('|')
      ? line.replace(/^\||\|$/g, '').split('|')
      : null
  if (!source) return null

  const cells = source.map((cell) => cell.trim())
  // Two cells is a word and a gloss at best, which the line format already
  // reads. A table worth this path has the definition column too.
  return cells.filter(Boolean).length >= 2 ? cells : null
}

/** `|---|:--:|---|` — the rule a markdown table draws under its header. */
function isSeparatorRow(cells: string[]): boolean {
  const filled = cells.filter(Boolean)
  return filled.length > 0 && filled.every((cell) => /^:?-{2,}:?$/.test(cell))
}

/** The row that names the columns rather than filling them. */
function isHeaderRow(cells: string[]): boolean {
  return cells.some((cell) => /^(어휘|단어|표제어|영영\s*풀이|영영\s*뜻|영영|의미|뜻|해석)$/.test(cell))
}

/**
 * One row into one entry.
 *
 * The cells are told apart by what they contain, not by where they sit:
 *
 *   - a bare number is the row's index — dropped
 *   - Korean, once a part-of-speech mark is taken off the front, is the gloss
 *   - of the English cells that remain, the shorter is the word and the longer
 *     is its definition
 *
 * The last rule is what makes `sign up` / `to agree to take part in an
 * organized activity` come out the right way round without being told which
 * column is which, and it holds for `in front of` and `according to` too.
 */
function parseRow(cells: string[], line: number, problems: ParseProblem[]): ParsedEntry | null {
  let partOfSpeech: string | null = null
  let ko: string | null = null
  const english: string[] = []

  for (const cell of cells) {
    if (!cell || /^\d+[.)]?$/.test(cell)) continue

    const prefix = leadingPartOfSpeech(cell)
    const body = prefix ? cell.slice(prefix.length).trim() : cell
    if (!body) continue

    if (prefix && !partOfSpeech) {
      partOfSpeech = PART_OF_SPEECH[prefix.trim().replace(/\.$/, '').toLowerCase()] ?? null
    }

    // A second Korean cell is a second gloss, joined rather than dropped.
    if (/[가-힣]/.test(body)) ko = ko ? `${ko}, ${body}` : body
    else english.push(body)
  }

  if (!english.length) {
    problems.push({ line, text: cells.join(' | '), message: '이 줄에서 영어 단어를 찾지 못했습니다.' })
    return null
  }

  const byLength = [...english].sort((a, b) => wordCount(a) - wordCount(b))
  const lemma = byLength[0]!
  const enDefinition = byLength.length > 1 ? byLength[byLength.length - 1]! : null

  if (!ko && !enDefinition) {
    problems.push({ line, text: cells.join(' | '), message: `"${lemma}" 에 뜻이 없습니다.` })
    return null
  }

  return {
    lemma,
    // A row with no Korean still teaches something: the English definition is
    // the gloss then, rather than the entry being thrown away.
    senses: [{ partOfSpeech, ko: ko ?? enDefinition!, enDefinition, examples: [] }],
    collocations: [],
    wordFamily: [],
    synonyms: [],
    line,
  }
}

/**
 * `명 `, `v. `, `adj. ` at the head of a cell, as the book abbreviates it.
 * Returns the whole prefix including its punctuation and space, so the caller
 * can take it off and be left with the cell's actual content.
 *
 * An English mark must carry its dot. Without that rule the `a` of "a large
 * number or amount of people or things" is read as 형용사 and eaten, leaving a
 * definition that starts mid-phrase. Books write `v.` and `adj.` with the dot
 * and 명·동·형 without one, so requiring it costs nothing and settles the only
 * ambiguity there is.
 */
function leadingPartOfSpeech(cell: string): string | null {
  const match = /^([A-Za-z가-힣]{1,4})(\.?)\s+/.exec(cell)
  const mark = match?.[1]?.toLowerCase()
  if (!mark || !(mark in PART_OF_SPEECH)) return null
  if (/^[a-z]+$/.test(mark) && match![2] !== '.') return null
  return match![0]
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length
}

type Line = { text: string; number: number }

/**
 * Where one word ends and the next begins.
 *
 * A numbered list says so outright, and then blank lines are free to separate
 * groups *inside* a word — which is what a tutor's own notes do. Without
 * numbering, a blank line is the only signal there is, so it becomes the
 * separator again.
 */
function splitBlocks(input: string): Line[][] {
  const lines: Line[] = input
    .split('\n')
    .map((raw, index) => ({ text: raw.trim(), number: index + 1 }))
    .filter((line) => !line.text.startsWith('#'))

  const numbered = lines.some((line) => isNumberedHeadword(line.text))
  const blocks: Line[][] = []
  let current: Line[] = []

  for (const line of lines) {
    if (!line.text) {
      if (!numbered && current.length) {
        blocks.push(current)
        current = []
      }
      continue
    }
    if (numbered && isNumberedHeadword(line.text) && current.length) {
      blocks.push(current)
      current = []
    }
    current.push(line)
  }

  if (current.length) blocks.push(current)
  return blocks
}

function isNumberedHeadword(text: string): boolean {
  const match = NUMBERED_HEADWORD.exec(text)
  if (!match) return false
  // "1. 계획" is a numbered gloss, not a headword; a headword is English.
  return !/[가-힣]/.test(match[1]!) && /[A-Za-z]/.test(match[1]!)
}

function parseBlock(lines: Line[], problems: ParseProblem[]): ParsedEntry | null {
  const head = lines[0]!
  const withoutNumber = NUMBERED_HEADWORD.exec(head.text)?.[1] ?? head.text

  // A headword can carry the book's phonetics, in brackets or slashes. They
  // are dropped rather than read — nothing shows them any more — but they still
  // have to come off the headword or the lemma would be the whole line.
  const lemma = withoutNumber
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\/[^/]*\//g, '')
    .trim()

  if (!lemma) {
    problems.push({ line: head.number, text: head.text, message: '단어를 읽을 수 없습니다.' })
    return null
  }
  if (/[가-힣]/.test(lemma)) {
    problems.push({
      line: head.number,
      text: head.text,
      message: '단어 첫 줄은 영어 표제어여야 합니다. 번호나 빈 줄로 단어를 구분했는지 확인해 주세요.',
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

    if (text.startsWith('=')) {
      // Binds to the example above it — that is the whole reason `=` is its own
      // line: a sentence and its translation are long, and one line each is
      // what makes a block readable.
      const sense = currentSense(entry)
      const example = sense?.examples[sense.examples.length - 1]
      if (!example) {
        problems.push({ line: number, text, message: '해석 위에 예문이 없습니다.' })
        continue
      }
      example.ko = text.slice(1).trim() || null
      continue
    }

    const item = ITEM_MARKER.exec(text)
    if (item) {
      readItem(entry, item[0], text.slice(item[0].length).trim(), { line: number, text }, problems)
      continue
    }

    const labelled = LABELLED_SENSE.exec(text)
    if (labelled) {
      entry.senses.push({ partOfSpeech: null, ko: labelled[2]!.trim(), enDefinition: null,
      examples: [] })
      continue
    }

    const sense = SENSE_LINE.exec(text)
    if (sense && PART_OF_SPEECH[sense[1]!.toLowerCase()]) {
      entry.senses.push({
        partOfSpeech: PART_OF_SPEECH[sense[1]!.toLowerCase()]!,
        ko: sense[2]!.trim(),
        enDefinition: null,
      examples: [],
      })
      continue
    }

    // A bare Korean line before anything else is the gloss, written without a
    // part-of-speech mark. Only before anything else: later on it is a line
    // that lost its marker, and guessing there would bury the mistake.
    if (!entry.senses.length && hasKorean(text)) {
      entry.senses.push({ partOfSpeech: null, ko: text, enDefinition: null,
      examples: [] })
      continue
    }

    problems.push({
      line: number,
      text,
      message: '알 수 없는 줄입니다. 뜻은 "n. 뜻", 예문과 표현은 "*", 해석은 "=" 으로 시작합니다.',
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

/** One `*` line, sorted into whichever of the four things it actually is. */
function readItem(
  entry: ParsedEntry,
  marker: string,
  rest: string,
  at: { line: number; text: string },
  problems: ParseProblem[],
): void {
  if (!rest) {
    problems.push({ ...at, message: '내용이 비어 있습니다.' })
    return
  }

  const fields = rest.split('/').map((part) => part.trim()).filter(Boolean)

  // No gloss: this is the example sentence, whatever punctuation it contains.
  if (fields.length < 2 || !hasKorean(rest)) {
    if (marker === '+' || marker === '⊕' || RELATION_MARKER.test(marker)) {
      problems.push({ ...at, message: '"표현 / 뜻" 형태로 적어 주세요.' })
      return
    }
    const sense = currentSense(entry)
    if (!sense) {
      problems.push({ ...at, message: '예문보다 뜻이 먼저 와야 합니다.' })
      return
    }
    sense.examples.push({ en: rest, ko: null })
    return
  }

  const [left, ...tail] = fields as [string, ...string[]]
  const right = tail.join(' / ')

  if (RELATION_MARKER.test(marker)) {
    entry.synonyms.push({ lemma: left, ko: stripPos(right).ko || null })
    return
  }
  if (marker === '+' || marker === '⊕') {
    entry.collocations.push({ expression: left, ko: stripPos(right).ko })
    return
  }

  // A phrase is a collocation; a single word is a relative of the headword or
  // a word that merely means the same thing.
  if (/\s/.test(left)) {
    entry.collocations.push({ expression: left, ko: stripPos(right).ko })
    return
  }

  const { partOfSpeech, ko } = stripPos(right)
  if (sharesStem(entry.lemma, left)) {
    entry.wordFamily.push({ lemma: left, partOfSpeech, ko })
  } else {
    entry.synonyms.push({ lemma: left, ko: ko || null })
  }
}

/** `a. 충동적인` → adjective + 충동적인. A gloss with no mark keeps its text. */
function stripPos(value: string): { partOfSpeech: string | null; ko: string } {
  const match = SENSE_LINE.exec(value)
  const mapped = match ? PART_OF_SPEECH[match[1]!.toLowerCase()] : undefined
  if (match && mapped) return { partOfSpeech: mapped, ko: match[2]!.trim() }
  return { partOfSpeech: null, ko: value }
}

function sharesStem(headword: string, other: string): boolean {
  const a = letters(headword)
  const b = letters(other)
  if (!a || !b) return false
  // One of them too short to have a stem: ask for containment instead.
  if (a.length < STEM_LENGTH || b.length < STEM_LENGTH) {
    return a.startsWith(b) || b.startsWith(a)
  }
  return a.slice(0, STEM_LENGTH) === b.slice(0, STEM_LENGTH)
}

function hasKorean(value: string): boolean {
  return /[가-힣]/.test(value)
}

function letters(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

function currentSense(entry: ParsedEntry): ParsedSense | undefined {
  return entry.senses[entry.senses.length - 1]
}
