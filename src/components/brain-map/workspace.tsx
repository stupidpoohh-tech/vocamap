'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import type { Exercise, SemanticNode } from '@/lib/data/semantic-map'
import { cn } from '@/lib/utils'

export type WorkspaceAnswer = (input: {
  node: SemanticNode
  correct: boolean
  responseTimeMs: number
  payload: Record<string, unknown>
}) => void

/**
 * Where a node is actually practised.
 *
 * Order is question → answer → feedback → concept. The explanation is what you
 * get for having tried, not what you read instead of trying: showing the
 * difference between two words before asking about them is how a student comes
 * away agreeing with it and still unable to use it.
 */
export function Workspace({
  node,
  onAnswer,
}: {
  node: SemanticNode | null
  onAnswer: WorkspaceAnswer
}) {
  if (!node) {
    // A prompt, not a placeholder box. An empty dashed rectangle takes up more
    // of the page than the sentence inside it.
    return (
      <p className="py-8 text-center text-[0.8125rem] text-ink-3 break-keep">
        맵에서 항목을 선택하면 여기에서 바로 풀어볼 수 있어요.
      </p>
    )
  }

  if (!node.exercises.length) {
    return (
      <section className="rounded-container border border-line bg-surface px-4 py-3">
        <Heading node={node} />
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-2 break-keep">
          {node.secondaryLabel ?? '아직 이 항목의 문제가 준비되지 않았어요.'}
        </p>
      </section>
    )
  }

  return <Runner key={node.id} node={node} onAnswer={onAnswer} />
}

/**
 * One line of state, then the thing being learned.
 *
 * This was three stacked lines — a label, the node, its category — above a
 * fourth line of progress, which is four rows of chrome before the question.
 * The label and the count share a row now and the category rides beside the
 * node it describes.
 */
function Heading({ node, step }: { node: SemanticNode; step?: string }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-chip bg-sunken px-2 py-0.5 text-[11px] text-ink-2">
          지금 학습 중
        </span>
        {step ? <span className="numeral text-xs text-ink-3">{step}</span> : null}
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-base font-medium leading-snug break-keep">{node.label}</span>
        <span className="text-xs text-ink-3">{node.eyebrow}</span>
      </p>
    </>
  )
}

