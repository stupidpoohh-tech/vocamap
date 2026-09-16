import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui'

export const metadata = { title: '비밀번호 찾기' }

/**
 * What to do when you cannot sign in.
 *
 * There is no reset link in an email, because this app sends no email — and a
 * screen that pretends otherwise would leave a student waiting for a message
 * that never arrives. The honest path is the one that already exists: the
 * person who runs the class issues a new password, and the student replaces it
 * the first time they sign in.
 */
export default function LoginHelpPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <PageHeader title="비밀번호 찾기" subtitle="선생님이 임시 비밀번호를 발급해 드립니다." />

      <Card>
        <ol className="flex flex-col gap-4 text-[0.9375rem] leading-relaxed break-keep">
          <li className="flex gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-semibold text-ink-2">
              1
            </span>
            <span>
              선생님께 <strong className="font-semibold">가입할 때 쓴 이메일 주소</strong>를 알려
              주세요.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-semibold text-ink-2">
              2
            </span>
            <span>선생님이 임시 비밀번호를 만들어 직접 전달해 드립니다.</span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-semibold text-ink-2">
              3
            </span>
            <span>
              그 비밀번호로 로그인하면 <strong className="font-semibold">비밀번호 변경 화면</strong>
              이 먼저 열립니다. 본인만 아는 비밀번호로 바꿔 주세요.
            </span>
          </li>
        </ol>

        <p className="mt-5 border-t border-line-soft pt-4 text-xs text-ink-3 break-keep">
          임시 비밀번호가 발급되면 기존 비밀번호는 바로 쓸 수 없게 되고, 로그인해 두었던 기기에서도
          모두 로그아웃됩니다. 다른 사람에게 전달된 비밀번호가 그대로 남지 않게 하기 위한 것입니다.
        </p>
      </Card>

      <p className="mt-6 text-center">
        <Link
          href="/login"
          className="text-[0.8125rem] text-ink-3 underline underline-offset-4 transition hover:text-ink-2"
        >
          로그인으로 돌아가기
        </Link>
      </p>
    </main>
  )
}
