import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { getPersonalBrainMap } from '@/lib/data/personal'
import { buildSemanticMap } from '@/lib/data/semantic-map'
import { Tag } from '@/components/ui'
import { bookmarkedIds, collectWordState } from '@/lib/data/study'
import { BookmarkButton } from '@/components/words/bookmark-button'
import { BrainMapExplorer } from './brain-map-explorer'
import { GenerateButton } from './generate-button'
import { DeleteWord } from './delete-word'

export default async function WordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await requireActor()

  // Curators see drafts so they can review them in situ; students never do.
  const isCurator = actor.role === 'teacher' || actor.role === 'admin'
  // One read of this student's state for the word, shared by both views below.
  // They used to collect it separately, which doubled the page's round trips
  // for one set of numbers.
  const state = await collectWordState(actor.id, id)
  const [personal, map, bookmarks] = await Promise.all([
    getPersonalBrainMap(actor.id, id, { state }),
    buildSemanticMap(actor.id, id, { approvedOnly: !isCurator, state }),
    bookmarkedIds(actor.id, [id]),
  ])
  if (!personal) notFound()

  return (
    <div className="animate-rise">
      <div className="flex items-baseline justify-between gap-3">
        <Link href="/map" className="text-[0.8125rem] text-ink-3 transition hover:text-ink-2">
          ← 맵
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
          Everything else here is a caption. */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[2rem] font-semibold tracking-tight">{personal.lemma}</h1>
          {/* Just the gloss. The core meaning belongs on its own node, where
              it is something to study rather than a subtitle to skim. */}
          <p className="mt-0.5 text-sm text-ink-2 break-keep">{personal.translation ?? '—'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {personal.isImportant ? <Tag tone="warn">중요</Tag> : null}
          <BookmarkButton vocabularyId={id} bookmarked={bookmarks.has(id)} size="lg" />
        </div>
      </header>

      {map ? (
        <BrainMapExplorer
          vocabularyId={id}
          lemma={map.lemma}
          nodes={map.nodes}
          recommendedNodeId={map.recommendedNodeId}
        />
      ) : (
        <div className="mt-10 text-center">
          <p className="text-sm text-ink-2">아직 이 단어의 Brain Map이 없어요.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[0.8125rem] leading-relaxed text-ink-3 break-keep">
            {isCurator
              ? 'AI 초안을 생성한 뒤 검수하면 학생에게 공개돼요.'
              : '지금은 반복 학습으로 충분한 단어예요.'}
          </p>
          {isCurator ? (
            <>
              <GenerateButton vocabularyId={id} />
              <DeleteWord vocabularyId={id} lemma={personal.lemma} />
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
