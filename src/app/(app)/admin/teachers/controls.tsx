'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { grantTeacherRole, revokeTeacherVerification } from '../actions'
import { approveLinkForStudent } from '../../study/link-actions'

type Account = { id: string; email: string; displayName: string; verifiedAt?: Date | null }

/**
 * One account and the one thing an admin can do to it.
 *
 * Verify and grant are the same server call — an account becoming a curator is
 * an admin naming it, whether or not it already carried the word "teacher".
 */
export function AccountRow({
  account,
  action,
}: {
  account: Account
  action: 'verify' | 'grant' | 'revoke'
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const label = action === 'revoke' ? '권한 회수' : action === 'grant' ? '선생님으로' : '확인'

  const run = () =>
    startTransition(async () => {
      const result =
        action === 'revoke'
          ? await revokeTeacherVerification(account.id)
          : await grantTeacherRole(account.id)
      setMessage(result.ok ? null : result.error)
      if (result.ok) router.refresh()
    })

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem]">{account.displayName}</span>
        <span className="block truncate text-xs text-ink-3">{account.email}</span>
        {message ? <span className="mt-0.5 block text-xs text-bad">{message}</span> : null}
      </span>
      <Button
        variant={action === 'revoke' ? 'secondary' : 'primary'}
        disabled={pending}
        onClick={run}
        className="shrink-0"
      >
        {pending ? '처리 중…' : label}
      </Button>
    </li>
  )
}

export function LinkRow({
  link,
}: {
  link: {
    id: string
    teacherName: string
    teacherEmail: string
    studentName: string
    studentEmail: string
  }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] break-keep">
          {link.teacherName} → {link.studentName}
        </span>
        <span className="block truncate text-xs text-ink-3">{link.studentEmail}</span>
        {message ? <span className="mt-0.5 block text-xs text-bad">{message}</span> : null}
      </span>
      <Button
        variant="secondary"
        disabled={pending}
        className="shrink-0"
        onClick={() =>
          startTransition(async () => {
            const result = await approveLinkForStudent(link.id)
            setMessage(result.error ?? null)
            if (!result.error) router.refresh()
          })
        }
      >
        {pending ? '처리 중…' : '대신 승인'}
      </Button>
    </li>
  )
}
