import Link from 'next/link'
import { notFound } from 'next/navigation'
import { readerFromCookie } from '@/lib/auth/session'
import { getPersonalBrainMap, listTranslations } from '@/lib/data/personal'
import { wordNeighbours } from '@/lib/data/library'
import { buildSemanticMap } from '@/lib/data/semantic-map'
import { Tag } from '@/components/ui'
import { collectWordState } from '@/lib/data/study'
import { BookmarkButton } from '@/components/words/bookmark-button'
import { SpeakButton } from '@/components/words/speak-button'
import { BrainMapExplorer } from './brain-map-explorer'
import { GenerateButton } from './generate-button'
import { DeleteWord } from './delete-word'
import { WordPager } from './word-pager'

export default async function WordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  // Which list this page was opened from. It decides what "next" means and
  // where "← 단어" goes back to.
  searchParams: Promise<{ set?: string; view?: string; from?: string }>
}) {
  const { id } = await params
  const { set, view, from } = await searchParams

  const unassigned = set === 'none'
  const setId = unassigned ? undefined : set
  const mapsOnly = view === 'map'
  const listQuery = listSearch(set, view)

  /**
   * Whether this page was opened by walking a list.
   *
   * "다음" means the next word *in the list you came from*, and it only means
   * anything if you came from one. Opened from the review desk, from a test's
   * result screen, from a teacher's report — every one of those linked to the
   * word and nothing else — there is no list, and the pager was quietly
   * offering the whole library in alphabetical order instead. Swiping left
   * inside a set of fifty walked straight out of it into another set's words,
   * which is what it looked like: 한 세트에서 다음 세트로 넘어감.
   *
   * The absence of a set cannot answer this on its own — the library list has
   * no set either — so the list says so when it links.
   */
  const fromList = from === 'list'

  // These two are about the word, not the reader, so they leave before the
  // session comes back rather than queueing behind it.
  const translationsPromise = listTranslations(id)
  const neighboursPromise = fromList
    ? wordNeighbours({ id, setId, unassigned, mapsOnly })
    : Promise.resolve({ prev: null, next: null })

  // Who is reading comes from the cookie, not from a query. The session row is
  // still checked — `confirm` is awaited below, next to everything else — but
  // it no longer stands in front of the page's own reads. See `readerFromCookie`.
  const { reader, confirm } = await readerFromCookie()

  // Curators see drafts so they can review them in situ; students never do.
  const isCurator = reader.role === 'teacher' || reader.role === 'admin'

  // Both views below want this student's state and this word's glosses, and
  // running in parallel neither can hand them to the other — so they are read
  // once here and the *promises* are handed over, not the values. Awaiting
  // them first would have been a round trip of its own in front of every other
  // read on the page, which over a pooled connection is most of what the wait
  // is made of. The bookmark rides along on a row this read already carries.
  const statePromise = collectWordState(reader.id, id)

  const [state, personal, map, neighbours] = await Promise.all([
    statePromise,
    getPersonalBrainMap(reader.id, id, {
      state: statePromise,
      translations: translationsPromise,
    }),
    buildSemanticMap(reader.id, id, {
      approvedOnly: !isCurator,
      state: statePromise,
      translations: translationsPromise,
    }),
    neighboursPromise,
    // Nothing above is rendered until the cookie's session has been proved
    // real; a revoked one redirects instead.
    confirm,
  ])
  if (!personal) notFound()
  const bookmarked = state.state?.bookmarkedAt != null

  return (
    <div className="animate-rise" data-wide>
      <div className="flex items-baseline justify-between gap-3">
        <Link
          href={`/study${listQuery}`}
          className="text-[0.8125rem] text-ink-3 transition hover:text-ink-2"
        >
          ← 단어
        </Link>
        {/* The only route from a published word to its review screen, so it
            survives here rather than in the band of state that used to run
            under the heading. */}
        {isCurator && map ? (
          <Link
            href={`/admin/${map.brainMapId}`}
            className="shrink-0 text-[0.8125rem] text-ink-3 transition hover:text-ink-2"
          >
            {map.status === 'approved' ? '검수 화면' : '검수 대기 · 열기'}
          </Link>
        ) : null}
      </div>

      {/* The word is the largest thing on the page and the map is the second.
          Everything else here is a caption. Tight tracking and a tight gap to
          the gloss, so the two read as one block rather than as two rows. */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-3 sm:mt-4">
        <div className="min-w-0">
          {/* The word, then how to say it, then what it means. A student who
              cannot pronounce a word has not learned it, and that question
              comes before the gloss. */}
          <div className="flex items-center gap-1.5">
            <h1 className="text-[1.875rem] leading-[1.15] font-semibold tracking-[-0.028em] sm:text-[2.25rem]">
              {personal.lemma}
            </h1>
            <SpeakButton text={personal.lemma} size="lg" />
          </div>
          {/* Just the gloss. The core meaning belongs on its own node, where
              it is something to study rather than a subtitle to skim. */}
          <p className="mt-1 text-sm text-ink-2 break-keep">{personal.translation ?? '—'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {personal.isImportant ? <Tag tone="warn">중요</Tag> : null}
          <BookmarkButton vocabularyId={id} bookmarked={bookmarked} size="lg" />
        </div>
      </header>

      {map ? (
        <BrainMapExplorer
          vocabularyId={id}
          lemma={map.lemma}
          nodes={map.nodes}
          recommendedNodeId={map.recommendedNodeId}
          alreadyOpened={personal.openedAt !== null}
        />
      ) : (
        <div className="mt-10 text-center">
          <p className="text-sm text-ink-2">아직 이 단어의 Brain Map이 없어요.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[0.8125rem] leading-relaxed text-ink-3 break-keep">
            {isCurator
              ? 'AI 초안을 생성한 뒤 검수하면 학생에게 공개돼요.'
              : '지금은 반복 학습으로 충분한 단어예요.'}
          </p>
          {isCurator ? <GenerateButton vocabularyId={id} /> : null}
        </div>
      )}

      {/* The next word is opened the same way this one was — walking the list
          — so it is told so too, or the pager would work once and then vanish. */}
      <WordPager
        prev={neighbours.prev}
        next={neighbours.next}
        query={listSearch(set, view, { fromList })}
      />

      {/* Throwing a word away is a curator's job and this is the one screen
          that can reach every word, mapped or not — so it is the one screen
          that can offer it. Quiet, at the very bottom, two steps. */}
      {isCurator ? (
        <div className="mt-8 text-center">
          <DeleteWord vocabularyId={id} lemma={personal.lemma} hasMap={map !== null} />
        </div>
      ) : null}
    </div>
  )
}

/** The list this page belongs to, as a query string to carry around. */
function listSearch(
  set: string | undefined,
  view: string | undefined,
  opts: { fromList?: boolean } = {},
): string {
  const params = new URLSearchParams()
  if (set) params.set('set', set)
  if (view === 'map') params.set('view', 'map')
  if (opts.fromList) params.set('from', 'list')
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}
