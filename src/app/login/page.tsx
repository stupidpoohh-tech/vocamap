import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'
import { LoginForm } from './login-form'

export default async function LoginPage() {
  const actor = await getActor()
  if (actor) redirect('/')

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8">
        <p className="text-sm font-semibold tracking-wide text-brand">VOCA BRAIN MAP</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight">
          암기는 반복하고,
          <br />
          이해가 필요한 단어는 연결한다.
        </h1>
      </div>
      <LoginForm />
    </main>
  )
}
