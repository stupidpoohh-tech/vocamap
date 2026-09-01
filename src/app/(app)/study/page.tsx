import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { getTodaySummary } from '@/lib/data/study'
import { listRecommendedWords } from '@/lib/data/personal'
import { Badge, Button, Card, EmptyState } from '@/components/ui'
import { greetingKo } from '@/lib/utils'

/**
 * The student home. Deliberately not a dashboard: three numbers and one
 * button. Anything that is not "what do I do now" belongs on another screen.
 */
export default async function StudyHome() {
  const actor = await requireActor()
  const [summary, recommended] = await Promise.all([
    getTodaySummary(actor.id),
    listRecommendedWords(actor.id, 5),
  ])

  const total = summary.dueCount + summary.newCount

  return (
    <div className="animate-rise">
      <p className="text-sm text-muted">{greetingKo()}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{actor.displayName}님</h1>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="오늘 복습" value={summary.dueCount} unit="개" tone="brand" />
        <Stat label="새 단어" value={summary.newCount} unit="개" />
        <Stat label="Brain Map" value={summary.recommendedCount} unit="개" tone="warn" />
      </div>

      {total > 0 ? (
        <Link href="/study/session" className="mt-5 block">
          <Button size="lg" className="w-full">
            학습 시작 · {total}문제
          </Button>
        </Link>
      ) : (
        <Card className="mt-5 text-center">
          <p className="font-semibold">오늘 할 학습을 모두 마쳤어요.</p>
          <p className="mt-1 text-sm text-muted">
            {summary.recommendedCount > 0
              ? '아래 추천 단어를 살펴봐도 좋아요.'
              : '내일 다시 만나요.'}
          </p>
        </Card>
      )}

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Brain Map 추천</h2>
          <span className="text-xs text-muted">깊이 볼 만한 단어</span>
        </div>

        {recommended.length === 0 ? (
          <EmptyState
            title="아직 추천할 단어가 없어요"
            hint="자주 틀리거나 중요 표시한 단어가 생기면 여기에 나타나요."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {recommended.map((word) => (
              <li key={word.vocabularyId}>
                <Link
                  href={`/words/${word.vocabularyId}`}
                  className="card flex items-center justify-between gap-4 px-5 py-4 transition hover:border-brand"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{word.lemma}</p>
                    <p className="truncate text-sm text-muted">
                      {word.message ?? word.translation ?? ''}
                    </p>
                  </div>
                  <Badge tone="warn">열기</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  tone = 'neutral',
}: {
  label: string
  value: number
  unit: string
  tone?: 'neutral' | 'brand' | 'warn'
}) {
  return (
    <div className="card px-4 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums ${
          tone === 'brand' ? 'text-brand' : tone === 'warn' ? 'text-warn' : ''
        }`}
      >
        {value}
        <span className="ml-0.5 text-sm font-medium text-muted">{unit}</span>
      </p>
    </div>
  )
}
