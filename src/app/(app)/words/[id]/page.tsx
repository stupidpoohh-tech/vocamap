import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { getPersonalBrainMap } from '@/lib/data/personal'
import { buildSemanticMap } from '@/lib/data/semantic-map'
import { Badge, Card } from '@/components/ui'
import { RETENTION_BAND_LABEL } from '@/lib/learning/scheduler'
import { relativeKo } from '@/lib/utils'
import { bookmarkedIds } from '@/lib/data/study'
import { BookmarkButton } from '@/components/words/bookmark-button'
import { BrainMapExplorer } from './brain-map-explorer'
import { GenerateButton } from './generate-button'

export default async function WordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await requireActor()

  // Curators see drafts so they can review them in situ; students never do.
  const isCurator = actor.role === 'teacher' || actor.role === 'admin'
  const [personal, map, bookmarks] = await Promise.all([
    getPersonalBrainMap(actor.id, id),
    buildSemanticMap(actor.id, id, { approvedOnly: !isCurator }),
    bookmarkedIds(actor.id, [id]),
  ])
  if (!personal) notFound()

  return (
    <div className="animate-rise">
      <Link href="/map" className="text-sm text-muted hover:text-ink">
        ← 맵
      </Link>

      {/* Compact by design: the protagonist of this page is the map below. */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{personal.lemma}</h1>
          {/* Just the gloss. The core meaning belongs on its own node, where
              it is something to study rather than a subtitle to skim. */}
          <p className="mt-1 text-sm text-muted break-keep">{personal.translation ?? '—'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {personal.isImportant ? <Badge tone="warn">중요 단어</Badge> : null}
          <BookmarkButton vocabularyId={id} bookmarked={bookmarks.has(id)} size="lg" />
        </div>
      </header>

      <RecallStrip directions={personal.directions} />

      {isCurator && map ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5">
          <Badge tone={map.status === 'approved' ? 'good' : 'warn'}>
            {map.status === 'approved' ? '학생에게 공개됨' : '검수 대기 — 학생에게 안 보임'}
          </Badge>
          <Link href={`/admin/${map.brainMapId}`} className="text-sm font-medium text-brand">
            검수 화면에서 열기 →
          </Link>
        </div>
      ) : null}

      {map ? (
        <BrainMapExplorer
          vocabularyId={id}
          lemma={map.lemma}
          nodes={map.nodes}
          reasons={map.reasons}
          recommendedNodeId={map.recommendedNodeId}
        />
      ) : (
        <Card className="mt-8 text-center">
          <p className="font-semibold">아직 이 단어의 Brain Map이 없어요.</p>
          <p className="mt-1 text-sm text-muted">
            {isCurator
              ? 'AI 초안을 생성한 뒤 검수하면 학생에게 공개됩니다.'
              : '지금은 반복 학습으로 충분한 단어예요.'}
          </p>
          {isCurator ? <GenerateButton vocabularyId={id} /> : null}
        </Card>
      )}
    </div>
  )
}

/**
 * SRS state on one line. It still matters, but it is not what this page is for
 * — two large cards for it made the memorisation loop look like the point.
 */
function RecallStrip({
  directions,
}: {
  directions: Awaited<ReturnType<typeof getPersonalBrainMap>> extends infer T
    ? T extends { directions: infer D }
      ? D
      : never
    : never
}) {
  const next = directions
    .map((d) => d.dueAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0]

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y border-line py-2.5 text-sm">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">기본 암기</span>
      {directions.map((d) => (
        <span key={d.direction} className="flex items-center gap-1.5">
          <span className="text-muted">{d.direction === 'en_ko' ? '영→한' : '한→영'}</span>
          <span
            className={
              d.reps === 0
                ? 'text-muted'
                : d.band === 'strong'
                  ? 'font-semibold text-good'
                  : d.band === 'fair'
                    ? 'font-semibold text-warn'
                    : 'font-semibold text-bad'
            }
          >
            {d.reps === 0 ? '학습 전' : RETENTION_BAND_LABEL[d.band]}
          </span>
        </span>
      ))}
      {next ? <span className="text-muted">다음 복습 {relativeKo(next)}</span> : null}
    </div>
  )
}