function Runner({ node, onAnswer }: { node: SemanticNode; onAnswer: WorkspaceAnswer }) {
  const [index, setIndex] = useState(0)
  const [answered, setAnswered] = useState<{ correct: boolean; given: string } | null>(null)
  const [draft, setDraft] = useState('')
  const startedAt = useRef(Date.now())

  const exercise = node.exercises[index]

  useEffect(() => {
    startedAt.current = Date.now()
  }, [index])

  if (!exercise) return null

  const submit = (given: string, correct: boolean) => {
    if (answered) return
    setAnswered({ correct, given })
    onAnswer({
      node,
      correct,
      responseTimeMs: Date.now() - startedAt.current,
      payload: { itemId: node.itemId, kind: node.kind, given },
    })
  }

  const last = index === node.exercises.length - 1

  return (
    // Compact on purpose: the map above it is the point of the screen, and
    // the two have to share one phone height.
    <section className="rounded-container border border-line bg-surface px-4 py-3">
      <Heading node={node} step={`${index + 1} / ${node.exercises.length}`} />

      <div className="mt-3 border-t border-line-soft pt-3">
        {exercise.kind === 'choice' ? (
          <ChoiceExercise exercise={exercise} answered={answered} onSubmit={submit} />
        ) : (
          <TranslateExercise
            exercise={exercise}
            answered={answered}
            draft={draft}
            onDraft={setDraft}
            onSubmit={submit}
          />
        )}
      </div>

      {answered ? (
        <div className="mt-3 animate-rise border-t border-line-soft pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className={cn('text-sm', answered.correct ? 'text-good' : 'text-bad')}>
              {answered.correct ? '정답입니다' : '다시 볼게요'}
            </span>
            {!last ? (
              <button
                type="button"
                onClick={() => {
                  setIndex((i) => i + 1)
                  setAnswered(null)
                  setDraft('')
                }}
                className="shrink-0 text-sm text-brand transition hover:opacity-80"
              >
                다음 문제 →
              </button>
            ) : (
              <span className="shrink-0 text-xs text-ink-3">이 항목 완료</span>
            )}
          </div>

          {exercise.kind === 'choice' ? (
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-2 break-keep">
              {exercise.explanation}
            </p>
          ) : (
            <p className="mt-2 rounded-control bg-sunken px-3 py-2 text-[0.8125rem] break-keep">
              {exercise.answer}
            </p>
          )}

          {exercise.concept ? (
            <p className="mt-2 border-l-2 border-brand-line pl-2.5 text-[0.8125rem] leading-relaxed text-ink-3 break-keep">
              {exercise.concept}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function ChoiceExercise({
  exercise,
  answered,
  onSubmit,
}: {
  exercise: Extract<Exercise, { kind: 'choice' }>
  answered: { correct: boolean; given: string } | null
  onSubmit: (given: string, correct: boolean) => void
}) {
  return (
    <>
      <p className="text-sm leading-relaxed break-keep sm:text-[0.9375rem]">{exercise.prompt}</p>
      {/* Two columns, so a pair of choices reads as a pair rather than as a
          stack the eye has to walk down. Three or four wrap onto a second row
          at the same width. */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        {exercise.options.map((option) => {
          const isAnswer = option === exercise.answer
          const picked = answered?.given === option
          return (
            <button
              key={option}
              type="button"
              disabled={Boolean(answered)}
              onClick={() => onSubmit(option, isAnswer)}
              className={cn(
                'rounded-card border px-2.5 py-1.5 text-left text-[0.8125rem] leading-[1.4] transition',
                'disabled:cursor-default',
                answered && isAnswer
                  ? 'border-good/40 bg-good-soft text-good'
                  : answered && picked
                    ? 'border-bad/40 bg-bad-soft text-bad'
                    : answered
                      ? 'border-line text-ink-3'
                      : 'border-line bg-surface hover:border-ink-3',
              )}
            >
              <span className="break-keep">{option}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function TranslateExercise({
  exercise,
  answered,
  draft,
  onDraft,
  onSubmit,
}: {
  exercise: Extract<Exercise, { kind: 'translate' }>
  answered: { correct: boolean; given: string } | null
  draft: string
  onDraft: (value: string) => void
  onSubmit: (given: string, correct: boolean) => void
}) {
  const [revealed, setRevealed] = useState(false)

  return (
    <>
      <p className="text-sm leading-relaxed sm:text-[0.9375rem]">
        {highlight(exercise.prompt, exercise.highlight)}
      </p>

      {!revealed ? (
        <div className="mt-4 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            rows={2}
            placeholder="직접 해석해 보세요"
            className="w-full resize-none rounded-control border border-line bg-paper px-3 py-2 text-sm focus:border-brand-line focus:outline-none"
          />
          <Button variant="secondary" onClick={() => setRevealed(true)}>
            해석 확인
          </Button>
        </div>
      ) : !answered ? (
        <div className="mt-4">
          <p className="rounded-control bg-sunken px-3 py-2 text-[0.8125rem] break-keep">{exercise.answer}</p>
          <p className="mt-3 mb-2 text-xs text-ink-2">내 해석과 비교했을 때 어땠나요?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => onSubmit(draft, true)}>
              맞았어요
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => onSubmit(draft, false)}>
              틀렸어요
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

function highlight(text: string, target: string | null) {
  if (!target) return text
  const index = text.toLowerCase().indexOf(target.toLowerCase())
  if (index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-chip bg-brand-soft px-0.5 font-medium text-brand">
        {text.slice(index, index + target.length)}
      </mark>
      {text.slice(index + target.length)}
    </>
  )
}
