'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { SessionRunner } from '@/components/words/session-runner'
import { buildQueue, buildQuestions, parseDirections, parseScope, type Candidate, type Question } from '@/learning/session'
import { read } from '@/learning/store'

/**
 * 시험 화면 — 범위를 주소에서 읽고, 문제는 이 브라우저에서 만든다.
 *
 * 범위가 주소에 남아 있는 것은 그것이 진짜 주소이기 때문이다. 목록이
 * "이 세트 시험 보기"로 건네주고, 복습 화면이 "복습 시작"으로 건네준다 —
 * 둘 다 다시 열 수 있어야 하는 링크다.
 *
 * 다만 그 값을 서버에서 읽지 않는다. 서버에서 읽으면 Next 는 이 화면을
 * 요청마다 만들기로 바꾸고, 그러면 미리 구워 둔 것이 없어진다. 구워 둔 것은
 * 모두에게 같은 껍데기이고, 안을 채우는 것은 이쪽이다.
 */
export function SessionScreen({ words }: { words: Candidate[] }) {
  const params = useSearchParams()
  const scope = parseScope(params.get('scope'))
  const set = params.get('set')
  const dir = params.get('dir')

  /**
   * 문제는 그려진 뒤에 만든다.
   *
   * 기록이 이 폰에만 있어서이기도 하고, 보기를 섞는 것이 `Math.random` 이라
   * 서버가 그린 것과 브라우저가 그린 것이 애초에 같을 수 없기 때문이기도 하다.
   */
  const [questions, setQuestions] = useState<Question[] | null>(null)
  useEffect(() => {
    const saved = read()
    const queue = buildQueue(words, saved, {
      scope,
      set,
      directions: parseDirections(dir),
    })
    setQuestions(buildQuestions(queue, words))
  }, [words, scope, set, dir])

  const back = backHref(scope, set)

  if (questions === null) {
    return (
      <Card className="text-center">
        <p className="text-sm text-ink-3">문제를 준비하고 있어요…</p>
      </Card>
    )
  }

  if (questions.length === 0) {
    return (
      <Card className="text-center">
        <p className="font-semibold">{EMPTY[scope]}</p>
        <Link href={back} className="mt-4 inline-block">
          <Button variant="secondary">돌아가기</Button>
        </Link>
      </Card>
    )
  }

  return <SessionRunner questions={questions} backHref={back} />
}

const EMPTY: Record<ReturnType<typeof parseScope>, string> = {
  due: '지금 복습할 단어가 없어요. 단어를 담아 두면 여기에 쌓여요.',
  all: '시험 볼 단어가 없어요.',
  saved: '담은 단어가 없어요.',
  wrong: '틀린 단어가 없어요.',
}

/**
 * "마치기" 가 가는 곳.
 *
 * 시험 본 목록으로 돌아간다. 하루에 세트 하나를 떼는 학생은 시험을 마치면 그
 * 단어들을 다시 보고 싶어 하고, 세트 전체 목록에 떨어지면 그것을 한 번 더
 * 찾아야 한다.
 *
 * 세트는 이제 주소가 아니라 브라우저가 들고 있는 탭이라, 목록으로 돌아가는
 * 것까지가 여기서 할 수 있는 전부다.
 */
function backHref(scope: ReturnType<typeof parseScope>, set: string | null): string {
  if (scope === 'wrong') return '/vault'
  if (scope === 'due') return '/vault'
  void set
  return '/study'
}
