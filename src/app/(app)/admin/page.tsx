import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { listReviewQueue } from '@/lib/data/brain-map'
import { listStudyWords, mapCounts } from '@/lib/data/library'
import { Badge, EmptyState, Pager, PageHeader, TabBar, TabLink } from '@/components/ui'
import { DeleteWordButton } from '@/components/words/delete-word-button'

/**
 * The map pipeline, both halves of it.
 *
 * 검수 대기 is what has been written and needs a decision. 맵 없음 is what has
 * not been written yet — the queue a curator works from, which used to be a tab
 * on the 맵 screen. That screen was a student's view of the maps and is now a
 * filter inside the study book, so the two curator lists came here instead:
 * they are one job, and it is this one.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>
}) {
  const { tab, page } = await searchParams
  const actor = await requireActor()
  if (actor.role === 'student') redirect('/study')

  const missing = tab === 'missing'
  const pageIndex = Math.max(0, Number(page ?? 0) || 0)

  const [queue, counts, words] = await Promise.all([
    missing ? Promise.resolve([]) : listReviewQueue(),
    mapCounts(actor.id),
    missing
      ? listStudyWords({ userId: actor.id, scope: 'mapMissing', page: pageIndex })
      : Promise.resolve(null),
  ])

  return (
    <div className="animate-rise">
      <PageHeader
        title="검수"
        subtitle={
          missing
            ? '아직 맵이 없는 단어예요. 단어를 열어 초안을 만들 수 있어요.'
            : 'AI가 만든 초안을 확인하고 승인하면 학생에게 공개됩니다.'
        }
      />

      <TabBar>
        <TabLink href="/admin" active={!missing} count={counts.pending}>
          검수 대기
        </TabLink>
        <TabLink href="/admin?tab=missing" active={missing} count={counts.missing}>
          맵 없음
        </TabLink>
      </TabBar>

      {missing && words ? (
        <>
          {words.words.length === 0 ? (
            <EmptyState title="모든 단어에 맵이 있어요" hint="새 단어를 올리면 여기에 나타나요." />
          ) : (
            <ul className="divide-y divide-line-soft border-t border-line">
              {words.words.map((word) => (
                <li key={word.id} className="flex items-center gap-3 py-3">
                  <Link href={`/words/${word.id}`} className="group min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] text-ink group-hover:text-brand">
                      {word.lemma}
                    </span>
                    <span className="mt-0.5 block truncate text-[0.8125rem] text-ink-3">
                      {word.translation ?? '—'}
                    </span>
                  </Link>

                  {/* Only what is true of this row: how often it has beaten
                      students is what decides which word gets a map next. */}
                  {word.wrongCount > 0 ? (
                    <span className="numeral shrink-0 text-[0.6875rem] text-data-weak">
                      {word.wrongCount}회 틀림
                    </span>
                  ) : null}

                  {/* The one place a word with no map can be reached from, so
                      it is also the only place it can be thrown away. */}
                  <DeleteWordButton vocabularyId={word.id} lemma={word.lemma} hasMap={false} />
                </li>
              ))}
            </ul>
          )}

          <Pager
            page={words.page}
            pageCount={words.pageCount}
            total={words.total}
            href={(next) => (next ? `/admin?tab=missing&page=${next}` : '/admin?tab=missing')}
          />
        </>
      ) : queue.length === 0 ? (
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
                  <p className="truncate text-xs text-ink-3">
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
