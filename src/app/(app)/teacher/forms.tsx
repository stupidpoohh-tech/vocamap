'use client'

import { useActionState } from 'react'
import { Button, Card, Input, Textarea } from '@/components/ui'
import {
  addStudent,
  fillDefinitionReadingBatch,
  importWords,
  type ImportState,
  type LinkState,
  type ReadingState,
} from './actions'

export function AddStudentForm() {
  const [state, action, pending] = useActionState<LinkState, FormData>(addStudent, {})
  return (
    <Card>
      <form action={action} className="flex flex-col gap-3 sm:flex-row">
        <Input name="email" type="email" placeholder="학생 이메일" className="sm:flex-1" required />
        <Button disabled={pending}>{pending ? '추가 중…' : '학생 추가'}</Button>
      </form>
      <Feedback state={state} />
    </Card>
  )
}

export function ImportWordsForm({
  students,
}: {
  students: Array<{ id: string; displayName: string }>
}) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importWords, {})

  return (
    <Card>
      <form action={action} className="flex flex-col gap-3">
        <Input name="title" placeholder="세트 이름 (예: 2026 고2 9월 모의고사)" required />

        <Textarea
          name="words"
          rows={8}
          className="font-mono text-sm"
          placeholder={'한 줄에 한 단어\nmaintain, 유지하다, verb\nsignificant, 중요한\ncontribute'}
          required
        />
        <p className="-mt-1 text-xs text-ink-3">
          단어만 적어도 되고, 쉼표로 뜻과 품사를 함께 적어도 됩니다. 이미 등록된 단어는 기존
          Brain Map을 그대로 재사용합니다.
        </p>

        {students.length > 0 ? (
          <select
            name="studentId"
            defaultValue=""
            className="w-full rounded-card border border-line bg-surface px-4 py-3 text-base"
          >
            <option value="">배정하지 않음</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}에게 배정
              </option>
            ))}
          </select>
        ) : null}

        <Button disabled={pending}>{pending ? '가져오는 중…' : '가져오기'}</Button>
      </form>
      <Feedback state={state} />
    </Card>
  )
}

function Feedback({ state }: { state: { error?: string; message?: string } }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-3 text-sm font-medium text-bad">
        {state.error}
      </p>
    )
  }
  if (state.message) {
    return <p className="mt-3 text-sm font-medium text-good">{state.message}</p>
  }
  return null
}

/**
 * The one button in the app that spends money.
 *
 * A teacher's list prints the English definition and its Korean meaning, and
 * almost never what the definition itself says — which is what the map holds
 * back and reveals, and typing fifty of them by hand is the reason that reveal
 * would go unpressed. The count is on the button so the tutor knows what a
 * press costs before pressing it, and it is paid once per definition for every
 * student who will ever see it.
 */
export function FillReadingsForm({ missing, batch }: { missing: number; batch: number }) {
  const [state, action, pending] = useActionState<ReadingState, FormData>(
    () => fillDefinitionReadingBatch(),
    {},
  )

  if (missing === 0) {
    return <p className="text-[0.8125rem] text-ink-3">모든 영영 풀이에 해석이 있어요.</p>
  }

  return (
    <div>
      <p className="mb-3 text-[0.8125rem] leading-relaxed text-ink-3 break-keep">
        해석이 없는 영영 풀이 <span className="numeral text-ink-2">{missing}</span>개. 한 번에{' '}
        {batch}개씩 채워요. 표에 해석 열을 직접 넣었다면 그것이 우선이고, 여기서 덮어쓰지
        않아요.
      </p>
      <form action={action}>
        <Button disabled={pending}>
          {pending ? '가져오는 중…' : `해석 ${Math.min(missing, batch)}개 채우기`}
        </Button>
      </form>
      <Feedback state={state} />
    </div>
  )
}
