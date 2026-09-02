import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { listStudyWords } from '@/lib/data/library'
import { Button, PageHeader, TabBar, TabLink } from '@/components/ui'
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
  searchParams: Promise<{ tab?: string; dir?: string }>
}) {
  const { tab, dir } = await searchParams
  const actor = await requireActor()
  const scope = tab === 'wrong' ? 'wrong' : 'saved'
  const direction: ListDirection = dir === 'ko_en' ? 'ko_en' : 'en_ko'

  const [saved, wrong] = await Promise.all([
    listStudyWords({ userId: actor.id, scope: 'saved' }),
    listStudyWords({ userId: actor.id, scope: 'wrong' }),
  ])
  const words = scope === 'wrong' ? wrong : saved

  return (
    <div className="animate-rise">
      <PageHeader
        title="보관함"
        subtitle={
          scope === 'wrong' ? '틀린 적 있는 단어예요' : '★ 로 저장해 둔 단어예요'
        }
      />

      <TabBar>
        <TabLink href={href({ dir })} active={scope === 'saved'} count={saved.length}>
          저장한 단어
        </TabLink>
        <TabLink href={href({ tab: 'wrong', dir })} active={scope === 'wrong'} count={wrong.length}>
          틀린 단어
        </TabLink>
      </TabBar>

      <TabBar className="mb-4">
        <TabLink href={href({ tab, dir: 'en_ko' })} active={direction === 'en_ko'}>
          영어 → 한국어
        </TabLink>
        <TabLink href={href({ tab, dir: 'ko_en' })} active={direction === 'ko_en'}>
          한국어 → 영어
        </TabLink>
      </TabBar>

      {words.length > 0 ? (
        <Link href={`/study/session?scope=${scope}&dir=${direction}`} className="mb-4 block">
          <Button variant="secondary" className="w-full">
            {scope === 'wrong' ? '틀린 단어로 시험 보기' : '저장한 단어로 시험 보기'}
          </Button>
        </Link>
      ) : null}

      <WordList
        items={words}
        direction={direction}
        emptyHint={
          scope === 'wrong'
            ? '아직 틀린 단어가 없어요. 시험을 보면 틀린 단어가 여기에 모여요.'
            : '단어 탭에서 ☆ 을 누르면 여기에 저장돼요.'
        }
      />
    </div>
  )
}

function href(params: { tab?: string; dir?: string }): string {
  const search = new URLSearchParams()
  if (params.tab) search.set('tab', params.tab)
  if (params.dir) search.set('dir', params.dir)
  const rest = search.toString()
  return rest ? `/vault?${rest}` : '/vault'
}
