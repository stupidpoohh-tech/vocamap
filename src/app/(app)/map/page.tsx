import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { listStudyWords } from '@/lib/data/library'
import { listRecommendedWords } from '@/lib/data/personal'
import { Badge, EmptyState, Input, PageHeader, TabBar, TabLink } from '@/components/ui'
import { BookmarkButton } from '@/components/words/bookmark-button'

/**
 * SCREEN 3 — the maps.
 *
 * Only words that actually have a Brain Map. The study book holds every word;
 * this holds the few that earned an expansion, which is the whole premise —
 * drill most words, expand the ones that fight back. Mixing the two lists is
 * what made the map feel like a menu of everything.
 *
 * Curators get two extra lists so the generation queue stays reachable: this is
 * the only screen that knows which words still lack a map.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>
}) {
  const { tab, q } = await searchParams
  const actor = await requireActor()
  const isCurator = actor.role === 'teacher' || actor.role === 'admin'
  const query = q?.trim() ?? ''
  const view = resolveView(tab, isCurator)

  const [published, saved, recommended, pending, missing] = await Promise.all([
    listStudyWords({ userId: actor.id, scope: 'mapped', query }),
    listStudyWords({ userId: actor.id, scope: 'mapped', savedOnly: true, query }),
    listRecommendedWords(actor.id, 5),
    isCurator
      ? listStudyWords({ userId: actor.id, scope: 'mapPending', query })
      : Promise.resolve([]),
    isCurator
      ? listStudyWords({ userId: actor.id, scope: 'mapMissing', query })
      : Promise.resolve([]),
  ])

  const lists = { published, saved, pending, missing }
  const words = lists[view]

  return (
    <div className="animate-rise">
      <PageHeader title="맵" subtitle="Brain Map이 있는 단어만 모여 있어요" />

      {recommended.length > 0 && view === 'published' ? (
        <section className="mb-5 rounded-xl border border-warn/30 bg-warn-soft/50 px-4 py-3">
          <p className="text-xs font-semibold text-warn">깊이 볼 만한 단어</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {recommended.map((word) => (
              <li key={word.vocabularyId}>
                <Link
                  href={`/words/${word.vocabularyId}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-surface px-3 py-1.5 text-sm font-semibold hover:border-warn"
                >
                  {word.lemma}
                  <span aria-hidden className="text-warn">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form action="/map" className="mb-4">
        {tab ? <input type="hidden" name="tab" value={tab} /> : null}
        <Input
          name="q"
          defaultValue={query}
          placeholder="단어 검색"
          aria-label="맵 검색"
        />
      </form>

      <TabBar>
        <TabLink href={href({ q: query })} active={view === 'published'} count={published.length}>
          전체 맵
        </TabLink>
        <TabLink href={href({ tab: 'saved', q: query })} active={view === 'saved'} count={saved.length}>
          저장한 맵
        </TabLink>
        {isCurator ? (
          <>
            <TabLink
              href={href({ tab: 'pending', q: query })}
              active={view === 'pending'}
              count={pending.length}
            >
              검수 대기
            </TabLink>
            <TabLink
              href={href({ tab: 'missing', q: query })}
              active={view === 'missing'}
              count={missing.length}
            >
              맵 없음
            </TabLink>
          </>
        ) : null}
      </TabBar>

      {words.length === 0 ? (
        <EmptyState title={EMPTY[view].title} hint={EMPTY[view].hint} />
      ) : (
        <ul className="flex flex-col gap-2">
          {words.map((word) => (
            <li key={word.id} className="card flex items-center gap-3 px-4 py-3.5">
              <Link href={`/words/${word.id}`} className="min-w-0 flex-1">
                <p className="font-semibold">{word.lemma}</p>
                <p className="truncate text-sm text-muted">{word.translation ?? '—'}</p>
              </Link>
              {word.wrongCount > 0 ? (
                <span className="shrink-0 text-[11px] font-semibold tabular-nums text-bad">
                  ✕{word.wrongCount}
                </span>
              ) : null}
              {view === 'pending' ? (
                <Badge tone="warn" className="hidden shrink-0 sm:inline-flex">
                  검수 대기
                </Badge>
              ) : null}
              {view === 'missing' ? (
                <Badge tone="neutral" className="hidden shrink-0 sm:inline-flex">
                  맵 없음
                </Badge>
              ) : null}
              <BookmarkButton vocabularyId={word.id} bookmarked={word.bookmarked} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type MapView = 'published' | 'saved' | 'pending' | 'missing'

function resolveView(tab: string | undefined, isCurator: boolean): MapView {
  if (tab === 'saved') return 'saved'
  // A student cannot be shown drafts or the generation queue, whatever the URL
  // says — the tab is a view, not an authorisation.
  if (isCurator && (tab === 'pending' || tab === 'missing')) return tab
  return 'published'
}

const EMPTY: Record<MapView, { title: string; hint: string }> = {
  published: {
    title: '아직 공개된 맵이 없어요',
    hint: '자주 틀리는 단어가 생기면 선생님이 그 단어의 Brain Map을 만들어 줘요.',
  },
  saved: {
    title: '저장한 맵이 없어요',
    hint: '전체 맵에서 ☆ 을 누르면 여기에 모여요.',
  },
  pending: {
    title: '검수 대기 중인 맵이 없어요',
    hint: '초안을 만들면 여기에 쌓이고, 검수 탭에서 승인할 수 있어요.',
  },
  missing: {
    title: '모든 단어에 맵이 있어요',
    hint: '새 단어를 올리면 여기에 나타나요.',
  },
}

function href(params: { tab?: string; q?: string }): string {
  const search = new URLSearchParams()
  if (params.tab) search.set('tab', params.tab)
  if (params.q) search.set('q', params.q)
  const rest = search.toString()
  return rest ? `/map?${rest}` : '/map'
}
