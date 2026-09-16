'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Button, Tag } from '@/components/ui'
import type { QuestionKind, RecallQuestion } from '@/lib/learning/questions'
import { submitAnswer, type AnswerResult } from './actions'

type Phase =
  | { kind: 'asking' }
  | { kind: 'answered'; correct: boolean; chosen: string; result: AnswerResult | null }

/** An answer the server did not accept, kept so it can be sent again. */
type Unsaved = { token: string; choice: string; responseTimeMs: number; prompt: string }

/**
 * What the question is actually testing, said plainly.
 *
 * A mapped word gets asked a different way each time it comes round, so the
 * strip that used to read "영어 → 한국어" on every card has to say which of
 * them this one is — otherwise a sentence with a blank arrives with no
 * explanation of what is being asked for.
 */
const KIND_LABEL: Partial<Record<QuestionKind, string>> = {
  // The blank hides an inflected form while the options are dictionary forms,
  // so the label says which is wanted rather than leaving it to be guessed.
  context: '문맥 속 빈칸 · 원형 고르기',
  definition: '영영 풀이에 맞는 단어',
  collocationSense: '이 표현의 뜻',
  familySense: '이 파생어의 뜻',
  sense: '이 문장에서의 뜻',
  collocation: '함께 쓰는 표현',
  family: '알맞은 형태',
}

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
  /**
   * Answers the server did not accept.
   *
   * The verdict on screen is the page's own, so a failed save is invisible
   * unless it is said out loud — and a session that quietly lost half its
   * answers while showing "오늘 학습 완료" is worse than one that failed
   * loudly. These survive until they are sent successfully or the page is
   * closed; a refresh loses them, and the summary says so.
   */
  const [unsaved, setUnsaved] = useState<Unsaved[]>([])
  const [pending, startTransition] = useTransition()
  const shownAt = useRef(Date.now())
  /**
   * Which question is on screen, counted rather than named.
   *
   * The verdict is optimistic and the write follows, so on a slow connection
   * the student can be two questions further on by the time the server answers.
   * Without this, that late reply stamped its result on whatever question was
   * showing — locking its options and putting "다음" under it — so one answer
   * carried two questions past. The number lets a reply tell whether it is
   * still about the question in front of the student.
   */
  const turn = useRef(0)

  const question = queue[index]
  const finished = index >= queue.length

  useEffect(() => {
    shownAt.current = Date.now()
  }, [index])

  /**
   * Sends one answer and files it under "not saved" if the server did not take
   * it. The token is what makes retrying safe: it carries the id of this one
   * asking, so sending it twice records it once.
   */
  const send = useCallback(
    async (attempt: Unsaved): Promise<AnswerResult> => {
      // A dropped request rejects here rather than returning a result. Without
      // this catch the whole transition rejects, which loses the verdict the
      // reader is already looking at and takes the retry with it — the failure
      // mode this screen exists to handle.
      let result: AnswerResult
      try {
        result = await submitAnswer({
          token: attempt.token,
          choice: attempt.choice,
          responseTimeMs: attempt.responseTimeMs,
        })
      } catch {
        result = { status: 'failed', correct: false, message: '결과를 저장하지 못했어요.' }
      }
      setUnsaved((prev) => {
        const rest = prev.filter((u) => u.token !== attempt.token)
        return result.status === 'saved' ||
          result.status === 'duplicate' ||
          result.status === 'guest'
          ? rest
          : [...rest, attempt]
      })
      return result
    },
    [],
  )

  const choose = useCallback(
    (choice: string) => {
      if (!question || phase.kind === 'answered') return
      // Shown at once, from the answer the page already has. The server decides
      // what gets written; this is only what the reader sees while it does.
      const correct = choice === question.answer
      const responseTimeMs = Date.now() - shownAt.current

      setPhase({ kind: 'answered', chosen: choice, correct, result: null })
      if (correct) setCorrectCount((n) => n + 1)
      else setMissed((prev) => (prev.some((m) => m === question) ? prev : [...prev, question]))

      const asked = turn.current
      const attempt: Unsaved = {
        token: question.token,
        choice,
        responseTimeMs,
        prompt: question.prompt,
      }
      startTransition(async () => {
        const result = await send(attempt)
        // Moved on already. Whatever the server said belongs to a question that
        // has left the screen, and stamping it on the one showing now would put
        // the wrong verdict under it.
        if (turn.current !== asked) return
        setPhase({ kind: 'answered', chosen: choice, correct, result })
      })
    },
    [phase.kind, question, send],
  )

  /** Sends every answer the server has not taken, in the order they were given. */
  const retryUnsaved = useCallback(() => {
    const queued = unsaved
    startTransition(async () => {
      for (const attempt of queued) await send(attempt)
    })
  }, [send, unsaved])

  const advance = useCallback(() => {
    turn.current += 1
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
        unsaved={unsaved.length}
        retrying={pending}
        onRetryUnsaved={retryUnsaved}
        onRetryMissed={() => {
          turn.current += 1
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
          <span>{KIND_LABEL[question.kind] ?? (question.direction === 'en_ko' ? '영어 → 한국어' : '한국어 → 영어')}</span>
        </div>
      </div>

      <div
        className={`mb-8 flex min-h-28 flex-col items-center justify-center text-center ${
          phase.kind === 'answered' && !phase.correct ? 'animate-shake' : ''
        }`}
      >
        {question.isNew ? <Tag className="mb-3">새 단어</Tag> : null}
        {/* A word is a headline; a sentence is a sentence. Setting a full
            sentence at 2rem pushes the options off the screen and reads as
            shouting. */}
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
          <Feedback
            correct={phase.correct}
            result={phase.result}
            pending={pending}
            vocabularyId={question.vocabularyId}
          />
          {/* The sentence the blank came out of, whole. Without it a student
              who guessed right learns nothing and one who guessed wrong does
              not find out why. */}
          {question.note ? (
            <p className="mt-3 rounded-control bg-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed break-keep">
              {question.note}
            </p>
          ) : null}
          <Button size="lg" className="mt-3 w-full" onClick={advance}>
            다음
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The verdict, and separately whether it was written down.
 *
 * `correct` is the page's own reading of the tap and appears immediately;
 * everything else waits for the server. Keeping them apart is what lets the
 * screen stay fast and still be honest — a saved answer and one the server
 * refused look completely different here, where before both looked like a
 * green tick.
 */
function Feedback({
  correct,
  result,
  pending,
  vocabularyId,
}: {
  correct: boolean
  result: AnswerResult | null
  pending: boolean
  vocabularyId: string
}) {
  const scheduled = result && 'nextReviewLabel' in result ? result.nextReviewLabel : ''
  const recommended = Boolean(result && 'brainMapRecommended' in result && result.brainMapRecommended)
  const trouble =
    result?.status === 'failed'
      ? result.message
      : result?.status === 'rejected'
        ? '이 문제를 확인하지 못해 결과를 저장하지 않았어요.'
        : null

  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className={correct ? 'text-good' : 'text-bad'}>
          {correct ? '정답이에요' : '다시 만나볼게요'}
        </span>
        {!pending && scheduled ? (
          <span className="text-xs text-ink-3">다음 복습 {scheduled}</span>
        ) : null}
      </div>

      {trouble ? (
        <p className="mt-2 text-xs text-warn break-keep">{trouble} 마지막 화면에서 다시 시도할 수 있어요.</p>
      ) : null}

      {recommended && result && 'recommendationMessage' in result ? (
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
  unsaved,
  retrying,
  onRetryUnsaved,
  onRetryMissed,
  onDone,
}: {
  total: number
  correct: number
  missed: RecallQuestion[]
  unsaved: number
  retrying: boolean
  onRetryUnsaved: () => void
  onRetryMissed: () => void
  onDone: () => void
}) {
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0

  return (
    <div className="animate-rise">
      <div className="py-6 text-center">
        {/* Not "완료" while anything is still unsaved. The number on this screen
            is what the reader believes their record now says, and saying it is
            finished when part of it never arrived is the one thing this screen
            must not do. */}
        <p className="text-[0.8125rem] text-ink-3">
          {unsaved > 0 ? '아직 저장되지 않은 답이 있어요' : '오늘 학습 완료'}
        </p>
        <p className="numeral mt-1.5 text-[3rem] font-semibold leading-none">{accuracy}%</p>
        <p className="numeral mt-1.5 text-[0.8125rem] text-ink-3">
          {total}문제 중 {correct}문제 정답
        </p>
      </div>

      {unsaved > 0 ? (
        <div className="mt-6 rounded-panel bg-warn-soft px-4 py-3.5">
          <p className="numeral text-[0.8125rem] text-warn break-keep">
            {unsaved}개의 답을 저장하지 못했어요. 복습 일정에 아직 반영되지 않았습니다.
          </p>
          <Button
            variant="secondary"
            className="mt-3 w-full"
            disabled={retrying}
            onClick={onRetryUnsaved}
          >
            {retrying ? '다시 저장하는 중…' : '다시 저장하기'}
          </Button>
          {/* Said plainly rather than implied: these live in this page only. */}
          <p className="mt-2 text-xs text-warn break-keep">
            새로고침하면 이 답들은 사라집니다. 그때는 다시 풀어 주세요.
          </p>
        </div>
      ) : null}

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
