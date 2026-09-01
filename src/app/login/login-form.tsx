'use client'

import { useActionState, useState } from 'react'
import { Button, Card, Input } from '@/components/ui'
import { signIn, signUp, type AuthFormState } from './actions'

const initial: AuthFormState = {}

export function LoginForm() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const action = mode === 'signin' ? signIn : signUp
  const [state, formAction, pending] = useActionState(action, initial)

  return (
    <Card>
      <div className="mb-5 flex gap-1 rounded-xl bg-line/40 p-1">
        {(['signin', 'signup'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              mode === value ? 'bg-surface text-ink shadow-sm' : 'text-muted'
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
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-base"
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
