'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Tag } from '@/components/ui'
import { dueLabel } from '@/lib/learning/scheduler'
import { recordAnswer } from '@/learning/store'
import type { Question } from '@/learning/session'

type Phase =
  | { kind: 'asking' }
  | { kind: 'answered'; correct: boolean; chosen: string; nextReview: string }

/**
 * 외우기 고리. 문제 하나가 화면을 채우고, 결정은 어느 보기를 누를지 하나뿐이다.
 * 답한 즉시 결과가 뜨고 확인 단계 없이 다음으로 간다 — 카드마다 "계속"을
 * 누르게 하는 것이 단어 30개를 300개처럼 느끼게 하는 가장 빠른 길이다.
 *
 * 예전 화면(`study/session/session-runner.tsx`)과 다른 점은 하나다. 그쪽은
 * 답을 서버로 보내 다시 채점받았고, 서버가 받지 않은 답을 모아 두고 "저장하지
 * 못했어요"와 다시 보내기를 띄워야 했다. 여기서는 채점과 기록이 같은 자리에서
 * 끝나므로 저장에 실패할 틈이 없다 — 그래서 그 장치가 전부 없어졌다. 대신
 * 기록이 이 폰을 벗어나지 않는다.
 */
export function SessionRunner({
  questions,
  backHref = '/study',
}: {
  questions: Question[]
  /** "마치기" 가 돌아가는 곳 — 이 시험을 시작한 목록이다. */
  backHref?: string
}) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>({ kind: 'asking' })
  const [correctCount, setCorrectCount] = useState(0)
  const [missed, setMissed] = useState<Question[]>([])
  const [queue, setQueue] = useState(questions)
  const shownAt = useRef(Date.now())

  const question = queue[index]
  const finished = index >= queue.length

  useEffect(() => {
    shownAt.current = Date.now()
  }, [index])

  const choose = useCallback(
    (choice: string) => {
      if (!question || phase.kind === 'answered') return
      const correct = choice === question.answer
      const responseTimeMs = Date.now() - shownAt.current

      // 적는 것이 먼저다. 돌아온 카드가 다음에 볼 날을 들고 있고, 그것이
      // 화면에 바로 뜬다 — 기다릴 서버가 없으니 낙관적으로 그릴 것도 없다.
      const saved = recordAnswer(question.word.slug, question.direction, {
        correct,
        responseTimeMs,
      })
      const card = saved.cards[`${question.word.slug}:${question.direction}`]

      setPhase({
        kind: 'answered',
        chosen: choice,
        correct,
        nextReview: card ? dueLabel(card.dueAt) : '',
      })
      if (correct) setCorrectCount((n) => n + 1)
      else setMissed((prev) => (prev.includes(question) ? prev : [...prev, question]))
    },
    [phase.kind, question],
  )

  const advance = useCallback(() => {
    setPhase({ kind: 'asking' })
    setIndex((i) => i + 1)
  }, [])

  // 숫자 키로 보기를 고르고 Enter/Space 로 넘어간다. 책상에서 공부하는
  // 학생에게는 두드리는 것이 누르는 것보다 훨씬 빠르다.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (finished || !question) return
      if (phase.kind === 'asking') {
        const n = Number(event.key)
        if (n >= 1 && n <= question.options.length) {
          event.preventDefault()
          choose(question.options[n - 1]!)
        }
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, choose, finished, phase.kind, question])

  if (finished) {
    return (
      <Summary
        total={queue.length}
        correct={correctCount}
        missed={missed}
        onRetryMissed={() => {
          setQueue(missed)
          setMissed([])
          setCorrectCount(0)
          setIndex(0)
          setPhase({ kind: 'asking' })
        }}
        onDone={() => router.push(backHref)}
      />
    )
  }

  if (!question) return null

  const progress = (index / queue.length) * 100

  return (
    <div className="flex min-h-[70dvh] flex-col">
      {/* 막대가 아니라 머리카락 한 올. 진행도는 맥락이고, 이 화면에서 무게를
          가져야 하는 것은 문제뿐이다. */}
      <div className="mb-8">
        <div className="h-px w-full bg-line">
          <div
            className="h-px bg-ink-3 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-ink-3">
          <span className="numeral">
            {index + 1} / {queue.length}
          </span>
          <span>{question.direction === 'en_ko' ? '영어 → 한국어' : '한국어 → 영어'}</span>
        </div>
      </div>

      <div
        className={`mb-8 flex min-h-28 flex-col items-center justify-center text-center ${
          phase.kind === 'answered' && !phase.correct ? 'animate-shake' : ''
        }`}
      >
        {question.isNew ? <Tag className="mb-3">새 단어</Tag> : null}
        {/* 단어는 제목이고 문장은 문장이다. 긴 뜻을 2rem 으로 세우면 보기가
            화면 밖으로 밀리고 소리치는 것처럼 읽힌다. */}
        <p
          className={
            question.prompt.length > 24
              ? 'text-[1.125rem] leading-relaxed font-medium break-keep sm:text-[1.25rem]'
              : 'text-[2rem] font-semibold tracking-tight break-keep'
          }
        >
          {question.prompt}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {question.options.map((option, i) => {
          const answered = phase.kind === 'answered'
          const isAnswer = option === question.answer
          const isChosen = answered && phase.chosen === option

          return (
            <button
              key={option}
              onClick={() => choose(option)}
              disabled={answered}
              className={`flex items-center gap-3 rounded-control border px-4 py-3.5 text-left text-[0.9375rem] transition
                ${
                  answered && isAnswer
                    ? 'border-good/40 bg-good-soft text-good'
                    : isChosen
                      ? 'border-bad/40 bg-bad-soft text-bad'
                      : 'border-line bg-surface hover:border-ink-3 disabled:opacity-45'
                }`}
            >
              <span className="numeral hidden w-4 shrink-0 text-xs text-ink-3 sm:block">
                {i + 1}
              </span>
              <span className="break-keep">{option}</span>
            </button>
          )
        })}
      </div>

      {phase.kind === 'answered' ? (
        <div className="mt-6 animate-rise">
          <div className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className={phase.correct ? 'text-good' : 'text-bad'}>
                {phase.correct ? '정답이에요' : '다시 만나볼게요'}
              </span>
              {phase.nextReview ? (
                <span className="text-xs text-ink-3">다음 복습 {phase.nextReview}</span>
              ) : null}
            </div>
          </div>
          <Button size="lg" className="mt-3 w-full" onClick={advance}>
            다음
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Summary({
  total,
  correct,
  missed,
  onRetryMissed,
  onDone,
}: {
  total: number
  correct: number
  missed: Question[]
  onRetryMissed: () => void
  onDone: () => void
}) {
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0

  return (
    <div className="animate-rise">
      <div className="py-6 text-center">
        <p className="text-[0.8125rem] text-ink-3">오늘 학습 완료</p>
        <p className="numeral mt-1.5 text-[3rem] font-semibold leading-none">{accuracy}%</p>
        <p className="numeral mt-1.5 text-[0.8125rem] text-ink-3">
          {total}문제 중 {correct}문제 정답
        </p>
      </div>

      {missed.length > 0 ? (
        <>
          <p className="numeral mt-8 mb-2 text-[0.8125rem] text-ink-2">
            틀린 단어 {missed.length}개
          </p>
          <ul className="divide-y divide-line-soft border-t border-line">
            {missed.map((q, i) => (
              <li
                key={`${q.word.slug}-${q.direction}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem]">{q.prompt}</span>
                  <span className="mt-0.5 block truncate text-[0.8125rem] text-ink-3">
                    {q.answer}
                  </span>
                </span>
                <Link
                  href={`/words/${q.word.slug}`}
                  className="shrink-0 text-xs text-ink-3 transition hover:text-ink-2"
                >
                  자세히
                </Link>
              </li>
            ))}
          </ul>
          <Button size="lg" className="mt-5 w-full" onClick={onRetryMissed}>
            틀린 단어 다시 풀기
          </Button>
          <Button variant="ghost" className="mt-1.5 w-full" onClick={onDone}>
            마치기
          </Button>
        </>
      ) : (
        <Button size="lg" className="mt-6 w-full" onClick={onDone}>
          마치기
        </Button>
      )}
    </div>
  )
}
