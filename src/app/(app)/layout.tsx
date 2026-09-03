import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'
import { signOut } from '@/app/login/actions'
import { BottomNav, NavShell } from './nav'

/**
 * The app shell.
 *
 * Deliberately not an async component. It used to await the session before
 * returning any markup, which meant the frame — and the loading skeleton of
 * whatever page was opening — waited on a database round trip before a single
 * pixel could paint. The shell is synchronous and the two pieces that need to
 * know who you are stream in behind it.
 *
 * Visually it is as quiet as it can be: a hairline under a wordmark, and a
 * hairline over the navigation. Chrome should be the last thing you notice.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/92 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <Link
            href="/study"
            className="text-[0.8125rem] font-medium tracking-[0.14em] text-ink-2 uppercase"
          >
            Voca Brain Map
          </Link>
          <div className="flex items-center gap-3 text-[0.8125rem]">
            <Suspense fallback={null}>
              <UserName />
            </Suspense>
            <form action={signOut}>
              <button className="text-ink-3 transition hover:text-ink-2">로그아웃</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 pb-24 pt-4 sm:pt-7">{children}</main>

      <NavShell>
        <Suspense fallback={<BottomNav links={STUDENT_LINKS} />}>
          <Navigation />
        </Suspense>
      </NavShell>
    </div>
  )
}

/**
 * Three destinations for a student, and they are the three things this app is:
 * the word list you test yourself on, the words you kept or got wrong, and the
 * handful of words that have a Brain Map.
 */
const STUDENT_LINKS = [
  { href: '/study', label: '단어' },
  { href: '/vault', label: '보관함' },
  { href: '/map', label: '맵' },
]

async function UserName() {
  const actor = await getActor()
  if (!actor) return null
  return <span className="hidden text-ink-3 sm:inline">{actor.displayName}</span>
}

async function Navigation() {
  const actor = await getActor()
  // The guard still lives in the shell, so a signed-out request never renders
  // an app screen — middleware turns most of those away before this runs, and
  // every page under here also calls `requireActor`.
  if (!actor) redirect('/login')

  // Curation is a teacher's job as much as an admin's — the review page and
  // every action behind it accept both — so the links must follow suit.
  const links =
    actor.role === 'student'
      ? STUDENT_LINKS
      : [...STUDENT_LINKS, { href: '/teacher', label: '교사' }, { href: '/admin', label: '검수' }]

  return <BottomNav links={links} />
}
