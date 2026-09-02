'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Textarea } from '@/components/ui'
import {
  ITEM_FIELDS,
  ITEM_LABEL,
  ITEM_MAX,
  ITEM_ON_MAP,
  type ItemField,
  type ItemKind,
} from '@/lib/ai'
import { cn } from '@/lib/utils'
import { deleteItem, saveItem } from './edit-actions'

export type EditableItem = {
  id: string
  /** Current values, keyed by field name. Rendered into the form as-is. */
  values: Record<string, string>
  /** How the item reads when it is not being edited. */
  summary: ReactNode
  /** Nested editor, e.g. the questions under a confusable pair. */
  children?: ReactNode
}

/**
 * One section of the draft, editable a row at a time.
 *
 * A generated draft is usually right about four sentences and wrong about the
 * fifth. Before this, the only tools were "approve it all" and "regenerate it
 * all" — one ships the bad row, the other pays for a new call and may bring
 * back a different bad row. So each item gets its own edit and its own delete,
 * and everything else on the page stays exactly as the teacher left it.
 */
export function ItemSection({
  brainMapId,
  vocabularyId,
  kind,
  parentId,
  title,
  items,
  addLabel,
  note,
  dense,
}: {
  brainMapId: string
  vocabularyId: string
  kind: ItemKind
  parentId?: string
  title: string
  items: EditableItem[]
  addLabel?: string
  note?: string
  dense?: boolean
}) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [failure, setFailure] = useState<string | null>(null)

  const full = items.length >= ITEM_MAX[kind]
  // How many of these actually reach the map. A curator adding a fourth
  // collocation should know it will sit in the list below the map, not on it.
  const onMap = ITEM_ON_MAP[kind]
  const overflowing = onMap !== undefined && items.length > onMap

  const remove = (itemId: string) =>
    startTransition(async () => {
      setFailure(null)
      const result = await deleteItem({ brainMapId, vocabularyId, kind, itemId })
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      setConfirming(null)
      router.refresh()
    })

  return (
    // Sections are separated by space and a heading, not by a box. Each one
    // used to be a card holding a stack of bordered rows — a card inside a
    // card — which put two outlines around every sentence a curator reads.
    <section className={dense ? 'mt-3' : ''}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        {/* A section heading is a label, not an accent. These were brand
            coloured and bold, which made the form's scaffolding louder than
            the content a curator came here to read. */}
        <h2 className={cn('font-medium', dense ? 'text-xs text-ink-3' : 'text-[0.8125rem] text-ink-2')}>
          {title}
          <span className="numeral ml-1.5 text-xs text-ink-3">
            {items.length}/{ITEM_MAX[kind]}
          </span>
        </h2>
        {!adding ? (
          <button
            type="button"
            disabled={full}
            onClick={() => {
              setAdding(true)
              setEditingId(null)
            }}
            className="shrink-0 text-xs text-brand transition disabled:text-ink-3"
          >
            {full ? '가득 참' : (addLabel ?? `+ ${ITEM_LABEL[kind]} 추가`)}
          </button>
        ) : null}
      </div>

      {note ? <p className="mb-3 text-xs text-ink-3 break-keep">{note}</p> : null}

      {overflowing ? (
        <p className="mb-3 rounded-chip bg-warn-soft px-2.5 py-1.5 text-xs text-warn break-keep">
          맵에는 중요도가 높은 {onMap}개까지만 올라가요. 나머지는 맵 아래 목록에서 볼 수 있어요.
        </p>
      ) : null}

      <ul className="divide-y divide-line-soft border-t border-line">
        {items.map((item) => (
          <li key={item.id} className="py-2.5">
            {editingId === item.id ? (
              <ItemForm
                kind={kind}
                initial={item.values}
                onCancel={() => setEditingId(null)}
                onSubmit={(values) =>
                  saveItem({ brainMapId, vocabularyId, kind, itemId: item.id, values })
                }
                onSaved={() => {
                  setEditingId(null)
                  router.refresh()
                }}
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 text-sm">{item.summary}</div>
                  <div className="flex shrink-0 items-center gap-1">
                    <RowButton
                      onClick={() => {
                        setEditingId(item.id)
                        setAdding(false)
                        setConfirming(null)
                      }}
                    >
                      수정
                    </RowButton>
                    {confirming === item.id ? (
                      <>
                        <RowButton tone="danger" disabled={pending} onClick={() => remove(item.id)}>
                          {pending ? '삭제 중' : '삭제 확인'}
                        </RowButton>
                        <RowButton onClick={() => setConfirming(null)}>취소</RowButton>
                      </>
                    ) : (
                      <RowButton tone="danger" onClick={() => setConfirming(item.id)}>
                        삭제
                      </RowButton>
                    )}
                  </div>
                </div>
                {item.children ? <div className="mt-2 pl-3">{item.children}</div> : null}
              </>
            )}
          </li>
        ))}

        {adding ? (
          <li className="border-l-2 border-brand py-2.5 pl-3">
            <ItemForm
              kind={kind}
              initial={{}}
              onCancel={() => setAdding(false)}
              onSubmit={(values) => saveItem({ brainMapId, vocabularyId, kind, parentId, values })}
              onSaved={() => {
                setAdding(false)
                router.refresh()
              }}
            />
          </li>
        ) : null}

        {!items.length && !adding ? (
          <li className="py-3 text-xs text-ink-3">아직 없어요.</li>
        ) : null}
      </ul>

      {failure ? <p className="mt-2 text-sm text-bad break-keep">{failure}</p> : null}
    </section>
  )
}

