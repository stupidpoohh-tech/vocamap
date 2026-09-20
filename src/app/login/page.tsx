import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string }>
}) {
  const { mode, next } = await searchParams
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

      <LoginForm initialMode={initialMode} next={back} />
    </main>
  )
}

/** A `next` we are willing to follow: a path in this app, never another site. */
function safeNext(next: string | undefined): string | undefined {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return undefined
  return next
}
