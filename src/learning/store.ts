'use client'

import {
  emptyCardState,
  isDue,
  review,
  type CardState,
  type Direction,
} from '@/lib/learning/scheduler'
import { statusFor, type ItemTally, type NodeStatus } from '@/lib/learning/semantic-nodes'

/**
 * 학습 기록이 사는 곳 — 이 폰의 브라우저.
 *
 * 예전에는 Postgres 가 들고 있었고 서버가 요청마다 읽고 썼다. 그 때문에
 * 화면 하나가 CPU 15ms 를 넘었고, Cloudflare 무료 플랜의 10ms 에 들어갈 수
 * 없었다. 기록을 브라우저에 두면 서버가 할 일이 없어진다.
 *
 * 대신 잃는 것이 분명하다 — 기기를 바꾸거나 브라우저 데이터를 지우면 기록이
 * 사라지고, 선생님이 볼 수도 없다. 그것을 알고 고른 쪽이다.
 *
 * **일정 계산은 예전 그대로다.** `@/lib/learning/scheduler` 는 DB 를 모르는
 * 순수 함수라 옮겨 올 것이 없었다. 바뀐 것은 그 결과를 어디에 적어 두느냐뿐이다.
 */

const KEY = 'vocamap.learning.v1'

type Saved = {
  version: 1
  /** 담아 둔 단어들. 주소에 쓰는 이름(slug)으로 적는다. */
  bookmarks: string[]
  /** `단어:방향` → FSRS 가 돌려준 카드 상태. */
  cards: Record<string, CardState>
  /** 단어별 틀린 횟수. 목록에서 약한 것을 눈에 띄게 하는 데 쓴다. */
  wrong: Record<string, number>
  /**
   * 맵 노드 하나하나의 시도·정답 수.
   *
   * 단어 카드(`cards`)와 다른 것이다. 카드는 "이 단어를 다시 볼 날"을 정하고,
   * 이쪽은 "핵심 의미는 됐고 연어가 흔들린다"를 정한다. 예전에는
   * `review_events` 를 훑어 세던 것이고, 세는 규칙(`statusFor`)은 그대로
   * 쓴다 — 적어 두는 곳만 바뀌었다.
   */
  items: Record<string, ItemTally>
}

const EMPTY: Saved = { version: 1, bookmarks: [], cards: {}, wrong: {}, items: {} }

/**
 * 카드에는 `Date` 가 둘 들어 있다. JSON 은 그것을 글자로 만들고 돌려주지
 * 않으므로, 오갈 때마다 손으로 되돌린다. 이것을 빠뜨리면 날짜 비교가 조용히
 * 거짓이 되어 모든 단어가 '볼 때가 됐다'로 보인다.
 */
type StoredCard = Omit<CardState, 'dueAt' | 'lastReviewedAt'> & {
  dueAt: string
  lastReviewedAt: string | null
}

const toStored = (card: CardState): StoredCard => ({
  ...card,
  dueAt: card.dueAt.toISOString(),
  lastReviewedAt: card.lastReviewedAt ? card.lastReviewedAt.toISOString() : null,
})

function fromStored(stored: StoredCard): CardState | null {
  const dueAt = new Date(stored.dueAt)
  // 손상된 줄 하나가 전체를 못 읽게 만들지는 않는다. 그 카드만 버린다.
  if (Number.isNaN(dueAt.getTime())) return null
  const last = stored.lastReviewedAt ? new Date(stored.lastReviewedAt) : null
  return {
    ...stored,
    dueAt,
    lastReviewedAt: last && !Number.isNaN(last.getTime()) ? last : null,
  }
}

const cardKey = (slug: string, direction: Direction) => `${slug}:${direction}`

/**
 * 저장소를 읽는다. 못 읽어도 앱이 멈추지 않는다.
 *
 * 시크릿 창과 사이트 데이터를 막아 둔 브라우저에서는 `localStorage` 에
 * 손대는 것만으로 예외가 난다. 기록이 없는 것은 불편이지만 화면이 안 열리는
 * 것은 고장이라, 읽기는 언제나 빈 기록으로 물러난다.
 */
