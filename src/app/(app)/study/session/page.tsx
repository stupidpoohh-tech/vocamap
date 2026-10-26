import { Suspense } from 'react'
import { Card } from '@/components/ui'
import { allWords } from '@/content'
import { SessionScreen } from '@/components/words/session-screen'

/**
 * 시험.
 *
 * 화면은 모두에게 같은 것이 빌드할 때 한 번 구워진다. 무엇을 물을지는 주소에
 * 붙은 범위와 이 폰의 기록이 정하고, 그 둘을 보는 것은 브라우저다 — 서버에서
 * 주소의 값을 읽는 것만으로 이 화면은 요청마다 만들어지는 화면이 된다.
 *
 * `Suspense` 가 필요한 것은 안쪽이 주소의 물음표 뒤를 읽기 때문이다. 미리
 * 굽는 동안에는 그 값이 없으므로, 구울 때는 아래의 '준비하고 있어요'가
 * 구워지고 브라우저에서 바뀐다.
 */
export default function SessionPage() {
  const words = allWords().map((w) => ({
    slug: w.slug,
    lemma: w.lemma,
    ko: w.ko,
    sets: w.sets,
  }))

  return (
    <Suspense
      fallback={
        <Card className="text-center">
          <p className="text-sm text-ink-3">문제를 준비하고 있어요…</p>
        </Card>
      }
    >
      <SessionScreen words={words} />
    </Suspense>
  )
}
