import { allWords, hasMap } from '@/content'
import { ReviewDesk } from '@/components/words/review-desk'

/**
 * SCREEN 2 — 복습.
 *
 * 화면은 모두에게 같은 것이 빌드할 때 한 번 구워진다. 무엇이 오늘 돌아왔는지는
 * 이 폰의 기록이 정하므로 브라우저가 얹는다 — 서버는 누가 보는지 모른다.
 *
 * 로그인을 묻지 않는다. 물을 것이 없어졌다: 기록이 서버에 없으므로 가려낼
 * 남의 것도 없다.
 */
export default function VaultPage() {
  const words = allWords().map((w) => ({
    slug: w.slug,
    lemma: w.lemma,
    ko: w.ko,
    hasMap: hasMap(w.slug),
  }))
  return <ReviewDesk words={words} />
}
