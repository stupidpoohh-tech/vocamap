import Link from 'next/link'
import { getViewer } from '@/lib/auth/session'
import { buildScopedQueue, parseDirections, parseQueueScope } from '@/lib/data/study'
import { buildQuestions } from '@/lib/learning/questions'
import { Button, Card } from '@/components/ui'
import { SessionRunner } from './session-runner'
import { GuestNote } from '@/components/guest-note'

/**
 * The test. Which words it covers comes from the URL, so every list in the app
 * can hand the student a test over exactly what they were looking at.
 */
export default async function SessionPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; dir?: string; set?: string; unassigned?: string }>
}) {
  const { scope: scopeParam, dir, set, unassigned } = await searchParams
  const actor = await getViewer()
  const scope = parseQueueScope(scopeParam)

  const queue = await buildScopedQueue(actor.id, {
    scope,
    setId: set,
    unassigned: unassigned === '1',
    directions: parseDirections(dir),
  })

  if (queue.length === 0) {
    return (
      <Card className="text-center">
        <p className="font-semibold">{EMPTY[scope]}</p>
        <Link href={scope === 'due' ? '/study' : backHref(scope)} className="mt-4 inline-block">
          <Button variant="secondary">돌아가기</Button>
        </Link>
      </Card>
    )
  }

  // Distractors are drawn on the server from the shared word list, so the wrong
  // options are always plausible rather than random noise.
  const questions = await buildQuestions(actor.id, queue)
  return (
    <>
      {actor.isGuest ? (
        <GuestNote next="/study">이 시험의 결과는 저장되지 않아요. 복습 일정을 남기려면</GuestNote>
      ) : null}
      <SessionRunner questions={questions} backHref={backHref(scope)} />
    </>
  )
}

const EMPTY: Record<ReturnType<typeof parseQueueScope>, string> = {
  due: '지금 복습할 단어가 없어요.',
  all: '시험 볼 단어가 없어요.',
  saved: '저장한 단어가 없어요.',
  wrong: '틀린 단어가 없어요.',
}

function backHref(scope: ReturnType<typeof parseQueueScope>): string {
  if (scope === 'saved') return '/vault'
  if (scope === 'wrong') return '/vault?tab=wrong'
  return '/study'
}
