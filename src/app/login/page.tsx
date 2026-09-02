import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>
}) {
  const actor = await getActor()
  if (actor) redirect('/')

  // The landing page's two calls to action land on the same screen; this is
  // what decides which tab they open on.
  const { mode } = await searchParams
  const initialMode = mode === 'signup' ? 'signup' : 'signin'

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <Link
        href="/"
        className="mb-8 inline-block text-sm font-bold tracking-wide text-brand hover:opacity-80"
      >
        ← VOCA BRAIN MAP
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold leading-snug tracking-tight break-keep">
          {initialMode === 'signup' ? '계정을 만들고 시작하세요' : '다시 오셨네요'}
        </h1>
        <p className="mt-1.5 text-sm text-muted break-keep">
          {initialMode === 'signup'
            ? '학생은 선생님이 단어를 배정하면 바로 학습을 시작할 수 있어요.'
            : '이어서 오늘의 학습을 진행해요.'}
        </p>
      </div>

      <LoginForm initialMode={initialMode} />
    </main>
  )
}
