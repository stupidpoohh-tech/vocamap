import { beforeEach, describe, expect, it } from 'vitest'
import { emptyCardState } from '@/lib/learning/scheduler'

/**
 * 기록이 브라우저에 산다는 것은, 저장과 읽기 사이에 JSON 이 한 번 낀다는
 * 뜻이다. 거기서 `Date` 가 글자가 되는데 그걸 되돌리지 않으면 날짜 비교가
 * 조용히 거짓이 되어 모든 단어가 '볼 때가 됐다'로 보인다. 그 왕복을 지킨다.
 */

/**
 * 브라우저가 아니므로 `localStorage` 를 세워 둔다.
 *
 * `globalThis` 에는 이미 DOM 의 `Storage` 타입이 걸려 있어서 곧장 바꿔치기할
 * 수 없다. `unknown` 을 한 번 거치는 것이 그래서다 — 이것을 빼면 타입 검사가
 * 막히고, CI 는 타입 검사에서 멈추면 배포까지 가지 않는다.
 */
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) { this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
}

beforeEach(async () => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

const store = () => import('@/learning/store')

describe('담아 두기', () => {
  it('누르면 담기고 다시 누르면 빠진다', async () => {
    const { toggleBookmark, isBookmarked, read } = await store()
    toggleBookmark('cave')
    expect(isBookmarked(read(), 'cave')).toBe(true)
    toggleBookmark('cave')
    expect(isBookmarked(read(), 'cave')).toBe(false)
  })

  it('새로 읽어도 남아 있다', async () => {
    const { toggleBookmark, read, isBookmarked } = await store()
    toggleBookmark('however')
    expect(isBookmarked(read(), 'however')).toBe(true)
  })
})

describe('답을 기록하면', () => {
  it('다음에 볼 날짜가 미래로 간다', async () => {
    const { recordAnswer, cardFor } = await store()
    const now = new Date('2026-10-26T00:00:00Z')
    const saved = recordAnswer('cave', 'en_ko', { correct: true, responseTimeMs: 2000, now })
    const card = cardFor(saved, 'cave', 'en_ko')
    expect(card).not.toBeNull()
    expect(card!.dueAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it('저장했다 읽어도 날짜가 Date 로 돌아온다', async () => {
    // 이걸 빠뜨리면 글자와 숫자를 비교하게 되고, 비교는 늘 거짓이 된다.
    const { recordAnswer, read, cardFor } = await store()
    recordAnswer('cave', 'en_ko', { correct: true, responseTimeMs: 2000 })
    const card = cardFor(read(), 'cave', 'en_ko')
    expect(card!.dueAt).toBeInstanceOf(Date)
    expect(Number.isNaN(card!.dueAt.getTime())).toBe(false)
  })

  it('틀리면 틀린 횟수가 쌓인다', async () => {
    const { recordAnswer, wrongCount, read } = await store()
    recordAnswer('issue', 'en_ko', { correct: false, responseTimeMs: 5000 })
    recordAnswer('issue', 'en_ko', { correct: false, responseTimeMs: 5000 })
    expect(wrongCount(read(), 'issue')).toBe(2)
  })

  it('맞히면 틀린 횟수가 늘지 않는다', async () => {
    const { recordAnswer, wrongCount, read } = await store()
    recordAnswer('issue', 'en_ko', { correct: true, responseTimeMs: 1000 })
    expect(wrongCount(read(), 'issue')).toBe(0)
  })

  it('방향마다 따로 센다', async () => {
    // 영→한 을 외웠다고 한→영 이 되는 것은 아니다. 예전과 같은 규칙이다.
    const { recordAnswer, cardFor, read } = await store()
    recordAnswer('cave', 'en_ko', { correct: true, responseTimeMs: 1000 })
    expect(cardFor(read(), 'cave', 'en_ko')).not.toBeNull()
    expect(cardFor(read(), 'cave', 'ko_en')).toBeNull()
  })
})

describe('볼 때가 된 것', () => {
  it('한 번도 안 본 단어는 들어간다', async () => {
    const { dueNow, read } = await store()
    expect(dueNow(read(), ['cave', 'however'], 'en_ko')).toEqual(['cave', 'however'])
  })

  it('방금 맞힌 단어는 빠진다', async () => {
    const { recordAnswer, dueNow, read } = await store()
    recordAnswer('cave', 'en_ko', { correct: true, responseTimeMs: 1500 })
    expect(dueNow(read(), ['cave', 'however'], 'en_ko')).toEqual(['however'])
  })

  it('날짜가 지나면 다시 들어온다', async () => {
    const { recordAnswer, dueNow, read } = await store()
    const now = new Date('2026-10-26T00:00:00Z')
    recordAnswer('cave', 'en_ko', { correct: true, responseTimeMs: 1500, now })
    const muchLater = new Date('2027-10-26T00:00:00Z')
    expect(dueNow(read(), ['cave'], 'en_ko', muchLater)).toEqual(['cave'])
  })
})

describe('저장소를 못 쓸 때', () => {
  it('읽기가 막혀도 빈 기록으로 돌아간다', async () => {
    // 시크릿 창이나 사이트 데이터를 막아 둔 브라우저에서는 손대는 것만으로
    // 예외가 난다. 기록이 없는 것은 불편이고 화면이 안 열리는 것은 고장이다.
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    }
    const { read, toggleBookmark } = await store()
    expect(read().bookmarks).toEqual([])
    expect(() => toggleBookmark('cave')).not.toThrow()
  })

  it('망가진 내용이 들어 있어도 빈 기록으로 돌아간다', async () => {
    ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage.setItem(
      'vocamap.learning.v1', '{ 이건 JSON 이 아니다',
    )
    const { read } = await store()
    expect(read().bookmarks).toEqual([])
  })

  it('카드 한 장이 깨져도 나머지는 살린다', async () => {
    const { recordAnswer } = await store()
    recordAnswer('cave', 'en_ko', { correct: true, responseTimeMs: 1000 })
    const raw = JSON.parse(
      (globalThis as unknown as { localStorage: MemoryStorage }).localStorage.getItem('vocamap.learning.v1')!,
    )
    raw.cards['broken:en_ko'] = { ...raw.cards['cave:en_ko'], dueAt: '날짜가 아님' }
    ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage.setItem(
      'vocamap.learning.v1', JSON.stringify(raw),
    )
    const { read, cardFor } = await store()
    expect(cardFor(read(), 'cave', 'en_ko')).not.toBeNull()
    expect(cardFor(read(), 'broken', 'en_ko')).toBeNull()
  })
})

describe('맵 노드별 집계', () => {
  it('시도와 정답을 따로 센다', async () => {
    const { recordItem, itemStatus, read } = await store()
    recordItem('issue:core0', true)
    recordItem('issue:core0', true)
    recordItem('issue:core0', true)
    expect(read().items['issue:core0']).toEqual({ attempts: 3, correct: 3 })
    // 세 번 넘게 풀고 8할 이상이면 됐다고 본다 — 서버가 쓰던 규칙 그대로다.
    expect(itemStatus(read(), 'issue:core0')).toBe('completed')
  })

  it('반을 못 맞히면 흔들리는 것으로 본다', async () => {
    const { recordItem, itemStatus, read } = await store()
    recordItem('issue:c0', false)
    recordItem('issue:c0', true)
    recordItem('issue:c0', false)
    expect(itemStatus(read(), 'issue:c0')).toBe('weak')
  })

  it('한 번도 안 푼 노드는 아직 안 본 것이다', async () => {
    const { itemStatus, read } = await store()
    expect(itemStatus(read(), 'issue:f0')).toBe('unseen')
  })

  it('노드 집계가 없던 기록도 그대로 읽힌다', async () => {
    const { read } = await store()
    // 집계 칸이 붙기 전에 공부한 기록. 버전을 올려 버리면 그 사람의 담은
    // 단어와 일정이 함께 사라진다.
    localStorage.setItem(
      'vocamap.learning.v1',
      JSON.stringify({ version: 1, bookmarks: ['cave'], cards: {}, wrong: { cave: 2 } }),
    )
    const saved = read()
    expect(saved.bookmarks).toEqual(['cave'])
    expect(saved.wrong.cave).toBe(2)
    expect(saved.items).toEqual({})
  })
})

describe('기록 지우기', () => {
  it('전부 사라진다', async () => {
    const { toggleBookmark, recordAnswer, recordItem, clearAll, read } = await store()
    toggleBookmark('cave')
    recordAnswer('issue', 'en_ko', { correct: false, responseTimeMs: 1000 })
    recordItem('issue:core0', true)
    clearAll()
    expect(read()).toEqual({ version: 1, bookmarks: [], cards: {}, wrong: {}, items: {} })
  })
})

describe('빈 카드', () => {
  it('아직 한 번도 안 본 상태다', () => {
    const card = emptyCardState(new Date('2026-10-26T00:00:00Z'))
    expect(card.reps).toBe(0)
    expect(card.lapses).toBe(0)
  })
})
