'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

/**
 * 옛 주소를 단어 목록으로 보낸다 — 브라우저에서.
 *
 * `/map` 과 `/words` 는 서버에서 `redirect()` 하던 화면이었다. 그 자체로는 싼
 * 일인데, 둘 다 주소의 물음표 뒤를 읽어 어디로 보낼지 정했고, 그것을 읽는
 * 순간 Next 는 이 화면을 요청마다 만들기로 바꾼다. 받아 줄 사람이 거의 없는
 * 옛 링크 때문에 서버가 매번 깨어나는 셈이다.
 *
 * 그래서 보내는 일을 브라우저가 한다. 껍데기는 미리 구워지고, 열리면 곧바로
 * 목록으로 간다. 글과 링크를 함께 두는 것은 스크립트가 막혀
 * 있어도 길이 막히지 않게 하기 위해서다.
 */
export function GoToStudy() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/study')
  }, [router])

  return (
    <p className="py-16 text-center text-sm text-ink-3 break-keep">
      단어 목록으로 옮겨졌어요.{' '}
      <Link href="/study" className="text-ink-2 underline underline-offset-4">
        단어 보기
      </Link>
    </p>
  )
}
