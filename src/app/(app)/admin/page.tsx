import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { listReviewQueue } from '@/lib/data/brain-map'
import { Badge, EmptyState, PageHeader } from '@/components/ui'

export default async function AdminPage() {
  const actor = await requireActor()
  if (actor.role === 'student') redirect('/study')

  const queue = await listReviewQueue()

  return (
    <div className="animate-rise">
      <PageHeader
        title="검수"
        subtitle="AI가 만든 초안을 확인하고 승인하면 학생에게 공개됩니다."
      />

      {queue.length === 0 ? (
        <EmptyState
          title="검수할 초안이 없어요"
          hint="단어 상세 페이지에서 AI 초안을 생성하면 여기에 쌓입니다."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {queue.map((item) => (
            <li key={item.brainMapId}>
              <Link
                href={`/admin/${item.brainMapId}`}
                className="card flex items-center justify-between gap-4 px-5 py-4 transition hover:border-brand"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{item.lemma}</p>
                  <p className="truncate text-xs text-muted">
                    v{item.version} · {item.model ?? '수기 작성'}
                  </p>
                </div>
                <Badge tone={item.status === 'draft_ai' ? 'warn' : 'brand'}>
                  {item.status === 'draft_ai' ? 'AI 초안' : '재검토'}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
