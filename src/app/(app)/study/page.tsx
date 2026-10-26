import { allSets, allWords, hasMap } from '@/content'
import { PageHeader } from '@/components/ui'
import { StudyBrowser, type BrowserWord } from '@/components/words/study-browser'

/**
 * 단어 목록.
 *
 * 요청마다 그리지 않는다. 여기 나오는 것은 모두에게 같은 것 — 선생님이 올린
 * 단어와 뜻뿐이라, 빌드할 때 한 번 구워 두면 끝이다. 고르고 거르고 검색하는
 * 일은 `StudyBrowser` 가 브라우저에서 하고, 담아 둔 표시와 복습 일정은 이
 * 폰에만 있는 것이라 역시 브라우저에서 붙는다.
 *
 * 이 파일에 `searchParams` 가 없는 것이 중요하다. 그것을 읽는 순간 Next 는
 * 이 화면을 요청마다 그리는 것으로 바꾸고, 미리 굽는 효과가 통째로 사라진다.
 */
export default function StudyPage() {
  const words: BrowserWord[] = allWords().map((w) => ({
    slug: w.slug,
    lemma: w.lemma,
    ko: w.ko,
    sets: w.sets,
    hasMap: hasMap(w.slug),
  }))

  return (
    <div className="animate-rise">
      <PageHeader
        title="단어"
        subtitle={`${allSets().length}개 세트 · ${words.length}개 단어`}
      />
      <StudyBrowser words={words} sets={allSets().map((s) => s.title)} />
    </div>
  )
}
