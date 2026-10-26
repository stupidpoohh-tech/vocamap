'use client'

import { isDue, type Direction } from '@/lib/learning/scheduler'
import { cardFor, isBookmarked, wrongCount, type Saved } from './store'

/**
 * 시험이 무엇을 물을지 — 이 브라우저에서 정한다.
 *
 * 예전에는 서버가 정했다. 범위가 주소에 붙어 오고(`?scope=due`), 서버가
 * Postgres 에 그 학생의 카드와 답한 기록을 물어 대기열을 만들고, 오답 보기를
 * 뽑고, 문제마다 서명을 붙여 내려보냈다. 그 서명은 학생이 답을 보내올 때
 * 서버가 다시 채점하기 위한 것이었다.
 *
 * 지금은 채점도 기록도 이 브라우저에서 끝난다. 그러면 서명할 주장이 없고
 * 서명을 받을 사람도 없다 — 애초에 학생이 자기 공부 기록을 고치는 것을 막는
 * 장치였는데, 그 기록이 이제 학생의 폰에만 있다.
 *
 * 규칙은 옮겨 오지 않았다. 하루 복습 상한 60, 새 단어 10, 목록 시험 300 —
 * 서버가 쓰던 숫자 그대로다.
 */

/** 하루에 돌려줄 복습의 상한. 2주 만에 돌아온 학생에게 400개를 보이지 않는다. */
const DUE_LIMIT = 60
/** 그 안에 섞어 줄 새 단어의 상한. 쌓인 복습이 새 것을 완전히 밀어내지 않게. */
const NEW_LIMIT = 10
/** 목록을 겨눈 시험의 상한. 한 번에 앉을 생각이 없던 목록에 대한 보호다. */
const SCOPED_LIMIT = 300

export type Scope = 'due' | 'all' | 'saved' | 'wrong'

export function parseScope(value: string | null | undefined): Scope {
  const known = ['all', 'saved', 'wrong'] as const
  return known.includes(value as (typeof known)[number]) ? (value as Scope) : 'due'
}

export function parseDirections(value: string | null | undefined): Direction[] {
  if (value === 'en_ko' || value === 'ko_en') return [value]
  return ['en_ko', 'ko_en']
}

/** 시험이 다룰 수 있는 단어 하나. 콘텐츠에서 온다. */
export type Candidate = { slug: string; lemma: string; ko: string; sets: string[] }

export type QueueItem = {
  word: Candidate
  direction: Direction
  /** 이 방향을 한 번도 하지 않았다. 화면에 "새 단어"로 표시된다. */
  isNew: boolean
}

/**
 * 범위가 가리키는 대기열.
 *
 * `due` 만 날짜를 본다. 나머지는 학생이 그 목록을 겨눠서 누른 것이므로,
 * 그 목록을 보고 있는 사람에게 "복습할 게 없다"고 답하지 않는다 — 답은
 * 그래도 일정에 먹히니 이른 복습이 버려지는 것은 아니고, 날짜만 안 잡힌다.
 */
export function buildQueue(
  words: Candidate[],
  saved: Saved,
  opts: { scope: Scope; set?: string | null; directions?: Direction[]; now?: Date },
): QueueItem[] {
  const directions = opts.directions ?? (['en_ko', 'ko_en'] as Direction[])
  const now = opts.now ?? new Date()
  const inSet = opts.set ? words.filter((w) => w.sets.includes(opts.set!)) : words

  if (opts.scope === 'due') return dueQueue(inSet, saved, directions, now)

  const picked =
    opts.scope === 'saved'
      ? inSet.filter((w) => isBookmarked(saved, w.slug))
      : opts.scope === 'wrong'
        ? inSet.filter((w) => wrongCount(saved, w.slug) > 0)
        : inSet

  return picked
    .slice(0, SCOPED_LIMIT)
    .flatMap((word) =>
      directions.map((direction) => ({
        word,
        direction,
        isNew: cardFor(saved, word.slug, direction) === null,
      })),
    )
}

/**
 * 오늘의 복습.
 *
 * 공부 중인 단어만 센다 — 담아 둔 것, 그리고 한 번이라도 답해 본 것. 도서관에
 * 있는 단어 전부가 매일 돌아오는 것이 아니다.
 */
function dueQueue(
  words: Candidate[],
  saved: Saved,
  directions: Direction[],
  now: Date,
): QueueItem[] {
  const due: QueueItem[] = []
  const fresh: QueueItem[] = []

  for (const word of words) {
    const bookmarked = isBookmarked(saved, word.slug)
    for (const direction of directions) {
      const card = cardFor(saved, word.slug, direction)
      if (card) {
        if (isDue(card, now)) due.push({ word, direction, isNew: false })
        continue
      }
      // 카드가 없는 단어는 담아 둔 것만 들어온다. 담지 않은 단어까지 넣으면
      // 오늘의 복습이 도서관 전체가 된다.
      if (bookmarked) fresh.push({ word, direction, isNew: true })
    }
  }

  // 밀린 것부터. 가장 오래 지난 것이 가장 먼저 온다.
  due.sort((a, b) => {
    const at = cardFor(saved, a.word.slug, a.direction)?.dueAt.getTime() ?? 0
    const bt = cardFor(saved, b.word.slug, b.direction)?.dueAt.getTime() ?? 0
    return at - bt
  })

  return [...due.slice(0, DUE_LIMIT), ...fresh.slice(0, NEW_LIMIT)]
}

