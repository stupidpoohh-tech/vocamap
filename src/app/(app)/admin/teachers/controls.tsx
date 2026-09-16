'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { grantTeacherRole, issueTemporaryPassword, revokeTeacherVerification } from '../actions'
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

/**
 * One account, and the temporary password it was just given.
 *
 * The password appears here and nowhere else — it is not stored, not mailed,
 * not written to a log — so the row keeps showing it until the page is
 * reloaded, and says plainly that this is the only time it will be readable.
 */
export function ResetRow({
  account,
}: {
  account: {
    id: string
    email: string
    displayName: string
    role: string
    mustChangePasswordAt: Date | null
  }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [issued, setIssued] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem]">
            {account.displayName}
            {account.role === 'teacher' ? (
              <span className="ml-1.5 text-xs text-ink-3">선생님</span>
            ) : null}
          </span>
          <span className="block truncate text-xs text-ink-3">{account.email}</span>
          {account.mustChangePasswordAt && !issued ? (
            <span className="mt-0.5 block text-xs text-ink-3 break-keep">
              임시 비밀번호를 아직 바꾸지 않았습니다.
            </span>
          ) : null}
          {message ? <span className="mt-0.5 block text-xs text-bad">{message}</span> : null}
        </span>
        <Button
          variant="secondary"
          disabled={pending}
          className="shrink-0"
          onClick={() =>
            startTransition(async () => {
              const result = await issueTemporaryPassword(account.id)
              if (result.ok) {
                setIssued(result.password)
                setMessage(null)
                router.refresh()
              } else {
                setMessage(result.error)
              }
            })
          }
        >
          {pending ? '발급 중…' : issued ? '다시 발급' : '임시 비밀번호'}
        </Button>
      </div>

      {issued ? (
        <div className="mt-2 rounded-control bg-sunken px-3 py-2">
          <p className="font-mono text-[1.0625rem] tracking-wide select-all">{issued}</p>
          <p className="mt-1 text-xs text-ink-3 break-keep">
            지금 이 화면에서만 볼 수 있습니다. 새로고침하면 사라지고, 다시 보려면 새로 발급해야
            합니다.
          </p>
        </div>
      ) : null}
    </li>
  )
}