function RowButton({
  children,
  tone,
  ...props
}: React.ComponentProps<'button'> & { tone?: 'danger' }) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-chip px-1.5 py-0.5 text-xs transition disabled:opacity-50',
        tone === 'danger'
          ? 'text-ink-3 hover:bg-bad-soft hover:text-bad'
          : 'text-ink-3 hover:bg-sunken hover:text-ink',
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * The form for one item, built from the field specs rather than hand-written
 * per section — so a field cannot appear on screen without a rule validating it
 * on the server.
 */
function ItemForm({
  kind,
  initial,
  onSubmit,
  onSaved,
  onCancel,
}: {
  kind: ItemKind
  initial: Record<string, string>
  onSubmit: (values: Record<string, string>) => Promise<
    { ok: true } | { ok: false; message: string; errors?: Record<string, string> }
  >
  onSaved: () => void
  onCancel: () => void
}) {
  const creating = !Object.keys(initial).length
  const fields = ITEM_FIELDS[kind].filter((f) => creating || !f.createOnly)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(ITEM_FIELDS[kind].map((f) => [f.name, initial[f.name] ?? defaultFor(f)])),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = () =>
    startTransition(async () => {
      setErrors({})
      setMessage(null)
      const result = await onSubmit(values)
      if (!result.ok) {
        setErrors(result.errors ?? {})
        setMessage(result.errors ? null : result.message)
        return
      }
      onSaved()
    })

  return (
    <div className="flex flex-col gap-2.5">
      {!creating && ITEM_FIELDS[kind].some((f) => f.createOnly) ? (
        <p className="text-xs font-semibold">
          {initial[ITEM_FIELDS[kind].find((f) => f.createOnly)!.name]}
        </p>
      ) : null}

      {fields.map((field) => (
        <label key={field.name} className="block">
          <span className="mb-1 block text-xs text-ink-3">
            {field.label}
            {field.required ? <span className="ml-0.5 text-bad">*</span> : null}
          </span>

          {field.input === 'select' ? (
            <select
              value={values[field.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm"
            >
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.input === 'textarea' ? (
            <Textarea
              rows={2}
              value={values[field.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              className="text-sm"
            />
          ) : (
            <Input
              type={field.input === 'number' ? 'number' : 'text'}
              min={field.min}
              max={field.max}
              value={values[field.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              className="px-3 py-2 text-sm"
            />
          )}

          {errors[field.name] ? (
            <span className="mt-1 block text-xs font-medium text-bad break-keep">
              {errors[field.name]}
            </span>
          ) : field.hint ? (
            <span className="mt-1 block text-xs text-ink-3 break-keep">{field.hint}</span>
          ) : null}
        </label>
      ))}

      {message ? <p className="text-sm text-bad break-keep">{message}</p> : null}

      <div className="flex gap-2">
        <Button disabled={pending} onClick={submit} className="px-3 py-1.5 text-xs">
          {pending ? '저장 중…' : '저장'}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel} className="px-3 py-1.5 text-xs">
          취소
        </Button>
      </div>
    </div>
  )
}

function defaultFor(field: ItemField): string {
  if (field.input === 'select') return field.options?.[0]?.value ?? ''
  return ''
}
