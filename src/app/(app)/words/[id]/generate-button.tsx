'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { generateBrainMap } from './actions'

export function GenerateButton({ vocabularyId }: { vocabularyId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-4">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const result = await generateBrainMap(vocabularyId)
            if (result.ok) router.refresh()
            else setError(result.error)
          })
        }
      >
        {pending ? 'AI 초안 생성 중…' : 'AI 초안 생성'}
      </Button>
      {error ? <p className="mt-2 text-sm text-bad">{error}</p> : null}
    </div>
  )
}
