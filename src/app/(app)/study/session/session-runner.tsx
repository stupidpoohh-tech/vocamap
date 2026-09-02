'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Button, Tag } from '@/components/ui'
import type { RecallQuestion } from '@/lib/learning/questions'
import { submitAnswer, type AnswerResult } from './actions'

type Phase = { kind: 'asking' } | { kind: 'answered'; result: AnswerResult; chosen: string }

/**
 * The recall loop. One question fills the screen; the only decision is which
 * option to tap. Feedback is immediate and the next question follows without a
 * confirmation step, because a "continue" tap between every card is the fastest
 * way to make 30 words feel like 300.
 */
export function SessionRunner({
  questions,
  backHref = '/study',
}: {
  questions: RecallQuestion[]
  /** Where "마치기" returns to — the list the test was started from. */
  backHref?: string
}) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>({ kind: 'asking' })
  const [correctCount, setCorrectCount] = useState(0)
  const [missed, setMissed] = useState<RecallQuestion[]>([])
  const [queue, setQueue] = useState(questions)
  const [pending, startTransition] = useTransition()
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

      // Optimistic: the student sees the verdict instantly, the write follows.
      setPhase({
        kind: 'answered',
        chosen: choice,
        result: {
          correct,
          nextReviewLabel: '',
          retentionPercent: 0,
          brainMapRecommended: false,
          recommendationMessage: null,
        },
      })
      if (correct) setCorrectCount((n) => n + 1)
      else setMissed((prev) => (prev.some((m) => m === question) ? prev : [...prev, question]))

      startTransition(async () => {
        const result = await submitAnswer({
          vocabularyId: question.vocabularyId,
          direction: question.direction,
          correct,
          responseTimeMs,
          choice,
        })
        setPhase({ kind: 'answered', chosen: choice, result })
      })
    },
    [phase.kind, question],
  )

  const advance = useCallback(() => {
    setPhase({ kind: 'asking' })
    setIndex((i) => i + 1)
  }, [])

  // Number keys pick an option, Enter/Space moves on. Keyboard-driven drilling
  // is much faster than tapping for students who study at a desk.
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
      {/* A hairline, not a bar. Progress is context here — the question is the
          only thing on this screen that should carry weight. */}
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
          phase.kind === 'answered' && !phase.result.correct ? 'animate-shake' : ''
        }`}
      >
        {question.isNew ? <Tag className="mb-3">새 단어</Tag> : null}
        <p className="text-[2rem] font-semibold tracking-tight break-keep">{question.prompt}</p>
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
          <Feedback result={phase.result} pending={pending} vocabularyId={question.vocabularyId} />
          <Button size="lg" className="mt-3 w-full" onClick={advance}>
            다음
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function Feedback({
  result,
  pending,
  vocabularyId,
}: {
  result: AnswerResult
  pending: boolean
  vocabularyId: string
}) {
  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className={result.correct ? 'text-good' : 'text-bad'}>
          {result.correct ? '정답이에요' : '다시 만나볼게요'}
        </span>
        {!pending && result.nextReviewLabel ? (
          <span className="text-xs text-ink-3">다음 복습 {result.nextReviewLabel}</span>
        ) : null}
      </div>

      {result.brainMapRecommended ? (
        <Link
          href={`/words/${vocabularyId}`}
          className="mt-3 flex items-baseline justify-between gap-3 rounded-control bg-warn-soft px-3 py-2 text-[0.8125rem] text-warn"
        >
          <span className="break-keep">
            {result.recommendationMessage ?? '이 단어는 조금 더 깊이 볼까요?'}
          </span>
          <span className="shrink-0">맵 열기 →</span>
        </Link>
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
  missed: RecallQuestion[]
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
                key={`${q.vocabularyId}-${q.direction}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem]">{q.prompt}</span>
                  <span className="mt-0.5 block truncate text-[0.8125rem] text-ink-3">
                    {q.answer}
                  </span>
                </span>
                <Link
                  href={`/words/${q.vocabularyId}`}
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
