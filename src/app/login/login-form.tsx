'use client'

import { useActionState, useState } from 'react'
import { Button, Card, Input } from '@/components/ui'
import { signIn, signUp, type AuthFormState } from './actions'

const initial: AuthFormState = {}

export function LoginForm({
  initialMode = 'signin',
}: {
  initialMode?: 'signin' | 'signup'
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode)
  const action = mode === 'signin' ? signIn : signUp
  const [state, formAction, pending] = useActionState(action, initial)

  return (
    <Card>
      {/* Two text tabs with an underline. This was a segmented control — a
          filled track holding two rounded buttons and a shadow — for a choice
          between two words. */}
      <div className="mb-5 flex gap-5 border-b border-line">
        {(['signin', 'signup'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`-mb-px border-b-2 pb-2.5 text-sm transition ${
              mode === value ? 'border-brand text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'
            }`}
          >
            {value === 'signin' ? '로그인' : '회원가입'}
          </button>
        ))}
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        {mode === 'signup' ? (
          <>
            <Input name="displayName" placeholder="이름" autoComplete="name" required />
            <select
              name="role"
              defaultValue="student"
              className="w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[0.9375rem]"
            >
              <option value="student">학생</option>
              <option value="teacher">선생님</option>
            </select>
          </>
        ) : null}

        <Input
          name="email"
          type="email"
          placeholder="이메일"
          autoComplete="email"
          inputMode="email"
          required
        />
        <Input
          name="password"
          type="password"
          placeholder="비밀번호"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          required
        />

        {state.error ? (
          <p role="alert" className="text-sm font-medium text-bad">
            {state.error}
          </p>
        ) : null}

        <Button size="lg" disabled={pending} className="mt-1">
          {pending ? '잠시만요…' : mode === 'signin' ? '로그인' : '시작하기'}
        </Button>
      </form>
    </Card>
  )
}
