'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import type { Exercise, SemanticNode } from '@/lib/data/semantic-map'
import { cn } from '@/lib/utils'

/**
 * The practice card.
 *
 * Tight on a phone, where it has to share one screen height with the map, and
 * roomier from tablet up, where it does not. Lifted rather than outlined, like
 * the cards on the map, so the two read as one family.
 */
const CARD =
  'rounded-panel bg-surface px-4 py-3.5 shadow-panel ring-1 ring-line-soft sm:px-6 sm:py-4'

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
      <section className={CARD}>
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
      {/* A marker and a word, not a pill. The grey chip was a box inside a box
          that said less than the two characters of colour beside it do. */}
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="text-[0.6875rem] tracking-[0.06em] text-ink-2">지금 학습 중</span>
        </span>
        {step ? <span className="numeral text-[0.6875rem] text-ink-3">{step}</span> : null}
      </div>
      {/* From tablet up the category sits under the label, as a caption does.
          On a phone that costs a whole line the screen does not have — the map
          and this card share one height there — so the two share a baseline. */}
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 sm:mt-2.5 sm:block">
        <span className="text-[1.0625rem] leading-snug font-semibold tracking-[-0.012em] break-keep sm:text-[1.1875rem]">
          {node.label}
        </span>
        <span className="text-xs text-ink-3 sm:mt-1.5 sm:block">{node.eyebrow}</span>
      </p>
    </>
  )
}

/**
 * A rule with a mark on it.
 *
 * A plain hairline says "another section"; this says "same card, next part" —
 * which is what the step from the thing being learned to the question actually
 * is.
 */
function Divider() {
  return (
    <div aria-hidden className="my-2.5 flex items-center gap-2 sm:my-4">
      <span className="h-px flex-1 bg-line-soft" />
      <span className="h-[3px] w-[3px] rounded-full bg-line" />
      <span className="h-px flex-1 bg-line-soft" />
    </div>
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
    <section className={CARD}>
      <Heading node={node} step={`${index + 1} / ${node.exercises.length}`} />

      <Divider />
      <div>
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
        <div className="animate-rise">
          <Divider />
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={cn(
                'text-sm font-medium',
                answered.correct ? 'text-good' : 'text-bad',
              )}
            >
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
            <p className="mt-2 rounded-control bg-sunken px-3.5 py-2.5 text-[0.8125rem] break-keep">
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
      <p className="text-[0.9375rem] leading-[1.6] break-keep sm:text-base">{exercise.prompt}</p>
      {/* Two columns, so a pair of choices reads as a pair rather than as a
          stack the eye has to walk down. Three or four wrap onto a second row
          at the same width. */}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:mt-3 sm:gap-2">
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
                // Wells, not cards: recessed neutral fills inside the panel,
                // with no shadow and no accent of their own. Answers are not
                // the thing on this screen that should be coloured — being
                // right or wrong is, and only once you have chosen.
                'rounded-control px-2.5 py-2 text-left text-[0.8125rem] leading-[1.45] transition',
                'duration-150 disabled:cursor-default sm:px-3.5 sm:py-3 sm:text-sm',
                answered && isAnswer
                  ? 'bg-good-soft text-good ring-1 ring-good/25'
                  : answered && picked
                    ? 'bg-bad-soft text-bad ring-1 ring-bad/25'
                    : answered
                      ? 'bg-sunken text-ink-3'
                      : 'bg-sunken text-ink hover:bg-surface hover:ring-1 hover:ring-line',
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
      <p className="text-[0.9375rem] leading-[1.6] sm:text-base">
        {highlight(exercise.prompt, exercise.highlight)}
      </p>

      {!revealed ? (
        <div className="mt-4 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            rows={2}
            placeholder="직접 해석해 보세요"
            className="w-full resize-none rounded-control bg-sunken px-3.5 py-2.5 text-sm ring-1 ring-line focus:bg-surface focus:ring-brand-line focus:outline-none"
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
