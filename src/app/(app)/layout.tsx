import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'
import { signOut } from '@/app/login/actions'

/**
 * The app shell.
 *
 * Deliberately not an async component. It used to await the session before
 * returning any markup, which meant the whole frame — and the loading skeleton
 * of whatever page was being opened — waited on a database round trip before a
 * single pixel could paint. The shell is now synchronous and the two pieces
 * that actually need to know who you are stream in behind it, so a tap paints
 * immediately and the page's own data fetch starts in the same tick.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link href="/study" className="text-sm font-bold tracking-wide text-brand">
            VOCA BRAIN MAP
          </Link>
          <div className="flex items-center gap-3">
            <Suspense fallback={null}>
              <UserName />
            </Suspense>
            <form action={signOut}>
              <button className="text-sm text-muted hover:text-ink">로그아웃</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-28 pt-6">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl">
          {/* The three student destinations are the same for everyone, so they
              render without waiting; only the curator's two need the role. */}
          {STUDENT_LINKS.map((link) => (
            <NavLink key={link.href} {...link} />
          ))}
          <Suspense fallback={null}>
            <CuratorLinks />
          </Suspense>
        </div>
      </nav>
    </div>
  )
}

/**
 * Three destinations for a student, and they are the three things this app is:
 * the word list you test yourself on, the words you kept or got wrong, and the
 * handful of words that have a Brain Map.
 */
const STUDENT_LINKS = [
  { href: '/study', label: '단어', icon: '⌕' },
  { href: '/vault', label: '보관함', icon: '★' },
  { href: '/map', label: '맵', icon: '◎' },
]

async function UserName() {
  const actor = await getActor()
  if (!actor) return null
  return <span className="hidden text-sm text-muted sm:inline">{actor.displayName}</span>
}

async function CuratorLinks() {
  const actor = await getActor()
  // The guard still lives in the shell, so a signed-out request never renders
  // an app screen — every page under here also calls `requireActor`.
  if (!actor) redirect('/login')
  if (actor.role === 'student') return null

  // Curation is a teacher's job as much as an admin's — the review page and
  // every action behind it accept both — so the links must follow suit. Hiding
  // them from teachers left an account that could approve drafts with no way to
  // reach the screen that approves them.
  return (
    <>
      <NavLink href="/teacher" label="교사" icon="☰" />
      <NavLink href="/admin" label="검수" icon="✓" />
    </>
  )
}

function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <Link
      href={href}
      className="flex flex-1 flex-col items-center gap-0.5 py-3 text-xs font-medium text-muted hover:text-brand"
    >
      <span aria-hidden className="text-base leading-none">
        {icon}
      </span>
      {label}
    </Link>
  )
}
