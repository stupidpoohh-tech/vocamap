'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { removeBrainMap, removeWord } from './edit-actions'

/**
 * The two deletions, kept apart from the review buttons and from each other.
 *
 * Throwing away a map is routine — a draft came back wrong and the word starts
 * over. Throwing away the word takes every student's history with it and cannot
 * be undone, so it is behind its own confirmation and says exactly what it
 * costs. Neither is a click you should be able to make by accident.
 */
export function DangerZone({
  brainMapId,
  vocabularyId,
  lemma,
}: {
  brainMapId: string
  vocabularyId: string
  lemma: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<'map' | 'word' | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, to: string) =>
    startTransition(async () => {
      setError(null)
      const result = await fn()
      if (!result.ok) {
        setError(result.message ?? '삭제하지 못했어요.')
        return
      }
      router.push(to)
      router.refresh()
    })

  return (
    <section className="mt-12 border-t border-line pt-5">
      <h2 className="text-[0.8125rem] font-medium text-ink-2">삭제</h2>

      <div className="mt-3 flex flex-col gap-3">
        <Row
          title="맵만 삭제"
          detail={`${lemma}의 Brain Map을 지워요. 단어와 학생들의 학습 기록은 그대로 남고, 나중에 다시 만들 수 있어요.`}
          confirmLabel="맵 삭제"
          active={confirming === 'map'}
          pending={pending}
          onAsk={() => setConfirming('map')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => run(() => removeBrainMap({ brainMapId, vocabularyId }), '/map')}
        />

        <Row
          title="단어 자체를 삭제"
          detail={`${lemma}를 단어장에서 완전히 지워요. 맵은 물론 모든 학생의 암기 카드와 정답·오답 기록까지 함께 사라지고, 되돌릴 수 없어요.`}
          confirmLabel="단어까지 영구 삭제"
          active={confirming === 'word'}
          pending={pending}
          onAsk={() => setConfirming('word')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => run(() => removeWord({ vocabularyId }), '/study')}
        />
      </div>

      {error ? <p className="mt-3 text-sm text-bad break-keep">{error}</p> : null}
    </section>
  )
}

function Row({
  title,
  detail,
  confirmLabel,
  active,
  pending,
  onAsk,
  onCancel,
  onConfirm,
}: {
  title: string
  detail: string
  confirmLabel: string
  active: boolean
  pending: boolean
  onAsk: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-3 break-keep">{detail}</p>
      </div>
      {active ? (
        <div className="flex shrink-0 gap-2">
          <Button variant="danger" disabled={pending} onClick={onConfirm} className="px-3 py-1.5 text-xs">
            {pending ? '삭제 중…' : confirmLabel}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onCancel} className="px-3 py-1.5 text-xs">
            취소
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={onAsk} className="shrink-0 px-3 py-1.5 text-xs">
          삭제
        </Button>
      )}
    </div>
  )
}
