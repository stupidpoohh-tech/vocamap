import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 화면에 나오는 모든 것은 저장소의 파일에서 온다.
 *
 * 예전에는 Postgres 가 콘텐츠와 학습 기록을 함께 들고 있었고, 그래서 단어
 * 목록 한 장을 그리는 데도 서버가 매번 질의하고 React 를 다시 그려야 했다.
 * 콘텐츠는 하루에 몇 번 바뀔까 말까 한 것이라 요청마다 만들 이유가 없다 —
 * 빌드할 때 한 번 읽어 화면을 미리 구워 두면 끝이다.
 *
 * 그래서 이 파일은 빌드 때만 돈다. 브라우저로 가지 않고, 서버에서 요청마다
 * 돌지도 않는다. `node:fs` 를 그냥 쓰는 것이 그 증거다.
 */

const ROOT = process.cwd()
const SETS_DIR = join(ROOT, 'content/sets')
const MAPS_DIR = join(ROOT, 'content/maps')

export type Word = {
  /** 주소에 쓰는 이름. 단어 그 자체다 — 뜻 없는 번호보다 읽기 쉽고 안 바뀐다. */
  slug: string
  lemma: string
  ko: string
  pos: string | null
  /** 이 단어가 속한 세트 이름들. 같은 단어가 여러 세트에 있을 수 있다. */
  sets: string[]
}

export type Sense = {
  ko: string
  /** 영영 풀이. */
  en: string | null
  /**
   * 그 영영 풀이 문장의 한국어 해석.
   *
   * 단어 뜻(`ko`)과 다른 것이다. "영영 뜻은 단어뜻이 아니라 영영 텍스트에
   * 대한 해석"이라는 요구로 따로 만든 칸이고, 맵에서 영영 풀이를 눌렀을 때
   * 열리는 것이 이것이다.
   */
  enKo: string | null
  note: string | null
  chunk: string | null
}
export type Sentence = { text: string; ko: string; highlight: string | null; target: string | null }
export type Collocation = { expression: string; ko: string; example: string | null }
export type FamilyMember = { lemma: string; pos: string | null; ko: string; example: string | null }

export type BrainMap = {
  lemma: string
  version: number
  coreKo: string | null
  coreEn: string | null
  meanings: Sense[]
  sentences: Sentence[]
  collocations: Collocation[]
  family: FamilyMember[]
}

export type WordSet = {
  /** 파일 이름에서 온다. 주소에 쓴다. */
  slug: string
  title: string
  words: Word[]
}

/** 주소에 쓸 수 있게. `split.mjs` 와 같은 규칙이라 파일 이름과 맞아떨어진다. */
export function slugify(value: string): string {
  return (
    value.trim().replace(/[^\p{L}\p{N}가-힣._-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'set'
  )
}

/**
 * 탭으로 나뉜 한 줄이 단어 하나다.
 *
 * 선생님이 GitHub 웹에서 표를 붙여넣는 곳이라, 형식이 느슨해야 한다. 맨 앞이
 * `#` 인 줄과 빈 줄은 건너뛰고, 탭이 여러 개 연달아 있어도 칸으로 센다.
 * 쉼표가 아니라 탭인 이유는 뜻에 쉼표가 자주 들어가기 때문이다 — "문제, 쟁점".
 */
function parseSet(file: string): { title: string; rows: Array<Omit<Word, 'sets'>> } {
  const text = readFileSync(join(SETS_DIR, file), 'utf8')
  const lines = text.split(/\r?\n/)
  // 제목은 첫 번째 주석 줄에 적어 둔다. 없으면 파일 이름을 쓴다.
  const titleLine = lines.find((l) => l.startsWith('#'))
  const title = titleLine ? titleLine.replace(/^#\s*/, '').trim() : file.replace(/\.tsv$/, '')

  const rows: Array<Omit<Word, 'sets'>> = []
  const seen = new Set<string>()
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue
    const [lemma = '', ko = '', pos = ''] = line.split('\t').map((c) => c.trim())
    if (!lemma) continue
    const slug = slugify(lemma)
    // 같은 세트에 같은 단어가 두 번 적혀 있으면 앞의 것만 쓴다. 붙여넣다 보면
    // 겹치는 일이 있고, 그때 목록에 두 줄이 되는 것보다 한 줄인 편이 낫다.
    if (seen.has(slug)) continue
    seen.add(slug)
    rows.push({ slug, lemma, ko, pos: pos || null })
  }
  return { title, rows }
}

let cached: { sets: WordSet[]; words: Word[]; maps: Map<string, BrainMap> } | null = null

function load() {
  if (cached) return cached

  const sets: WordSet[] = []
  const bySlug = new Map<string, Word>()

  const files = existsSync(SETS_DIR)
    ? readdirSync(SETS_DIR).filter((f) => f.endsWith('.tsv')).sort()
    : []

  for (const file of files) {
    const { title, rows } = parseSet(file)
    const words: Word[] = []
    for (const row of rows) {
      // 같은 단어가 여러 세트에 있으면 하나로 합치고 소속만 늘린다. 단어는
      // 하나이고 세트는 그것을 가리키는 이름표라, 둘로 갈라 두면 맵도 둘이 된다.
      const existing = bySlug.get(row.slug)
      if (existing) {
        if (!existing.sets.includes(title)) existing.sets.push(title)
        words.push(existing)
        continue
      }
      const word: Word = { ...row, sets: [title] }
      bySlug.set(row.slug, word)
      words.push(word)
    }
    sets.push({ slug: file.replace(/\.tsv$/, ''), title, words })
  }

  const maps = new Map<string, BrainMap>()
  if (existsSync(MAPS_DIR)) {
    for (const file of readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(join(MAPS_DIR, file), 'utf8'))
      maps.set(slugify(raw.lemma), {
        lemma: raw.lemma,
        version: raw.version ?? 1,
        coreKo: raw.core_ko ?? null,
        coreEn: raw.core_en ?? null,
        meanings: (raw.meanings ?? []).map((m: Record<string, unknown>) => ({
          ko: (m.ko as string) ?? '',
          en: (m.en as string) ?? null,
          enKo: (m.en_ko as string) ?? null,
          note: (m.note as string) ?? null,
          chunk: (m.chunk as string) ?? null,
        })),
        sentences: raw.sentences ?? [],
        collocations: raw.collocations ?? [],
        family: raw.family ?? [],
      })
    }
  }

  cached = { sets, words: [...bySlug.values()], maps }
  return cached
}

export const allSets = (): WordSet[] => load().sets
export const allWords = (): Word[] => load().words
export const wordBySlug = (slug: string): Word | undefined =>
  load().words.find((w) => w.slug === slug)
export const setBySlug = (slug: string): WordSet | undefined =>
  load().sets.find((s) => s.slug === slug)
export const mapFor = (slug: string): BrainMap | undefined => load().maps.get(slug)
export const hasMap = (slug: string): boolean => load().maps.has(slug)
