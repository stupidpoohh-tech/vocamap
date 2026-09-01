import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/session'
import { getBrainMapView } from '@/lib/data/personal'
import { Card } from '@/components/ui'
import { RETENTION_BAND_LABEL } from '@/lib/learning/scheduler'
import { relativeKo } from '@/lib/utils'
import { BrainMapExplorer } from './brain-map-explorer'
import { GenerateButton } from './generate-button'
import { ImportantToggle } from './important-toggle'

export default async function WordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await requireActor()

  // Curators see drafts so they can review them in situ; students never do.
  const isCurator = actor.role === 'teacher' || actor.role === 'admin'
  const view = await getBrainMapView(actor.id, id, { approvedOnly: !isCurator })
  if (!view) notFound()

  const { master, personal, nodes } = view

  return (
    <div className="animate-rise">
      <Link href="/words" className="text-sm text-muted hover:text-ink">
        ← 단어
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{personal.lemma}</h1>
          {personal.translation ? (
            <p className="mt-1 text-muted">{personal.translation}</p>
          ) : null}
        </div>
        <ImportantToggle vocabularyId={id} isImportant={personal.isImportant} />
      </div>

      {/* Memory state, in words rather than numbers. */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {personal.directions.map((d) => (
          <Card key={d.direction} className="p-4">
            <p className="text-xs text-muted">
              {d.direction === 'en_ko' ? '영어 → 한국어' : '한국어 → 영어'}
            </p>
            <p
              className={`mt-1 text-lg font-bold ${
                d.reps === 0
                  ? 'text-muted'
                  : d.band === 'strong'
                    ? 'text-good'
                    : d.band === 'fair'
                      ? 'text-warn'
                      : 'text-bad'
              }`}
            >
              {d.reps === 0 ? '학습 전' : RETENTION_BAND_LABEL[d.band]}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {d.dueAt ? `다음 복습 ${relativeKo(d.dueAt)}` : '아직 학습하지 않았어요'}
            </p>
          </Card>
        ))}
      </div>

      {personal.recommendation.recommend && personal.recommendation.message ? (
        <div className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn">
          {personal.recommendation.message}
        </div>
      ) : null}

      {master ? (
        <BrainMapExplorer
          master={master}
          nodes={nodes}
          vocabularyId={id}
          suggestedNodes={personal.recommendation.suggestedNodes}
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
