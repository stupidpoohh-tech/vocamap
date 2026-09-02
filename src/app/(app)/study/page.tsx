import Link from 'next/link'
import { Suspense } from 'react'
import { requireActor } from '@/lib/auth/session'
import { getTodaySummary } from '@/lib/data/study'
import {
  listStudyWords,
  listWordSets,
  wordSetName,
} from '@/lib/data/library'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Pager,
  PageHeader,
  TabBar,
  TabLink,
} from '@/components/ui'
import { WordList, type ListDirection } from '@/components/words/word-list'
import { SkeletonLine } from '@/components/ui/skeleton'

/**
 * SCREEN 1 — the study book, browsed set by set.
 *
 * A flat list of every word a tutor has ever uploaded is a dictionary, not a
 * study book: a student cannot tell which twenty words are this week's. So the
 * shelf comes first and a set opens into its own word list, which is where the
 * covering, the starring and the test all live.
 *
 * Search is the exception. Someone hunting one word does not know which set it
 * is in, so a query skips the shelf and answers across everything.
 */
export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; set?: string; dir?: string; page?: string }>
}) {
  const { q, set, dir, page } = await searchParams
  const actor = await requireActor()
  const query = q?.trim() ?? ''
  const direction: ListDirection = dir === 'ko_en' ? 'ko_en' : 'en_ko'

  // `set=none` is the bucket of words no set contains — without it they would
  // be unreachable the moment the book is browsed set by set.
  const unassigned = set === 'none'
  const setId = unassigned ? undefined : set
  const insideSet = Boolean(set)

  const setParam = unassigned ? 'none' : setId

  return (
    <div className="animate-rise">
      {/* Back before anything else: the shelf is where every other screen here
          came from, so the way out belongs at the top. */}
      {insideSet || query ? (
        <Link
          href={query && setParam ? `/study?set=${setParam}` : '/study'}
          className="mb-3 inline-block text-sm text-muted hover:text-ink"
        >
          ← {query && setParam ? '세트로 돌아가기' : '세트 목록'}
        </Link>
      ) : (
        <PageHeader title="단어" subtitle="세트를 열어 단어를 보고, 모르는 단어를 담아요" />
      )}

      {/* Streamed on its own so the list below does not wait on it. The counts
          and the words are independent questions, and making the shelf wait for
          the scheduler put a round trip in front of every visit. */}
      <Suspense fallback={<DueStripSkeleton />}>
        <DueStrip userId={actor.id} direction={direction} />
      </Suspense>

      <form action="/study" className="mb-5">
        {set ? <input type="hidden" name="set" value={set} /> : null}
        <input type="hidden" name="dir" value={direction} />
        <Input
          name="q"
          defaultValue={query}
          placeholder="영어 단어 또는 한국어 뜻으로 검색"
          aria-label="단어 검색"
        />
      </form>

      {query || insideSet ? (
        <WordsView
          userId={actor.id}
          role={actor.role}
          query={query}
          setId={setId}
          unassigned={unassigned}
          direction={direction}
          page={Math.max(0, Number(page ?? 0) || 0)}
        />
      ) : (
        <Shelf userId={actor.id} role={actor.role} />
      )}
    </div>
  )
}

/* ───────────────────────────── today's numbers ──────────────────────────── */

/**
 * Spaced repetition still leads: what is due today is the one thing the student
 * should do before browsing.
 */
async function DueStrip({ userId, direction }: { userId: string; direction: ListDirection }) {
  const summary = await getTodaySummary(userId)
  const total = summary.dueCount + summary.newCount

  return (
    <div className="mb-5 flex min-h-[3.5rem] flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-sm">
        <span className="text-muted">오늘 복습 </span>
        <span className="font-bold tabular-nums text-brand">{summary.dueCount}</span>
        <span className="text-muted"> · 새 단어 </span>
        <span className="font-bold tabular-nums">{summary.newCount}</span>
      </p>
      {total > 0 ? (
        <Link href={`/study/session?scope=due&dir=${direction}`}>
          <Button>복습 시험 · {total}문제</Button>
        </Link>
      ) : (
        <span className="text-xs text-muted break-keep">
          오늘 복습할 단어가 없어요. 세트를 열어 시험 볼 수 있어요.
        </span>
      )}
    </div>
  )
}

