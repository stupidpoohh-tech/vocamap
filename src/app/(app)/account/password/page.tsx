import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'
import { Card, PageHeader } from '@/components/ui'
import { PasswordForm } from './form'

export const metadata = { title: '비밀번호 변경' }

/**
 * Where a temporary password is turned into the account owner's own.
 *
 * Reachable at any time, not only after a reset — a password you want to
 * change is a password you should be able to change. `forced` only decides
 * what the screen says; the work is the same either way.
 */
export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ forced?: string; next?: string }>
}) {
  const actor = await getActor()
  if (!actor) redirect('/login?next=/account/password')

  const params = await searchParams
  const forced = params.forced === '1' || Boolean(actor.mustChangePasswordAt)
  const destination = safeNext(params.next)

  return (
    <div className="animate-rise">
      <PageHeader
        title="비밀번호 변경"
        subtitle={
          forced
            ? '임시 비밀번호로 로그인하셨습니다. 본인만 아는 비밀번호로 바꿔 주세요.'
            : '새 비밀번호로 바꾸면 다른 기기에서는 모두 로그아웃됩니다.'
        }
      />

      {forced ? (
        <Card className="mb-4 border-brand/40 bg-brand/5">
          <p className="text-[0.875rem] leading-relaxed break-keep">
            지금 쓰고 있는 비밀번호는 선생님이 발급한 임시 비밀번호입니다. 선생님도 알고 있는
            비밀번호이므로, 바꾸기 전까지는 로그인할 때마다 이 화면이 먼저 열립니다.
          </p>
        </Card>
      ) : null}

      <PasswordForm destination={destination} />

      <p className="mt-4 text-xs text-ink-3 break-keep">
        {actor.email} 계정의 비밀번호를 바꿉니다.
      </p>
    </div>
  )
}

function safeNext(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/study'
}
