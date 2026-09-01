import Link from 'next/link'
import { requireActor } from '@/lib/auth/session'
import { buildTodayQueue } from '@/lib/data/study'
import { buildQuestions } from '@/lib/learning/questions'
import { Button, Card } from '@/components/ui'
import { SessionRunner } from './session-runner'

export default async function SessionPage() {
  const actor = await requireActor()
  const queue = await buildTodayQueue(actor.id)

  if (queue.length === 0) {
    return (
      <Card className="text-center">
        <p className="font-semibold">지금 학습할 단어가 없어요.</p>
        <Link href="/study" className="mt-4 inline-block">
          <Button variant="secondary">홈으로</Button>
        </Link>
      </Card>
    )
  }

  // Distractors are drawn on the server from the student's own assigned words,
  // so the wrong options are always plausible rather than random noise.
  const questions = await buildQuestions(actor.id, queue)
  return <SessionRunner questions={questions} />
}
