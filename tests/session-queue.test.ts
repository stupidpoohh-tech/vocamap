import { beforeEach, describe, expect, it } from 'vitest'
import type { Candidate } from '@/learning/session'

/**
 * 시험이 무엇을 물을지.
 *
 * 예전에는 서버가 정했고(`buildScopedQueue`, `buildQuestions`), 그 규칙에는
 * 시험이 붙어 있었다. 규칙을 브라우저로 옮겼으니 시험도 따라온다 — 숫자는
 * 그대로다: 하루 복습 60, 새 단어 10, 목록 시험 300.
 */

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) { this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

const store = () => import('@/learning/store')
const session = () => import('@/learning/session')

const word = (n: number, set = 'DAY1'): Candidate => ({
  slug: `w${n}`,
  lemma: `word${n}`,
  ko: `뜻${n}`,
  sets: [set],
})

const WORDS = Array.from({ length: 80 }, (_, i) => word(i))

describe('범위', () => {
  it('담은 것만 묻는다', async () => {
    const { toggleBookmark, read } = await store()
    const { buildQueue } = await session()
    toggleBookmark('w3')
    toggleBookmark('w7')
    const queue = buildQueue(WORDS, read(), { scope: 'saved', directions: ['en_ko'] })
    expect(queue.map((q) => q.word.slug)).toEqual(['w3', 'w7'])
  })

  it('틀린 적 있는 것만 묻는다', async () => {
    const { recordAnswer, read } = await store()
    const { buildQueue } = await session()
    recordAnswer('w5', 'en_ko', { correct: false })
    recordAnswer('w6', 'en_ko', { correct: true })
    const queue = buildQueue(WORDS, read(), { scope: 'wrong', directions: ['en_ko'] })
    expect(queue.map((q) => q.word.slug)).toEqual(['w5'])
  })

  it('세트를 겨누면 그 세트만 나온다', async () => {
    const { read } = await store()
    const { buildQueue } = await session()
    const mixed = [word(1, 'DAY1'), word(2, 'DAY2'), word(3, 'DAY1')]
    const queue = buildQueue(mixed, read(), { scope: 'all', set: 'DAY1', directions: ['en_ko'] })
    expect(queue.map((q) => q.word.slug)).toEqual(['w1', 'w3'])
  })

  it('두 방향이면 단어마다 두 번 나온다', async () => {
    const { read } = await store()
    const { buildQueue } = await session()
    const queue = buildQueue([word(1)], read(), { scope: 'all' })
    expect(queue.map((q) => q.direction)).toEqual(['en_ko', 'ko_en'])
  })
})

describe('오늘의 복습', () => {
  it('담지 않고 풀지도 않은 단어는 돌아오지 않는다', async () => {
    const { read } = await store()
    const { buildQueue } = await session()
    // 도서관에 있는 단어 전부가 매일 돌아오는 것이 아니다.
    expect(buildQueue(WORDS, read(), { scope: 'due' })).toEqual([])
  })

  it('담아 둔 단어는 새 단어로 들어온다 — 최대 10개', async () => {
    const { toggleBookmark, read } = await store()
    const { buildQueue } = await session()
    for (const w of WORDS) toggleBookmark(w.slug)
    const queue = buildQueue(WORDS, read(), { scope: 'due', directions: ['en_ko'] })
    expect(queue.length).toBe(10)
    expect(queue.every((q) => q.isNew)).toBe(true)
  })

  it('밀린 복습은 60개까지, 오래된 것부터', async () => {
    const { recordAnswer, read } = await store()
    const { buildQueue } = await session()
    for (const w of WORDS) recordAnswer(w.slug, 'en_ko', { correct: true })
    const later = new Date(Date.now() + 400 * 86_400_000)
    const queue = buildQueue(WORDS, read(), { scope: 'due', directions: ['en_ko'], now: later })
    expect(queue.length).toBe(60)

    const saved = read()
    const dates = queue.map((q) => saved.cards[`${q.word.slug}:en_ko`]!.dueAt.getTime())
    expect([...dates].sort((a, b) => a - b)).toEqual(dates)
  })

  it('아직 날이 안 된 단어는 빠진다', async () => {
    const { recordAnswer, read } = await store()
    const { buildQueue } = await session()
    recordAnswer('w1', 'en_ko', { correct: true })
    expect(buildQueue([word(1)], read(), { scope: 'due', directions: ['en_ko'] })).toEqual([])
  })
})

describe('문제', () => {
  it('보기는 네 개이고 정답이 그 안에 있다', async () => {
    const { read } = await store()
    const { buildQueue, buildQuestions } = await session()
    const queue = buildQueue(WORDS, read(), { scope: 'all', directions: ['en_ko'] })
    const questions = buildQuestions(queue, WORDS)
    expect(questions.length).toBe(WORDS.length)
    for (const q of questions) {
      expect(q.options).toHaveLength(4)
      expect(q.options).toContain(q.answer)
      expect(new Set(q.options).size).toBe(4)
    }
  })

  it('영→한은 단어를 보이고 뜻을 묻는다', async () => {
    const { read } = await store()
    const { buildQueue, buildQuestions } = await session()
    const queue = buildQueue([word(1)], read(), { scope: 'all', directions: ['en_ko'] })
    const [q] = buildQuestions(queue, WORDS)
    expect(q!.prompt).toBe('word1')
    expect(q!.answer).toBe('뜻1')
  })

  it('한→영은 뒤집힌다', async () => {
    const { read } = await store()
    const { buildQueue, buildQuestions } = await session()
    const queue = buildQueue([word(1)], read(), { scope: 'all', directions: ['ko_en'] })
    const [q] = buildQuestions(queue, WORDS)
    expect(q!.prompt).toBe('뜻1')
    expect(q!.answer).toBe('word1')
  })

  it('같은 세트의 단어가 오답으로 먼저 쓰인다', async () => {
    const { read } = await store()
    const { buildQueue, buildQuestions } = await session()
    const near = [word(1, 'DAY1'), word(2, 'DAY1'), word(3, 'DAY1'), word(4, 'DAY1')]
    const far = Array.from({ length: 30 }, (_, i) => word(100 + i, 'DAY9'))
    const queue = buildQueue([near[0]!], read(), { scope: 'all', directions: ['en_ko'] })
    const [q] = buildQuestions(queue, [...near, ...far])
    const nearKo = new Set(near.slice(1).map((w) => w.ko))
    for (const option of q!.options) {
      if (option === q!.answer) continue
      expect(nearKo.has(option)).toBe(true)
    }
  })

  it('뜻이 빈 단어는 문제가 되지 않는다', async () => {
    const { read } = await store()
    const { buildQueue, buildQuestions } = await session()
    // 목록에는 보인다 — 뜻을 깜빡하고 올린 적이 실제로 있었고, 그때 단어가
    // 사라지는 것보다 빈 채로 보이는 편이 고치기 쉽다. 물을 수는 없다.
    const blank: Candidate = { slug: 'w0', lemma: 'bare', ko: '', sets: ['DAY1'] }
    const queue = buildQueue([blank], read(), { scope: 'all' })
    expect(queue.length).toBe(2)
    expect(buildQuestions(queue, [blank, ...WORDS])).toEqual([])
  })

  it('고를 것이 없으면 문제를 만들지 않는다', async () => {
    const { read } = await store()
    const { buildQueue, buildQuestions } = await session()
    const only = [word(1)]
    const queue = buildQueue(only, read(), { scope: 'all', directions: ['en_ko'] })
    expect(buildQuestions(queue, only)).toEqual([])
  })
})

describe('주소에서 읽는 범위', () => {
  it('아는 이름만 받고 나머지는 오늘의 복습이다', async () => {
    const { parseScope, parseDirections } = await session()
    expect(parseScope('saved')).toBe('saved')
    expect(parseScope('wrong')).toBe('wrong')
    expect(parseScope('all')).toBe('all')
    expect(parseScope('mapped')).toBe('due')
    expect(parseScope(null)).toBe('due')
    expect(parseDirections('ko_en')).toEqual(['ko_en'])
    expect(parseDirections('아무거나')).toEqual(['en_ko', 'ko_en'])
  })
})
