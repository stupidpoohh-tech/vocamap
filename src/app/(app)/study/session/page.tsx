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
  searchParams: Promise<{
    scope?: string
    dir?: string
    set?: string
    unassigned?: string
    from?: string
  }>
}) {
  const { scope: scopeParam, dir, set, unassigned, from } = await searchParams
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
        <Link
          href={backHref(scope, set, unassigned === '1', from)}
          className="mt-4 inline-block"
        >
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
      <SessionRunner
        questions={questions}
        backHref={backHref(scope, set, unassigned === '1', from)}
      />
    </>
  )
}

const EMPTY: Record<ReturnType<typeof parseQueueScope>, string> = {
  due: '지금 복습할 단어가 없어요.',
  all: '시험 볼 단어가 없어요.',
  saved: '담은 단어가 없어요.',
  wrong: '틀린 단어가 없어요.',
  mapped: '이 세트에는 맵이 있는 단어가 없어요.',
}

/**
 * Where "done" goes.
 *
 * Back to the list you were tested on, not to the shelf. A student working
 * through one set a day finishes the test and wants the words again — landing
 * on a list of every set means finding it a second time.
 *
 * The daily review is the one test two screens can start, so it carries `from`
 * and returns to whichever of them sent it.
 */
function backHref(
  scope: ReturnType<typeof parseQueueScope>,
  set?: string,
  unassigned?: boolean,
  from?: string,
): string {
  if (scope === 'saved') return '/study?tab=saved'
  if (scope === 'wrong') return '/vault?tab=wrong'
  if (scope === 'mapped') {
    if (set) return `/study?set=${set}&view=map`
    if (unassigned) return '/study?set=none&view=map'
    return '/study'
  }
  if (scope === 'due') return from === 'vault' ? '/vault' : '/study'
  if (set) return `/study?set=${set}`
  if (unassigned) return '/study?set=none'
  return '/study'
}
