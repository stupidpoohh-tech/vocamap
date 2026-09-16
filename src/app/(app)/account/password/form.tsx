'use client'

import { useActionState } from 'react'
import { Button, Card, Input } from '@/components/ui'
import { changePassword, type PasswordFormState } from './actions'

const initial: PasswordFormState = {}

export function PasswordForm({ destination }: { destination: string }) {
  const [state, formAction, pending] = useActionState(changePassword, initial)

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="destination" value={destination} />

        {/* The browser is told which field is which. Without this a password
            manager offers to fill all three with the same saved value, and the
            change silently fails on "지금 쓰고 있는 비밀번호와 같습니다". */}
        <Input
          name="current"
          type="password"
          placeholder="현재 비밀번호"
          autoComplete="current-password"
          required
        />
        <Input
          name="next"
          type="password"
          placeholder="새 비밀번호 (8자 이상)"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <Input
          name="confirm"
          type="password"
          placeholder="새 비밀번호 확인"
          autoComplete="new-password"
          minLength={8}
          required
        />

        {state.error ? (
          <p role="alert" className="text-sm font-medium text-bad break-keep">
            {state.error}
          </p>
        ) : null}

        <Button size="lg" disabled={pending} className="mt-1">
          {pending ? '바꾸는 중…' : '비밀번호 바꾸기'}
        </Button>
      </form>
    </Card>
  )
}