export function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as { version?: number; bookmarks?: string[]
      cards?: Record<string, StoredCard>; wrong?: Record<string, number>
      items?: Record<string, ItemTally> }
    if (parsed?.version !== 1) return EMPTY

    const cards: Record<string, CardState> = {}
    for (const [key, stored] of Object.entries(parsed.cards ?? {})) {
      const card = fromStored(stored)
      if (card) cards[key] = card
    }
    return {
      version: 1,
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      cards,
      wrong: parsed.wrong ?? {},
      // 노드 집계는 나중에 붙은 칸이다. 그 전에 공부한 기록에는 없으므로,
      // 없으면 빈 것으로 읽는다 — 버전을 올려 기록을 버릴 일이 아니다.
      items: parsed.items ?? {},
    }
  } catch {
    return EMPTY
  }
}

/** 쓰기도 조용히 실패한다. 공부를 막을 이유가 없다. */
function write(next: Saved): Saved {
  try {
    const cards: Record<string, StoredCard> = {}
    for (const [key, card] of Object.entries(next.cards)) cards[key] = toStored(card)
    localStorage.setItem(KEY, JSON.stringify({ ...next, cards }))
  } catch {
    // 저장 공간이 막혔거나 가득 찼다. 이번 화면에서는 그대로 쓰이고,
    // 다음에 열면 없다. 그것이 여기서 할 수 있는 최선이다.
  }
  return next
}

export function isBookmarked(saved: Saved, slug: string): boolean {
  return saved.bookmarks.includes(slug)
}

export function toggleBookmark(slug: string): Saved {
  const saved = read()
  const bookmarks = saved.bookmarks.includes(slug)
    ? saved.bookmarks.filter((s) => s !== slug)
    : [...saved.bookmarks, slug]
  return write({ ...saved, bookmarks })
}

export function cardFor(saved: Saved, slug: string, direction: Direction): CardState | null {
  return saved.cards[cardKey(slug, direction)] ?? null
}

/** 아직 한 번도 안 본 단어는 '볼 때가 된 것'에 들어간다 — 예전 화면과 같다. */
export function dueNow(saved: Saved, slugs: string[], direction: Direction, now = new Date()) {
  return slugs.filter((slug) => {
    const card = saved.cards[cardKey(slug, direction)]
    return !card || isDue(card, now)
  })
}

export function wrongCount(saved: Saved, slug: string): number {
  return saved.wrong[slug] ?? 0
}

/**
 * 답 하나를 기록한다.
 *
 * 맞았는지와 얼마나 걸렸는지를 예전과 같은 규칙으로 FSRS 등급으로 바꾸고,
 * 다음에 볼 날짜를 받아 적는다. 틀린 횟수는 따로 센다 — 일정과 상관없이
 * "이 단어는 자꾸 틀린다"를 목록에서 보여주기 위해서다.
 */
export function recordAnswer(
  slug: string,
  direction: Direction,
  {
    correct,
    responseTimeMs,
    now = new Date(),
  }: { correct: boolean; responseTimeMs?: number | null; now?: Date },
): Saved {
  const saved = read()
  const key = cardKey(slug, direction)
  const before = saved.cards[key] ?? emptyCardState(now)
  const { next } = review(before, { correct, responseTimeMs }, now)

  const wrong = { ...saved.wrong }
  if (!correct) wrong[slug] = (wrong[slug] ?? 0) + 1

  return write({ ...saved, cards: { ...saved.cards, [key]: next }, wrong })
}

/**
 * 맵 노드 하나의 답을 기록한다.
 *
 * 일정(`cards`)과 따로 센다. 노드는 단어가 아니라 그 단어의 한 연결이고,
 * "핵심 의미는 세 번 맞혔다"는 다음에 그 단어를 언제 볼지와 다른 질문이다.
 */
export function recordItem(itemId: string, correct: boolean): Saved {
  const saved = read()
  const before = saved.items[itemId] ?? { attempts: 0, correct: 0 }
  return write({
    ...saved,
    items: {
      ...saved.items,
      [itemId]: { attempts: before.attempts + 1, correct: before.correct + (correct ? 1 : 0) },
    },
  })
}

/** 그 노드가 지금 어느 등급인지. 규칙은 서버가 쓰던 것과 같은 함수다. */
export function itemStatus(saved: Saved, itemId: string): NodeStatus {
  return statusFor(saved.items[itemId])
}

/** 기록을 통째로 지운다. 설정 화면에서 부른다. */
export function clearAll(): Saved {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 지우지 못해도 알릴 것이 없다 — 다음 읽기가 어차피 같은 것을 돌려준다.
  }
  return EMPTY
}

export type { CardState, Direction, Saved }
