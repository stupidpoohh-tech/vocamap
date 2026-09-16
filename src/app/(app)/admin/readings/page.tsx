import { requireCurator } from '@/lib/auth/session'
import { listReadingCandidates, listReadingsNeedingReview } from '@/lib/data/definition-reading'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { ExistingReading, ReadingCandidate } from './candidate'

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
  const [candidates, unreviewed] = await Promise.all([
    listReadingCandidates(),
    listReadingsNeedingReview(),
  ])

  return (
    <div className="animate-rise">
      <PageHeader
        title="영영 풀이 해석 검수"
        subtitle="AI가 제안한 해석입니다. 승인해야 학생에게 보입니다."
      />

      <h2 className="mb-2 text-sm font-semibold">새 후보</h2>
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

      {/* Everything written before there was a review step. It stays on screen
          for students the whole time — this is about recording that a person
          has now read it, not about taking it down. */}
      <h2 className="mt-8 mb-1 text-sm font-semibold">확인 기록이 없는 기존 해석</h2>
      <p className="mb-3 text-xs text-ink-3 break-keep">
        검수 절차가 생기기 전에 공개된 해석입니다. 지금도 학생에게 그대로 보이고 있으며, 확인을
        누르면 누가 언제 확인했는지가 남습니다.
      </p>
      {unreviewed.length ? (
        <div className="flex flex-col gap-3">
          {unreviewed.map((row) => (
            <ExistingReading key={row.id} reading={row} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState title="확인이 필요한 기존 해석이 없어요" />
        </Card>
      )}
    </div>
  )
}
