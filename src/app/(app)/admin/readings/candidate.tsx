'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Textarea } from '@/components/ui'
import { discardReading, publishReading } from '../actions'

export type Candidate = {
  id: string
  lemma: string
  gloss: string
  definition: string | null
  draft: string | null
  model: string | null
  promptVersion: string | null
  /**
   * Already formatted. A `Date` turned into text inside a client component is
   * rendered once on the server and again in the browser, in two different time
   * zones, and React rejects the page for it — so the server does it and hands
   * over the string.
   */
  generatedAt: string | null
}

/**
 * One proposal, editable in place.
 *
 * The box holds the model's text and what gets published is whatever is in the
 * box, so correcting a reading and approving it are one action. There is no way
 * to approve something other than what the reviewer is looking at.
 */
export function ReadingCandidate({ candidate }: { candidate: Candidate }) {
  const router = useRouter()
  const [text, setText] = useState(candidate.draft ?? '')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      const result = await fn()
      setError(result.ok ? null : result.error)
      if (result.ok) router.refresh()
    })

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[1.0625rem] font-semibold">{candidate.lemma}</span>
        <span className="text-xs text-ink-3 break-keep">{candidate.gloss}</span>
      </div>

      {candidate.definition ? (
        <p className="mt-2 rounded-control bg-sunken px-3 py-2 text-[0.8125rem] leading-relaxed">
          {candidate.definition}
        </p>
      ) : null}

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="mt-3"
        placeholder="이 영영 풀이의 한국어 해석"
      />

      {/* Where the text came from. A reader of this row a year from now needs to
          be able to tell a model's wording from a person's. */}
      <p className="mt-2 text-xs text-ink-3 break-keep">
        {candidate.model ?? '모델 미상'}
        {candidate.promptVersion ? ` · ${candidate.promptVersion}` : ''}
        {candidate.generatedAt ? ` · ${candidate.generatedAt}` : ''}
      </p>

      {error ? <p className="mt-2 text-xs text-bad break-keep">{error}</p> : null}

      <div className="mt-3 flex gap-2">
        <Button
          className="flex-1"
          disabled={pending || !text.trim()}
          onClick={() => act(() => publishReading(candidate.id, text))}
        >
          {pending ? '처리 중…' : '승인해서 공개'}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          disabled={pending}
          onClick={() => act(() => discardReading(candidate.id))}
        >
          버리기
        </Button>
      </div>
    </Card>
  )
}
