'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { generateBrainMap } from './actions'

/**
 * Reports what actually happened rather than just refreshing.
 *
 * A silent refresh is indistinguishable from a no-op when the outcome was not
 * "a map now exists" — which is how a request that could not claim the word
 * looked like the button doing nothing at all.
 */
export function GenerateButton({ vocabularyId }: { vocabularyId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  return (
    <div className="mt-4">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null)
            const result = await generateBrainMap(vocabularyId)

            if (!result.ok) {
              setMessage({ tone: 'bad', text: result.error })
              return
            }

            setMessage({
              tone: 'good',
              text:
                result.outcome === 'generated'
                  ? '초안을 만들었어요. 검수 후 승인하면 학생에게 공개됩니다.'
                  : '이미 만들어진 Brain Map이 있어 그대로 사용합니다.',
            })
            router.refresh()
          })
        }
      >
        {pending ? 'AI 초안 생성 중…' : 'AI 초안 생성'}
      </Button>

      {message ? (
        <p
          role="status"
          className={`mt-2 text-sm break-keep ${message.tone === 'good' ? 'text-good' : 'text-bad'}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  )
}
