import { requireCurator } from '@/lib/auth/session'
import { listReadingCandidates } from '@/lib/data/definition-reading'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { ReadingCandidate } from './candidate'

/**
 * Model-written readings, before anyone has read them.
 *
 * These used to be published the moment the model answered — straight onto the
 * meaning row that students and guests read. Nothing was wrong with most of
 * them, which is the problem: there was no point at which a person could have
 * caught the ones that were.
 *
 * A candidate sits here until a curator publishes or discards it. While it
 * waits, the word shows whatever reading it already had, or none.
 */
export default async function ReadingReviewPage() {
  await requireCurator()
  const candidates = await listReadingCandidates()

  return (
    <div className="animate-rise">
      <PageHeader
        title="영영 풀이 해석 검수"
        subtitle="AI가 제안한 해석입니다. 승인해야 학생에게 보입니다."
      />

      {candidates.length ? (
        <div className="flex flex-col gap-3">
          {candidates.map((candidate) => (
            <ReadingCandidate
              key={candidate.id}
              candidate={{
                ...candidate,
                // Formatted here, on one clock. See `Candidate.generatedAt`.
                generatedAt: candidate.generatedAt
                  ? candidate.generatedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
                  : null,
              }}
            />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="검수할 해석이 없어요"
            hint="교사 화면에서 해석 보충을 실행하면 여기에 후보가 쌓입니다."
          />
        </Card>
      )}
    </div>
  )
}
