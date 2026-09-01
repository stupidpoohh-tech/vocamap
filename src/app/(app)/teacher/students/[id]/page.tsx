import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { requireRole } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import {
  assertCanAccessStudent,
  listConfusions,
  listWeakWords,
  studentProgressSummary,
} from '@/lib/data/teacher'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { FlagButton } from './flag-button'

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const actor = await requireRole('teacher', 'admin')

  // Throws before any student data is read if there is no active link.
  await assertCanAccessStudent(actor, id)

  const [student] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!student) notFound()

  const [weak, confusions, summary] = await Promise.all([
    listWeakWords(id, 15),
    listConfusions(id, 8),
    studentProgressSummary(id),
  ])

  return (
    <div className="animate-rise">
      <Link href="/teacher" className="text-sm text-muted hover:text-ink">
        ← 교사
      </Link>
      <PageHeader title={student.displayName} subtitle={student.email} />

      <div className="mb-8 grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted">학습 중 카드</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{summary.cards}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">총 복습</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{summary.reps}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted">망각 횟수</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-warn">{summary.lapses}</p>
        </Card>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">자주 틀리는 단어</h2>
        {weak.length === 0 ? (
          <EmptyState title="아직 데이터가 없어요" hint="학생이 학습을 시작하면 나타납니다." />
        ) : (
          <ul className="flex flex-col gap-2">
            {weak.map((word) => (
              <li
                key={word.vocabularyId}
                className="card flex items-center justify-between gap-3 px-5 py-3.5"
              >
                <Link
                  href={`/words/${word.vocabularyId}`}
                  className="min-w-0 flex-1 font-semibold hover:text-brand"
                >
                  {word.lemma}
                </Link>
                <Badge tone={word.wrong >= 3 ? 'bad' : 'warn'}>
                  {word.wrong} / {word.total} 오답
                </Badge>
                <FlagButton studentId={id} vocabularyId={word.vocabularyId} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">헷갈리는 단어 짝</h2>
        {confusions.length === 0 ? (
          <EmptyState
            title="아직 혼동 기록이 없어요"
            hint="Similar Words 학습에서 틀린 짝이 여기에 쌓입니다."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {confusions.map((pair) => (
              <li key={pair.pairId} className="card flex items-center justify-between px-5 py-3.5">
                <span className="font-semibold">
                  {pair.lemmaA} <span className="text-muted">↔</span> {pair.lemmaB}
                </span>
                <Badge tone="bad">{pair.wrongCount}회 오답</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
