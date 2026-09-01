'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@/components/ui'
import { regenerate, reviewBrainMap } from '../actions'

export function ReviewActions({
  brainMapId,
  vocabularyId,
  status,
}: {
  brainMapId: string
  vocabularyId: string
  status: string
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<void | { ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null)
      const result = await fn()
      if (result && !result.ok) {
        setError(result.error ?? '작업에 실패했습니다.')
        return
      }
      router.refresh()
    })

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="검수 메모 (선택)"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || status === 'approved'}
          onClick={() => run(() => reviewBrainMap(brainMapId, 'approved', note))}
        >
          승인
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => reviewBrainMap(brainMapId, 'needs_review', note))}
        >
          재검토 표시
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => regenerate(vocabularyId))}
        >
          다시 생성
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => run(() => reviewBrainMap(brainMapId, 'rejected', note))}
        >
          반려
        </Button>
      </div>
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </div>
  )
}
