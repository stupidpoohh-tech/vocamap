import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { requireActor } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { vocabularySets } from '@/lib/db/schema'
import {
  brainMapStates,
  listLibraryWords,
  searchVocabulary,
  type BrainMapState,
  type LibraryWord,
} from '@/lib/data/vocabulary'
import { bookmarkedIds } from '@/lib/data/study'
import { Badge, EmptyState, Input, PageHeader } from '@/components/ui'
import { BookmarkButton } from './bookmark-button'

/**
 * The whole shared library, for everyone.
 *
 * Words used to be visible only once a teacher assigned them, which meant a
 * student could not go and find something to learn. Now the library is open and
 * the star is how you choose: bookmarking a word puts it into your own study
 * queue. Assignments still work, they are just no longer the only way in.
 */
export default async function WordsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; set?: string; only?: string }>
}) {
  const { q, set, only } = await searchParams
  const actor = await requireActor()
  const query = q?.trim() ?? ''
  const isCurator = actor.role === 'teacher' || actor.role === 'admin'
  const bookmarksOnly = only === 'bookmarked'

  const setName = set ? await lookupSetName(set) : null
  const words = await loadWords({ actor, query, setId: set, isCurator, bookmarksOnly })

  return (
    <div className="animate-rise">
      <PageHeader
        title="단어"
        subtitle={
          query
            ? `"${query}" 검색 결과`
            : setName
              ? `세트 · ${setName}`
              : bookmarksOnly
                ? '내 학습 목록'
                : '★ 을 누르면 오늘의 학습에 들어가요'
        }
      />

      <form action="/words" className="mb-4">
        {set ? <input type="hidden" name="set" value={set} /> : null}
        {bookmarksOnly ? <input type="hidden" name="only" value="bookmarked" /> : null}
        <Input
          name="q"
          defaultValue={query}
          placeholder="영어 단어 또는 한국어 뜻으로 검색"
          aria-label="단어 검색"
        />
      </form>

      <div className="mb-5 flex gap-1 rounded-xl bg-line/40 p-1">
        <FilterTab href={filterHref({ set, query })} active={!bookmarksOnly}>
          전체 단어
        </FilterTab>
        <FilterTab
          href={filterHref({ set, query, only: 'bookmarked' })}
          active={bookmarksOnly}
        >
          내 학습 목록
        </FilterTab>
      </div>

      {words.length === 0 ? (
        <EmptyState
          title={
            query ? '검색 결과가 없어요' : bookmarksOnly ? '학습 목록이 비어 있어요' : '아직 단어가 없어요'
          }
          hint={
            query
              ? '다른 표현으로 찾아보세요.'
              : bookmarksOnly
                ? '전체 단어에서 ★ 을 누르면 여기에 담기고, 오늘의 학습에 나와요.'
                : isCurator
                  ? '교사 탭의 "단어 가져오기"로 단어를 등록하면 여기에 나타나요.'
                  : '선생님이 단어를 등록하면 여기에 나타나요.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {words.map((word) => (
            <li key={word.id} className="card flex items-center gap-3 px-4 py-3.5">
              <Link href={`/words/${word.id}`} className="min-w-0 flex-1">
                <p className="font-semibold">{word.lemma}</p>
                <p className="truncate text-sm text-muted">{word.translation ?? '—'}</p>
              </Link>
              {isCurator ? <MapBadge state={word.brainMapStatus} /> : null}
              <BookmarkButton vocabularyId={word.id} bookmarked={word.bookmarked} />
            </li>
          ))}
        </ul>
      )}

      {set ? (
        <Link href="/words" className="mt-5 inline-block text-sm text-muted hover:text-ink">
          ← 전체 단어 보기
        </Link>
      ) : null}
    </div>
  )
}

function filterHref(input: { set?: string; query?: string; only?: string }): string {
  const params = new URLSearchParams()
  if (input.query) params.set('q', input.query)
  if (input.set) params.set('set', input.set)
  if (input.only) params.set('only', input.only)
  const rest = params.toString()
  return rest ? `/words?${rest}` : '/words'
}

function FilterTab({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`flex-1 rounded-lg py-2 text-center text-sm font-semibold transition ${
        active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
      }`}
    >
      {children}
    </Link>
  )
}

const BADGE: Record<BrainMapState, { label: string; tone: 'neutral' | 'warn' | 'good' }> = {
  none: { label: 'Map 없음', tone: 'neutral' },
  draft: { label: '검수 대기', tone: 'warn' },
  approved: { label: '공개됨', tone: 'good' },
}

function MapBadge({ state }: { state: BrainMapState }) {
  const { label, tone } = BADGE[state]
  return (
    <Badge tone={tone} className="hidden shrink-0 sm:inline-flex">
      {label}
    </Badge>
  )
}

async function loadWords(input: {
  actor: { id: string; role: string }
  query: string
  setId?: string
  isCurator: boolean
  bookmarksOnly: boolean
}): Promise<LibraryWord[]> {
  let words: LibraryWord[]

  if (input.query) {
    const found = await searchVocabulary(input.query, 40)
    const states = input.isCurator
      ? await brainMapStates(found.map((w) => w.id))
      : new Map<string, BrainMapState>()
    words = found.map((w) => ({
      ...w,
      brainMapStatus: states.get(w.id) ?? 'none',
      bookmarked: false,
    }))
  } else {
    words = await listLibraryWords({
      setId: input.setId,
      order: input.isCurator ? 'needsWork' : 'alphabetical',
    })
  }

  const marked = await bookmarkedIds(
    input.actor.id,
    words.map((w) => w.id),
  )
  const withBookmarks = words.map((w) => ({ ...w, bookmarked: marked.has(w.id) }))

  return input.bookmarksOnly ? withBookmarks.filter((w) => w.bookmarked) : withBookmarks
}

async function lookupSetName(setId: string): Promise<string | null> {
  const [row] = await db
    .select({ title: vocabularySets.title })
    .from(vocabularySets)
    .where(eq(vocabularySets.id, setId))
    .limit(1)
  return row?.title ?? null
}