/** The same height as the real strip, so nothing below it moves when it lands. */
function DueStripSkeleton() {
  return (
    <div className="mb-5 flex min-h-[3.5rem] items-center rounded-xl border border-line bg-surface px-4 py-3">
      <SkeletonLine className="w-40" />
    </div>
  )
}

/* ─────────────────────────────── the shelf ─────────────────────────────── */

async function Shelf({ userId, role }: { userId: string; role: string }) {
  const sets = await listWordSets(userId)

  if (!sets.length) {
    return (
      <EmptyState
        title="아직 단어 세트가 없어요"
        hint={
          role === 'student'
            ? '선생님이 단어를 올리면 여기에 세트로 나타나요.'
            : '교사 탭의 "단어 가져오기"로 세트를 만들면 여기에 나타나요.'
        }
      />
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {sets.map((set) => (
        <li key={set.id ?? 'none'}>
          <Link
            href={`/study?set=${set.id ?? 'none'}`}
            className="card flex items-center justify-between gap-4 px-5 py-4 transition hover:border-brand"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold">
                <span className="truncate">{set.title}</span>
                {set.assigned ? <Badge tone="brand">배정됨</Badge> : null}
              </p>
              {set.description ? (
                <p className="mt-0.5 truncate text-sm text-muted">{set.description}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted tabular-nums">
                단어 {set.wordCount}개
                {set.savedCount > 0 ? ` · 담은 단어 ${set.savedCount}개` : ''}
                {set.mappedCount > 0 ? ` · 맵 ${set.mappedCount}개` : ''}
              </p>
            </div>
            <span aria-hidden className="shrink-0 text-muted">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/* ───────────────────────── one set, or a search ───────────────────────── */

async function WordsView({
  userId,
  role,
  query,
  setId,
  unassigned,
  direction,
  page,
}: {
  userId: string
  role: string
  query: string
  setId?: string
  unassigned: boolean
  direction: ListDirection
  page: number
}) {
  const [words, title] = await Promise.all([
    listStudyWords({ userId, scope: 'all', setId, unassigned, query, page }),
    setId ? wordSetName(setId) : Promise.resolve(unassigned ? '세트에 없는 단어' : null),
  ])

  const setParam = setId ?? (unassigned ? 'none' : undefined)
  const testHref = buildHref('/study/session', {
    scope: 'all',
    dir: direction,
    set: setId,
    unassigned: unassigned ? '1' : undefined,
  })

  return (
    <>
      <PageHeader
        title={query ? `"${query}" 검색 결과` : (title ?? '단어')}
        subtitle="모르는 단어는 ☆ 을 눌러 보관함에 담아요"
      />

      <TabBar>
        <TabLink
          href={buildHref('/study', { q: query, set: setParam, dir: 'en_ko' })}
          active={direction === 'en_ko'}
        >
          영어 → 한국어
        </TabLink>
        <TabLink
          href={buildHref('/study', { q: query, set: setParam, dir: 'ko_en' })}
          active={direction === 'ko_en'}
        >
          한국어 → 영어
        </TabLink>
      </TabBar>

      {words.total > 0 && !query ? (
        <Link href={testHref} className="mb-4 block">
          <Button variant="secondary" className="w-full">
            이 세트로 시험 보기 · 단어 {words.total}개
          </Button>
        </Link>
      ) : null}

      <WordList
        items={words.words}
        direction={direction}
        emptyHint={
          query
            ? '다른 표현으로 찾아보세요.'
            : role === 'student'
              ? '이 세트에는 아직 단어가 없어요.'
              : '교사 탭에서 이 세트에 단어를 담아 주세요.'
        }
      />

      <Pager
        page={words.page}
        pageCount={words.pageCount}
        total={words.total}
        href={(next) =>
          buildHref('/study', {
            q: query,
            set: setParam,
            dir: direction,
            page: next ? String(next) : undefined,
          })
        }
      />
    </>
  )
}

function buildHref(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const rest = search.toString()
  return rest ? `${path}?${rest}` : path
}
