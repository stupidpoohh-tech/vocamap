import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'
import { Button } from '@/components/ui'
import { MapIllustration } from '@/components/brain-map/map-illustration'
import { NODE_LABEL, NODE_TYPES, type NodeType } from '@/lib/learning/nodes'

/**
 * Public landing page.
 *
 * A visitor who has never signed in should meet the idea before a password
 * field. Someone already signed in has met it, so they go straight to work.
 */
export default async function LandingPage() {
  const actor = await getActor()
  if (actor) redirect(actor.role === 'student' ? '/study' : '/teacher')

  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main>
        <Hero />
        <Problem />
        <Loop />
        <MapSection />
        <Sample />
        <Audience />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
        <span className="text-[0.8125rem] font-medium text-ink-2">VOCA BRAIN MAP</span>
        <Link href="/login" className="text-sm font-medium text-ink-3 hover:text-ink">
          로그인
        </Link>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto grid max-w-5xl gap-10 px-5 pb-16 pt-14 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12">
        <div>
          <p className="text-[0.8125rem] font-medium text-ink-2">영어 어휘 학습</p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.2] tracking-tight break-keep sm:text-5xl">
            암기는 반복하고,
            <br />
            이해가 필요한 단어는
            <br className="sm:hidden lg:block" /> 연결한다.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-3 break-keep sm:text-lg">
            모든 단어를 똑같이 깊게 공부하지 않습니다. 평소에는 빠르게 외우고, 학생이
            자꾸 막히는 단어를 만났을 때만 그 단어의{' '}
            <strong className="font-semibold text-ink">Brain Map</strong>을 펼쳐
            의미·문장·유사어·연어·파생어까지 연결해 학습합니다.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/login?mode=signup" className="sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto sm:px-8">
                시작하기
              </Button>
            </Link>
            <Link href="/login" className="sm:w-auto">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto sm:px-8">
                이미 계정이 있어요
              </Button>
            </Link>
          </div>
        </div>

        {/* The product itself, above the fold on desktop. */}
        <div className="mt-4 lg:mt-0">
          <MapIllustration />
          <p className="mt-3 text-center text-xs text-ink-3 break-keep">
            단어 <span className="font-semibold text-ink">maintain</span>의 Brain Map — 색이 곧
            지금 내 학습 상태입니다
          </p>
        </div>
      </div>
    </section>
  )
}

function Problem() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto max-w-5xl px-5 py-14">
        <h2 className="max-w-xl text-2xl font-semibold leading-snug tracking-tight break-keep sm:text-3xl">
          단어장은 다 외웠는데,
          <br />왜 문장에서는 안 보일까요?
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            {
              q: '“maintain은 유지하다”',
              a: '뜻은 외웠지만 maintain a machine이 왜 “정비하다”가 되는지는 모릅니다.',
            },
            {
              q: 'affect와 effect',
              a: '몇 번을 봐도 시험만 되면 다시 헷갈립니다.',
            },
            {
              q: '외운 단어가 사라짐',
              a: '2주 전에 맞혔던 단어를 오늘은 틀립니다.',
            },
          ].map((item) => (
            <div key={item.q} className="border-t border-line pt-4">
              <p className="font-semibold break-keep">{item.q}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-3 break-keep">{item.a}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-xl text-base leading-relaxed break-keep">
          단어를 <strong className="font-semibold">더 많이</strong> 외워서 풀리는 문제가
          아닙니다. 어떤 단어는 반복이 필요하고, 어떤 단어는 이해가 필요합니다.
          <span className="text-ink-3"> 이 둘을 구분하는 것이 이 서비스가 하는 일입니다.</span>
        </p>
      </div>
    </section>
  )
}

const LOOP: Array<{ title: string; body: string; accent?: boolean }> = [
  { title: '오늘의 복습', body: '영어→한국어, 한국어→영어 양방향으로 빠르게 확인합니다.' },
  {
    title: '기억이 흐려질 때 다시',
    body: '검증된 간격 반복 알고리즘이 단어마다 다시 볼 시점을 계산합니다.',
  },
  {
    title: '막히는 단어를 감지',
    body: '반복해서 틀리거나, 선생님이 중요하다고 표시한 단어를 찾아냅니다.',
    accent: true,
  },
  {
    title: 'Brain Map 확장',
    body: '그 단어만 깊이 들어갑니다. 중심 의미부터 유사어 구분까지.',
    accent: true,
  },
  { title: '이해한 뒤 다시 복습', body: '이해가 붙은 단어는 그다음부터 잘 안 틀립니다.' },
]

