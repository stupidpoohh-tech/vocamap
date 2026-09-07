'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui'

/**
 * What a student sees when a screen fails.
 *
 * Without this they get the framework's own page — a black screen, an English
 * sentence and a number — which says nothing they can act on and does not look
 * like the app they were using a second ago.
 *
 * It says the same three things every honest error screen says: something
 * broke, it was not your fault, here is the way back. The digest is kept
 * because it is the only handle on which failure this was in the Worker's
 * logs, and it is small and at the bottom because it is for us, not for them.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The Worker logs the server side; this is the half that only the browser
    // sees, and it is otherwise thrown away.
    console.error(error)
  }, [error])

  return (
    <div className="animate-rise py-16 text-center">
      <p className="text-lg font-semibold">화면을 열지 못했어요</p>
      <p className="mt-2 text-sm text-ink-2 break-keep">
        잠시 문제가 있었어요. 다시 시도하면 대부분 열립니다.
      </p>
      <p className="mt-1 text-sm text-ink-3 break-keep">공부한 기록은 그대로 있어요.</p>

      <div className="mt-6 flex justify-center">
        <Button onClick={reset}>다시 시도</Button>
      </div>

      {error.digest ? (
        <p className="numeral mt-8 text-[0.6875rem] text-ink-3">오류 {error.digest}</p>
      ) : null}
    </div>
  )
}
