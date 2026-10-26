import Link from 'next/link'
import { notFound } from 'next/navigation'
import { allWords, mapFor, wordBySlug } from '@/content'
import { nodesFor } from '@/content/map'
import { MapExplorer } from '@/components/brain-map/map-explorer'
import { SpeakButton } from '@/components/words/speak-button'
import { WordStar } from '@/components/words/word-star'
import { WordPager } from './word-pager'

/**
 * 단어 하나와 그 맵 — 빌드할 때 구워 둔다.
 *
 * 예전에는 이 화면이 요청마다 Postgres 를 여섯 번 왕복하며 만들어졌고, 그중
 * 넷은 "이 학생이 이 노드를 몇 번 맞혔나"였다. 콘텐츠는 모두에게 같으니 미리
 * 한 번 굽고, 기록은 브라우저가 자기 것을 얹는다.
 *
 * 그래서 이 파일에는 `searchParams` 가 없다. 주소에 붙은 값을 읽는 것만으로
 * Next 는 이 화면을 요청마다 만들기로 바꾸고, 그러면 구워 둔 것이 없어진다.
 * 세트와 보기 방식은 목록이 브라우저에서 들고 있다.
 */

export function generateStaticParams() {
  return allWords().map((word) => ({ slug: word.slug }))
}

/** 파일에 없는 단어는 404 다. 없는 주소를 요청마다 만들어 보지 않는다. */
export const dynamicParams = false

export default async function WordPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const word = wordBySlug(slug)
  if (!word) notFound()

  const map = mapFor(word.slug)
  const nodes = nodesFor(word)

  // 이전·다음은 이 단어가 처음 속한 세트의 적힌 순서다. 목록의 걸러내기는
  // 브라우저에 있어서 여기서 알 수 없고, 세트를 읽어 내려가는 것이 이 화면을
  // 연이어 여는 거의 모든 경우다.
  const { prev, next } = neighbours(word.slug)

  return (
    <div className="animate-rise" data-wide>
      <div className="flex items-baseline justify-between gap-3">
        <Link href="/study" className="text-[0.8125rem] text-ink-3 transition hover:text-ink-2">
          ← 단어
        </Link>
      </div>

      {/* 단어가 이 화면에서 가장 큰 것이고 맵이 그 다음이다. 나머지는 모두
          설명 글이다. */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-3 sm:mt-4">
        <div className="min-w-0">
          {/* 단어, 어떻게 읽는지, 그리고 무슨 뜻인지. 발음하지 못하는 단어를
              배운 것이 아니고, 그 질문이 뜻보다 먼저 온다. */}
          <div className="flex items-center gap-1.5">
            <h1 className="text-[1.875rem] leading-[1.15] font-semibold tracking-[-0.028em] sm:text-[2.25rem]">
              {word.lemma}
            </h1>
            <SpeakButton text={word.lemma} size="lg" />
          </div>
          <p className="mt-1 text-sm text-ink-2 break-keep">{word.ko || '—'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <WordStar slug={word.slug} />
        </div>
      </header>

      {map && nodes?.length ? (
        <MapExplorer slug={word.slug} lemma={map.lemma} nodes={nodes} />
      ) : (
        <div className="mt-10 text-center">
          <p className="text-sm text-ink-2">아직 이 단어의 Brain Map이 없어요.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[0.8125rem] leading-relaxed text-ink-3 break-keep">
            지금은 반복 학습으로 충분한 단어예요.
          </p>
        </div>
      )}

      <WordPager prev={prev} next={next} />
    </div>
  )
}

/** 세트 안에서 앞뒤 단어. 세트가 없으면 앞뒤도 없다. */
function neighbours(slug: string) {
  const word = wordBySlug(slug)
  const title = word?.sets[0]
  const siblings = title ? allWords().filter((w) => w.sets.includes(title)) : []
  const at = siblings.findIndex((w) => w.slug === slug)
  if (at < 0) return { prev: null, next: null }

  const brief = (w: (typeof siblings)[number] | undefined) =>
    w ? { slug: w.slug, lemma: w.lemma } : null
  return { prev: brief(siblings[at - 1]), next: brief(siblings[at + 1]) }
}
