import Link from 'next/link'
import { BottomNav, NavShell } from './nav'
import { SiteFooter } from '@/components/site-footer'

/**
 * The app shell.
 *
 * 두 조각이 사라졌다. 오른쪽 위의 이름과 로그아웃, 그리고 역할에 따라 달라지던
 * 아래 탭 — 둘 다 "당신이 누구인가"를 서버에 물어야 알 수 있는 것이었고, 그
 * 질문 하나 때문에 이 레이아웃 아래의 모든 화면이 요청마다 다시 그려졌다.
 * `Suspense` 로 뒤에 흘려 보내도 그 사실은 바뀌지 않는다: 쿠키를 읽는 화면은
 * 미리 구워질 수 없다.
 *
 * 그래서 이 껍데기에는 사람이 없다. 단어와 복습, 둘 다 모두에게 같은 것이고
 * 개인 기록은 브라우저가 자기 것을 얹는다.
 *
 * 보이는 것은 되도록 조용하게: 워드마크 아래 머리카락 한 올, 탭 위에 한 올.
 * 틀은 가장 늦게 눈에 띄어야 하는 것이다.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line-soft bg-paper/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          {/* Ink, not accent. A wordmark is the one thing on a screen that
              never needs colour to be found — it is always in the same corner —
              and painting it the accent spends the product's one loud colour on
              the least urgent thing on the page. */}
          <Link
            href="/study"
            className="text-[0.75rem] font-semibold tracking-[0.16em] text-ink uppercase"
          >
            Voca Brain Map
          </Link>
        </div>
      </header>

      {/* Reading width by default. A page that lays itself out in columns says
          so with `data-wide`, and gets the room to do it — but only once the
          screen is big enough that the columns are worth having. Bottom padding
          clears the fixed bottom strip — the tab bar and the credit line
          beneath it — which the page scrolls under rather than stopping
          above. */}
      <main className="mx-auto w-full max-w-2xl px-5 pt-4 pb-28 sm:pt-7 min-[1120px]:has-[[data-wide]]:max-w-[74rem] min-[1120px]:has-[[data-wide]]:px-8">
        {children}
      </main>

      <NavShell footer={<SiteFooter />}>
        <BottomNav links={STUDENT_LINKS} />
      </NavShell>
    </div>
  )
}

/**
 * Two destinations: the material, and the schedule that brings it back before
 * it is forgotten.
 *
 * The maps had a tab of their own until the word rows started marking which
 * words have one. At that point the 맵 tab was this same shelf and these same
 * words with the unmapped ones hidden — a filter, not a place — so it became
 * one, inside the set where the words already are.
 *
 * 교사·검수 탭은 없다. 그 화면들은 데이터베이스와 함께 사라졌다.
 */
const STUDENT_LINKS = [
  { href: '/study', label: '단어' },
  { href: '/vault', label: '복습' },
]
