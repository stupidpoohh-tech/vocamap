'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card } from '@/components/ui'
import { acceptLink, declineLink } from '@/app/(app)/study/link-actions'

export type LinkRequest = {
  id: string
  teacherName: string
  teacherEmail: string
}

/**
 * Where a student answers a teacher's request to follow their work.
 *
 * This screen is the whole point of the change behind it: a teacher used to
 * become linked by typing an address, and the student was never told, let alone
 * asked. What a teacher gets from the link is the record of every word this
 * person has got wrong — so the decision belongs here, in front of the person
 * whose record it is, and it has to be a real choice with a decline beside it.
 */
export function LinkRequests({ requests }: { requests: LinkRequest[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState<Record<string, string>>({})

  const open = requests.filter((request) => !done[request.id])
  if (!open.length) return null

  const decide = (id: string, accept: boolean) =>
    startTransition(async () => {
      const result = accept ? await acceptLink(id) : await declineLink(id)
      setDone((prev) => ({ ...prev, [id]: result.error ?? result.message ?? '' }))
      router.refresh()
    })

  return (
    <Card className="mb-5">
      <h2 className="text-sm font-semibold">선생님 연결 요청</h2>
      <p className="mt-1 text-xs text-ink-3 break-keep">
        수락하면 이 선생님이 내 학습 기록과 틀린 단어를 볼 수 있어요.
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {open.map((request) => (
          <li key={request.id} className="flex flex-col gap-2">
            <div>
              <p className="text-[0.9375rem] font-medium break-keep">{request.teacherName}</p>
              <p className="text-xs text-ink-3">{request.teacherEmail}</p>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={pending}
                onClick={() => decide(request.id, true)}
              >
                수락
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                disabled={pending}
                onClick={() => decide(request.id, false)}
              >
                거절
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
