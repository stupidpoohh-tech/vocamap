import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { listStudyWords, vaultCounts } from '@/lib/data/library'
import { Button, Pager, PageHeader, TabBar, TabLink } from '@/components/ui'
import { WordList, type ListDirection } from '@/components/words/word-list'

/**
 * SCREEN 2 — the vault.
 *
 * Two lists a student comes back to: the words they chose to keep, and the
 * words that have beaten them. Both are the same rows as the study book, so a
 * word saved here is the same word there, with the same star.
 *
 * "Wrong" is read from the answer log rather than from the FSRS card. A card's
 * lapse count says the scheduler demoted it; it does not say "you got this one
 * wrong", which is the only thing this screen is for.
 */
export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; dir?: string; page?: string }>
}) {
  const { tab, dir, page } = await searchParams
  const actor = await requireActor()
  const scope = tab === 'wrong' ? 'wrong' : 'saved'
  const direction: ListDirection = dir === 'ko_en' ? 'ko_en' : 'en_ko'
  const pageIndex = Math.max(0, Number(page ?? 0) || 0)

  // Only the tab on screen is fetched; the other tab needs a number, not a list.
  const [words, counts] = await Promise.all([
    listStudyWords({ userId: actor.id, scope, page: pageIndex }),
    vaultCounts(actor.id),
  ])

  return (
    <div className="animate-rise">
      <PageHeader
        title="보관함"
        subtitle={scope === 'wrong' ? '틀린 적 있는 단어예요' : '단어 탭에서 담아 둔 단어예요'}
        // Drilling the vault is the reason to keep one, so it is this screen's
        // single action and it sits with the title.
        action={
          words.total > 0 ? (
            <Link href={`/study/session?scope=${scope}&dir=${direction}`}>
              <Button>시험 보기</Button>
            </Link>
          ) : null
        }
      />

      <TabBar>
        <TabLink href={href({ dir })} active={scope === 'saved'} count={counts.saved}>
          담은 단어
        </TabLink>
        <TabLink href={href({ tab: 'wrong', dir })} active={scope === 'wrong'} count={counts.wrong}>
          틀린 단어
        </TabLink>
      </TabBar>

      {/* Which way round the list is covered is a display option, not a
          destination, so it reads as two words rather than a second tab bar. */}
      <div className="mb-1 flex justify-end gap-3 text-xs">
        <DirectionLink href={href({ tab, dir: 'en_ko' })} active={direction === 'en_ko'}>
          영 → 한
        </DirectionLink>
        <DirectionLink href={href({ tab, dir: 'ko_en' })} active={direction === 'ko_en'}>
          한 → 영
        </DirectionLink>
      </div>

      <WordList
        items={words.words}
        direction={direction}
        emptyHint={
          scope === 'wrong'
            ? '아직 틀린 단어가 없어요. 시험을 보면 틀린 단어가 여기에 모여요.'
            : '단어 탭에서 세트를 열고, 모르는 단어의 ☆ 을 누르면 여기에 담겨요.'
        }
      />

      <Pager
        page={words.page}
        pageCount={words.pageCount}
        total={words.total}
        href={(next) => href({ tab, dir, page: next ? String(next) : undefined })}
      />
    </div>
  )
}

function DirectionLink({
  href: to,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={to}
      aria-current={active ? 'true' : undefined}
      className={active ? 'text-ink' : 'text-ink-3 transition hover:text-ink-2'}
    >
      {children}
    </Link>
  )
}

function href(params: { tab?: string; dir?: string; page?: string }): string {
  const search = new URLSearchParams()
  if (params.tab) search.set('tab', params.tab)
  if (params.dir) search.set('dir', params.dir)
  if (params.page) search.set('page', params.page)
  const rest = search.toString()
  return rest ? `/vault?${rest}` : '/vault'
}
