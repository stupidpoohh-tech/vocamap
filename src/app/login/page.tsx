import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'
import { SIGNED_OUT, type SignedOutReason } from '@/lib/auth/lifetime'
import { LoginForm } from './login-form'

/**
 * Why the sign-in screen is showing, when it is showing uninvited.
 *
 * Landing back here used to say nothing at all, so an expired session, a
 * revoked one and a changed role were the same blank screen — to the reader,
 * and to anyone they reported it to. The wording stays plain; the parameter is
 * what makes the cause reportable.
 */
const WHY: Record<SignedOutReason, string> = {
  session: '로그인이 만료되어 다시 로그인이 필요합니다.',
  invalid: '로그인 정보를 확인할 수 없어 다시 로그인이 필요합니다.',
  expired: '로그인이 만료되어 다시 로그인이 필요합니다.',
  mismatch: '다른 계정으로 바뀌어 다시 로그인이 필요합니다.',
  role: '계정 권한이 바뀌어 다시 로그인이 필요합니다.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string; [SIGNED_OUT]?: string }>
}) {
  const params = await searchParams
  const { mode, next } = params
  const why = WHY[params[SIGNED_OUT] as SignedOutReason]
  const actor = await getActor()
  if (actor) redirect(safeNext(next) ?? '/')

  const initialMode = mode === 'signup' ? 'signup' : 'signin'
  // Only a path inside this app, so a crafted link cannot bounce someone off
  // to another site once they have signed in.
  const back = safeNext(next)

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <Link
        href={back ?? '/study'}
        className="mb-8 inline-block text-[0.8125rem] font-medium text-ink-2 hover:opacity-80"
      >
        ← 돌아가기
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold leading-snug tracking-tight break-keep">
          {back
            ? '이 단어를 담으려면 로그인이 필요해요'
            : initialMode === 'signup'
              ? '계정을 만들고 시작하세요'
              : '다시 오셨네요'}
        </h1>
        <p className="mt-1.5 text-sm text-ink-3 break-keep">
          {back
            ? '단어와 맵은 로그인 없이 볼 수 있어요. 모르는 단어를 보관함에 담고 복습 기록을 남기려면 계정이 필요합니다.'
            : initialMode === 'signup'
              ? '학생은 선생님이 단어를 배정하면 바로 학습을 시작할 수 있어요.'
              : '이어서 오늘의 학습을 진행해요.'}
        </p>
      </div>

      {why ? (
        <p
          role="status"
          className="mb-4 rounded-control bg-sunken px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink-2 break-keep"
        >
          {why}
        </p>
      ) : null}

      <LoginForm initialMode={initialMode} next={back} />
    </main>
  )
}

/** A `next` we are willing to follow: a path in this app, never another site. */
function safeNext(next: string | undefined): string | undefined {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return undefined
  return next
}