function Loop() {
  return (
    <section className="mx-auto max-w-5xl px-5 py-16">
      <h2 className="text-2xl font-semibold tracking-tight break-keep sm:text-3xl">
        학습은 이렇게 돕니다
      </h2>
      <p className="mt-2 text-ink-3 break-keep">
        모든 단어가 Brain Map까지 가지 않습니다. 대부분은 3단계 전에서 끝납니다.
      </p>

      <ol className="mt-8 space-y-1">
        {LOOP.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            {/* Number rail doubles as the connecting line. */}
            <div className="flex flex-col items-center">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  step.accent ? 'bg-warn text-white' : 'bg-brand-soft text-brand'
                }`}
              >
                {i + 1}
              </span>
              {i < LOOP.length - 1 ? <span className="w-px flex-1 bg-line" /> : null}
            </div>
            <div className={`pb-7 ${i === LOOP.length - 1 ? 'pb-0' : ''}`}>
              <p className="font-semibold break-keep">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-3 break-keep">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

const NODE_BLURB: Record<NodeType, string> = {
  meaning_core: '여러 뜻을 관통하는 하나의 중심 개념. 사전 뜻 나열이 아닙니다.',
  sentences: '쓰임이 서로 다른 예문들. 먼저 직접 해석하고 나서 확인합니다.',
  similar_words: 'maintain과 keep처럼 헷갈리는 짝의 차이를 문제로 익힙니다.',
  collocations: '실제로 자주 함께 쓰는 표현만 3~5개.',
  word_family: 'maintain → maintenance. 빈칸에 맞는 형태를 고릅니다.',
}

function MapSection() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto max-w-5xl px-5 py-16">
        <h2 className="text-2xl font-semibold tracking-tight break-keep sm:text-3xl">
          Brain Map은 장식이 아닙니다
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-ink-3 break-keep">
          단어 하나를 중심에 두고 다섯 갈래로 펼칩니다. 각 갈래는 읽는 화면이 아니라 직접
          풀어보는 학습입니다. 콘텐츠가 아직 없는 갈래는 잠겨 있어서, 빈 화면으로 들어가는
          일이 없습니다.
        </p>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {NODE_TYPES.map((node) => (
            <li key={node} className="border-t border-line pt-4">
              <p className="font-semibold break-keep">{NODE_LABEL[node]}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-3 break-keep">
                {NODE_BLURB[node]}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-8 border-t border-line pt-4">
          <p className="text-sm break-keep">색은 꾸밈이 아니라 상태입니다</p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-3">
            {[
              // The data palette, not the brand one. "Selected" and "you are
              // part-way through this" were the same colour before.
              ['bg-data-known', '완료'],
              ['bg-data-learning', '학습 중'],
              ['bg-data-weak', '약한 부분'],
              ['bg-data-none', '아직 안 배움'],
            ].map(([dot, label]) => (
              <li key={label} className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function Sample() {
  return (
    <section className="mx-auto max-w-5xl px-5 py-16">
      <h2 className="text-2xl font-semibold tracking-tight break-keep sm:text-3xl">
        실제로 이런 내용이 나옵니다
      </h2>
      <p className="mt-2 text-ink-3 break-keep">단어 maintain의 Brain Map 일부입니다.</p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <div className="rounded-card bg-brand-soft/60 p-5">
          <p className="text-xs font-medium text-ink-2">MEANING CORE</p>
          <p className="mt-2 text-lg font-semibold leading-snug break-keep">
            어떤 상태가 끊기지 않고 계속 이어지도록 붙잡아 두다.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-3 break-keep">
            그래서 maintain a machine은 “정비하다”가 되고, maintain that…은 “계속 주장하다”가
            됩니다. 뜻을 따로 외우는 대신 하나로 연결합니다.
          </p>
        </div>

        <div className="rounded-card border border-line p-5">
          <p className="text-xs font-medium text-ink-2">SIMILAR WORDS</p>
          <p className="mt-2 flex items-center gap-2 text-lg font-semibold">
            <span className="text-brand">maintain</span>
            <span className="text-xs font-medium text-ink-3">vs</span>
            <span>keep</span>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-3 break-keep">
            keep은 그냥 그 상태로 두는 것이고, maintain은 무너지지 않도록 의식적으로
            노력하는 것입니다.
          </p>
          <p className="mt-3 rounded-control bg-line/30 px-3 py-2 text-sm break-keep">
            The hospital must <span className="font-semibold text-brand">___</span> strict
            hygiene standards.
          </p>
        </div>
      </div>
    </section>
  )
}

function Audience() {
  return (
    <section className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-5xl gap-6 px-5 py-16 sm:grid-cols-2">
        {[
          {
            role: '학생',
            title: '오늘 할 것만 보입니다',
            points: [
              '홈에는 오늘 복습·새 단어·추천 단어 세 숫자뿐',
              '한 화면에 한 문제, 답하면 바로 다음',
              '틀린 단어는 그 자리에서 다시',
            ],
          },
          {
            role: '선생님',
            title: '단어를 붙여넣으면 끝',
            points: [
              '교재 단어를 그대로 복사해 붙여넣기',
              '이미 있는 단어는 만들어둔 Brain Map을 그대로 재사용',
              '학생이 자주 틀리는 단어와 헷갈리는 짝을 확인',
            ],
          },
        ].map((card) => (
          <div key={card.role} className="border-t border-line pt-5">
            <span className="inline-flex rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
              {card.role}
            </span>
            <p className="mt-3 text-lg font-semibold break-keep">{card.title}</p>
            <ul className="mt-4 space-y-2">
              {card.points.map((point) => (
                <li key={point} className="flex gap-2.5 text-sm leading-relaxed break-keep">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" aria-hidden />
                  <span className="text-ink-3">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-5xl px-5 py-20 text-center">
      <h2 className="text-2xl font-semibold tracking-tight break-keep sm:text-3xl">
        오늘 단어부터 시작해 보세요
      </h2>
      <p className="mx-auto mt-3 max-w-md text-ink-3 break-keep">
        선생님이 단어를 배정하면 학생 화면에 오늘 할 학습이 바로 뜹니다.
      </p>
      <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
        <Link href="/login?mode=signup">
          <Button size="lg" className="w-full sm:w-auto sm:px-10">
            시작하기
          </Button>
        </Link>
        <Link href="/login">
          <Button size="lg" variant="secondary" className="w-full sm:w-auto sm:px-10">
            로그인
          </Button>
        </Link>
      </div>
    </section>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-8 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-brand">VOCA BRAIN MAP</span>
        <span>암기는 반복하고, 이해가 필요한 단어는 연결한다.</span>
      </div>
    </footer>
  )
}
