'use client'

import { useEffect, useState } from 'react'
import { isBookmarked, read } from '@/learning/store'
import { BookmarkButton } from './bookmark-button'

/**
 * 단어 상세 화면의 별.
 *
 * 목록에서는 기록을 목록이 한 번 읽어 스무 줄에 나눠 주지만, 이 화면에는
 * 단어가 하나뿐이라 별이 직접 읽는다. 첫 그림에는 담지 않는다 — 미리 구워 둔
 * HTML 은 모두에게 같은 것이고, 거기에 내 별이 찍혀 있으면 브라우저가 그릴
 * 때와 어긋난다.
 */
export function WordStar({ slug }: { slug: string }) {
  const [bookmarked, setBookmarked] = useState(false)
  useEffect(() => setBookmarked(isBookmarked(read(), slug)), [slug])
  return <BookmarkButton slug={slug} bookmarked={bookmarked} size="lg" />
}
