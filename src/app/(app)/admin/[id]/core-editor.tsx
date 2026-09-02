'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Textarea } from '@/components/ui'
import { saveCore } from './edit-actions'

/**
 * The meaning core is the one field every other item hangs off, so it is edited
 * on its own rather than as a row in a list.
 */
export function CoreEditor({
  brainMapId,
  vocabularyId,
  ko,
  en,
}: {
  brainMapId: string
  vocabularyId: string
  ko: string | null
  en: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draftKo, setDraftKo] = useState(ko ?? '')
  const [draftEn, setDraftEn] = useState(en ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = () =>
    startTransition(async () => {
      setErrors({})
      setMessage(null)
      const result = await saveCore({ brainMapId, vocabularyId, ko: draftKo, en: draftEn })
      if (!result.ok) {
        setErrors(result.errors ?? {})
        setMessage(result.errors ? null : result.message)
        return
      }
      setEditing(false)
      router.refresh()
    })

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold tracking-wide text-brand">중심 개념</h2>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-brand"
          >
            수정
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2.5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              한국어<span className="ml-0.5 text-bad">*</span>
            </span>
            <Textarea
              rows={2}
              value={draftKo}
              onChange={(e) => setDraftKo(e.target.value)}
              className="text-sm"
            />
            {errors.ko ? (
              <span className="mt-1 block text-xs font-medium text-bad">{errors.ko}</span>
            ) : (
              <span className="mt-1 block text-xs text-muted break-keep">
                모든 용법을 관통하는 하나의 개념이에요. 사전 뜻을 나열하지 않아요.
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">영어 (선택)</span>
            <Input
              value={draftEn}
              onChange={(e) => setDraftEn(e.target.value)}
              className="px-3 py-2 text-sm"
            />
            {errors.en ? (
              <span className="mt-1 block text-xs font-medium text-bad">{errors.en}</span>
            ) : null}
          </label>
          {message ? <p className="text-sm text-bad break-keep">{message}</p> : null}
          <div className="flex gap-2">
            <Button disabled={pending} onClick={submit} className="px-3 py-1.5 text-xs">
              {pending ? '저장 중…' : '저장'}
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setDraftKo(ko ?? '')
                setDraftEn(en ?? '')
                setErrors({})
                setMessage(null)
                setEditing(false)
              }}
              className="px-3 py-1.5 text-xs"
            >
              취소
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="font-semibold break-keep">{ko ?? '—'}</p>
          {en ? <p className="mt-1 text-sm italic text-muted">{en}</p> : null}
        </>
      )}
    </section>
  )
}
