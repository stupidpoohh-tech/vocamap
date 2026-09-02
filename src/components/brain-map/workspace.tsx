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
      <section className="rounded-card border border-line bg-surface px-5 py-5">
        <Heading node={node} />
        <p className="mt-3 text-sm leading-relaxed text-ink-2 break-keep">
          {node.secondaryLabel ?? '아직 이 항목의 문제가 준비되지 않았어요.'}
        </p>
      </section>
    )
  }

  return <Runner key={node.id} node={node} onAnswer={onAnswer} />
}

function Heading({ node, step }: { node: SemanticNode; step?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] text-ink-3">지금 학습 중</p>
        <p className="mt-0.5 text-lg font-medium break-keep">{node.label}</p>
        <p className="mt-0.5 text-xs text-ink-3">{node.eyebrow}</p>
      </div>
      {step ? <span className="shrink-0 numeral text-xs text-ink-3">{step}</span> : null}
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
    <section className="rounded-card border border-line bg-surface px-5 py-5">
      <Heading node={node} step={`${index + 1} / ${node.exercises.length}`} />

      <div className="mt-5">
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
        <div className="mt-5 animate-rise border-t border-line pt-4">
          <p
            className={cn(
              'text-sm font-semibold',
              answered.correct ? 'text-good' : 'text-bad',
            )}
          >
            {answered.correct ? '정답입니다' : '다시 볼게요'}
          </p>

          {exercise.kind === 'choice' ? (
            <p className="mt-2 text-sm leading-relaxed break-keep">{exercise.explanation}</p>
          ) : (
            <p className="mt-2 rounded-lg bg-line/30 px-3 py-2.5 text-sm break-keep">
              {exercise.answer}
            </p>
          )}

          {exercise.concept ? (
            <p className="mt-3 border-l-2 border-brand/30 pl-3 text-sm leading-relaxed text-ink-2 break-keep">
              {exercise.concept}
            </p>
          ) : null}

          {!last ? (
            <Button
              className="mt-4"
              onClick={() => {
                setIndex((i) => i + 1)
                setAnswered(null)
                setDraft('')
              }}
            >
              다음 문제 →
            </Button>
          ) : (
            <p className="mt-4 text-sm text-ink-2 break-keep">
              이 항목은 끝났어요. 맵에서 다른 연결을 골라보세요.
            </p>
          )}
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
      <p className="text-base leading-relaxed break-keep">{exercise.prompt}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {exercise.options.map((option) => {
          const isAnswer = option === exercise.answer
          const picked = answered?.given === option
          return (
            <Button
              key={option}
              variant="secondary"
              disabled={Boolean(answered)}
              className={cn(
                'flex-1 basis-[45%] justify-center',
                answered && isAnswer && 'border-good bg-good-soft text-good',
                answered && picked && !isAnswer && 'border-bad bg-bad-soft text-bad',
              )}
              onClick={() => onSubmit(option, isAnswer)}
            >
              <span className="break-keep">{option}</span>
            </Button>
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
      <p className="text-lg leading-relaxed">
        {highlight(exercise.prompt, exercise.highlight)}
      </p>

      {!revealed ? (
        <div className="mt-4 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            rows={2}
            placeholder="직접 해석해 보세요"
            className="w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <Button variant="secondary" onClick={() => setRevealed(true)}>
            해석 확인
          </Button>
        </div>
      ) : !answered ? (
        <div className="mt-4">
          <p className="rounded-lg bg-line/30 px-3 py-2.5 text-sm break-keep">{exercise.answer}</p>
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
