'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { removeWord } from '@/app/(app)/admin/[id]/edit-actions'

/**
 * Removing a word that never got a map.
 *
 * The review screen only exists once a map does, so without this a mistyped
 * import would sit in the library forever. Same confirmation and same warning
 * as the one there: this takes every student's history for the word with it.
 */
export function DeleteWord({ vocabularyId, lemma }: { vocabularyId: string; lemma: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-6 text-xs font-semibold text-muted hover:text-bad"
      >
        이 단어 삭제
      </button>
    )
  }

  return (
    <div className="mt-6 rounded-xl border border-bad/30 px-4 py-3 text-left">
      <p className="text-sm font-semibold text-bad">{lemma}를 단어장에서 지울까요?</p>
      <p className="mt-1 text-xs text-muted break-keep">
        모든 학생의 암기 카드와 정답·오답 기록까지 함께 사라지고, 되돌릴 수 없어요.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          disabled={pending}
          className="px-3 py-1.5 text-xs"
          onClick={() =>
            startTransition(async () => {
              setError(null)
              const result = await removeWord({ vocabularyId })
              if (!result.ok) {
                setError(result.message)
                return
              }
              router.push('/study')
              router.refresh()
            })
          }
        >
          {pending ? '삭제 중…' : '영구 삭제'}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="px-3 py-1.5 text-xs"
        >
          취소
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-bad break-keep">{error}</p> : null}
    </div>
  )
}