/* ────────────────────────────── 문제 만들기 ────────────────────────────── */

export type Question = QueueItem & {
  prompt: string
  answer: string
  /** 정답을 포함해 네 개. 이미 섞여 있다. */
  options: string[]
}

/** 보기 수. 정답 하나와 오답 셋. */
const OPTION_COUNT = 4

/**
 * 대기열을 문제로 바꾼다.
 *
 * 오답은 같은 세트에서 먼저 뽑는다. 시험지에 함께 나오는 단어가 그것들이고,
 * 고르기 어려운 오답일수록 문제가 된다. 모자라면 나머지에서 채운다.
 *
 * 여기서 묻는 것은 뜻 하나다 — 단어를 보고 뜻, 뜻을 보고 단어. 맵이 있는
 * 단어에 연어나 빈칸을 묻던 길은 단어 화면의 맵에 그대로 있다. 같은 카드와
 * 같은 일정으로 어떤 학생에게는 다른 질문을 하던 것을 되돌린 것이고, 그
 * 이유는 예전 코드가 적어 둔 그대로다: 맵이 있다는 것이 다르게 물어 달라는
 * 요청은 아니다.
 */
export function buildQuestions(queue: QueueItem[], words: Candidate[]): Question[] {
  const questions: Question[] = []

  for (const item of queue) {
    const isEnKo = item.direction === 'en_ko'
    const answer = isEnKo ? item.word.ko : item.word.lemma
    const prompt = isEnKo ? item.word.lemma : item.word.ko
    // 뜻이 비어 있는 단어는 물을 것이 없다. 목록에서는 보이지만 — 뜻을
    // 깜빡하고 올린 적이 실제로 있었고, 그때 단어가 사라지는 것보다 빈 채로
    // 보이는 편이 고치기 쉽다 — 문제로는 만들 수 없다.
    if (!answer.trim() || !prompt.trim()) continue

    const usable = (pool: Candidate[]) =>
      pool
        .filter((w) => w.slug !== item.word.slug)
        .map((w) => (isEnKo ? w.ko : w.lemma))
        .map((v) => v.trim())
        .filter((v) => v && v !== answer)

    const near = shuffle([
      ...new Set(usable(words.filter((w) => w.sets.some((s) => item.word.sets.includes(s))))),
    ])
    const far = shuffle([...new Set(usable(words))])
    const distractors = [...new Set([...near, ...far])].slice(0, OPTION_COUNT - 1)
    // 보기가 둘도 안 되면 고르는 것이 아니다.
    if (!distractors.length) continue

    questions.push({
      ...item,
      prompt,
      answer,
      options: shuffle([answer, ...distractors]),
    })
  }

  return questions
}

/** 자리를 섞는다. 서버가 같은 문제에 같은 순서를 주던 것과 달리, 매번 다르다. */
function shuffle<T>(values: T[]): T[] {
  const out = [...values]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * 오늘의 복습이 실제로 물을 단어 수.
 *
 * 화면이 따로 세면 어긋난다. 실제로 그랬다 — 목록은 "한 번도 안 본 단어는
 * 볼 때가 된 것"이라는 예전 규칙으로 235개라 해 놓고, 그 글을 눌러 들어간
 * 시험은 "지금 복습할 단어가 없어요"를 띄웠다. 도서관에 있는 단어 전부가
 * 오늘 돌아오는 것이 아니고(담아 둔 것과 한 번이라도 푼 것만 돌아온다),
 * 그 규칙은 `buildQueue` 에 있다. 그래서 세는 것도 그것으로 센다.
 *
 * 단어 수다. 대기열은 방향마다 한 줄이라 같은 단어가 둘일 수 있다.
 */
export function dueCount(
  words: Candidate[],
  saved: Saved,
  opts: { set?: string | null; directions?: Direction[]; now?: Date } = {},
): number {
  const queue = buildQueue(words, saved, { ...opts, scope: 'due' })
  return new Set(queue.map((q) => q.word.slug)).size
}

/** 그중 아직 한 번도 안 본 것. "새 단어 N개 함께"가 이것이다. */
export function freshCount(
  words: Candidate[],
  saved: Saved,
  opts: { set?: string | null; directions?: Direction[]; now?: Date } = {},
): number {
  const queue = buildQueue(words, saved, { ...opts, scope: 'due' })
  return new Set(queue.filter((q) => q.isNew).map((q) => q.word.slug)).size
}
