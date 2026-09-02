import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { requireActor } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { vocabularySets } from '@/lib/db/schema'
import { getTodaySummary } from '@/lib/data/study'
import { listStudyWords, WORD_LIST_LIMIT } from '@/lib/data/library'
import { Button, Input, PageHeader, TabBar, TabLink } from '@/components/ui'
import { WordList, type ListDirection } from '@/components/words/word-list'

/**
 * SCREEN 1 — the study book.
 *
 * Every word a teacher has uploaded, as a plain 단어장 you can cover and
 * uncover in either direction, with one button that turns whatever you are
 * looking at into a test. Deliberately not gated on saving or being assigned:
 * a student should be able to open the app and study the words that exist.
 */
export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; set?: string; dir?: string }>
}) {
  const { q, set, dir } = await searchParams
  const actor = await requireActor()
  const query = q?.trim() ?? ''
  const direction: ListDirection = dir === 'ko_en' ? 'ko_en' : 'en_ko'

  const [summary, words, setName] = await Promise.all([
    getTodaySummary(actor.id),
    listStudyWords({ userId: actor.id, scope: 'all', setId: set, query }),
    set ? lookupSetName(set) : Promise.resolve(null),
  ])

  const dueTotal = summary.dueCount + summary.newCount
  const testHref = buildHref('/study/session', { scope: 'all', dir: direction, set })

  return (
    <div className="animate-rise">
      <PageHeader
        title="단어"
        subtitle={
          query
            ? `"${query}" 검색 결과`
            : setName
              ? `세트 · ${setName}`
              : '가려진 쪽을 눌러서 확인하고, ☆ 을 눌러 보관함에 담아요'
        }
      />

      {/* Spaced repetition still leads: what is due today is the one thing the
          student should do before browsing. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <p className="text-sm">
          <span className="text-muted">오늘 복습 </span>
          <span className="font-bold tabular-nums text-brand">{summary.dueCount}</span>
          <span className="text-muted"> · 새 단어 </span>
          <span className="font-bold tabular-nums">{summary.newCount}</span>
        </p>
        {dueTotal > 0 ? (
          <Link href={`/study/session?scope=due&dir=${direction}`}>
            <Button>복습 시험 · {dueTotal}문제</Button>
          </Link>
        ) : (
          <span className="text-xs text-muted break-keep">
            오늘 복습할 단어가 없어요. 아래에서 골라 시험 볼 수 있어요.
          </span>
        )}
      </div>

      <form action="/study" className="mb-4">
        {set ? <input type="hidden" name="set" value={set} /> : null}
        <input type="hidden" name="dir" value={direction} />
        <Input
          name="q"
          defaultValue={query}
          placeholder="영어 단어 또는 한국어 뜻으로 검색"
          aria-label="단어 검색"
        />
      </form>

      <TabBar>
        <TabLink href={buildHref('/study', { q: query, set, dir: 'en_ko' })} active={direction === 'en_ko'}>
          영어 → 한국어
        </TabLink>
        <TabLink href={buildHref('/study', { q: query, set, dir: 'ko_en' })} active={direction === 'ko_en'}>
          한국어 → 영어
        </TabLink>
      </TabBar>

      {words.length > 0 ? (
        <Link href={testHref} className="mb-4 block">
          <Button variant="secondary" className="w-full">
            이 목록으로 시험 보기
          </Button>
        </Link>
      ) : null}

      <WordList
        items={words}
        direction={direction}
        emptyHint={
          query
            ? '다른 표현으로 찾아보세요.'
            : actor.role === 'student'
              ? '선생님이 단어를 올리면 여기에 나타나요.'
              : '교사 탭의 "단어 가져오기"로 단어를 등록하면 여기에 나타나요.'
        }
      />

      {words.length >= WORD_LIST_LIMIT ? (
        <p className="mt-4 text-center text-xs text-muted">
          가나다순 상위 {WORD_LIST_LIMIT}개예요. 검색으로 좁혀보세요.
        </p>
      ) : null}

      {set ? (
        <Link href="/study" className="mt-5 inline-block text-sm text-muted hover:text-ink">
          ← 전체 단어 보기
        </Link>
      ) : null}
    </div>
  )
}

function buildHref(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const rest = search.toString()
  return rest ? `${path}?${rest}` : path
}

async function lookupSetName(setId: string): Promise<string | null> {
  const [row] = await db
    .select({ title: vocabularySets.title })
    .from(vocabularySets)
    .where(eq(vocabularySets.id, setId))
    .limit(1)
  return row?.title ?? null
}
