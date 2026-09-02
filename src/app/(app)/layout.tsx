import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getActor } from '@/lib/auth/session'
import { signOut } from '@/app/login/actions'

/**
 * Bottom navigation on mobile, a slim top bar on desktop.
 *
 * Three destinations for a student, and they are the three things this app is:
 * the word list you test yourself on, the words you kept or got wrong, and the
 * handful of words that have a Brain Map. Anything else is a teacher's screen.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor()
  if (!actor) redirect('/login')

  const links = [
    { href: '/study', label: '단어', icon: '⌕' },
    { href: '/vault', label: '보관함', icon: '★' },
    { href: '/map', label: '맵', icon: '◎' },
    // Curation is a teacher's job as much as an admin's — the review page and
    // every action behind it accept both — so the link must follow suit.
    // Hiding it from teachers left an account that could approve drafts with no
    // way to reach the screen that approves them.
    ...(actor.role === 'student'
      ? []
      : [
          { href: '/teacher', label: '교사', icon: '☰' },
          { href: '/admin', label: '검수', icon: '✓' },
        ]),
  ]

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link href="/study" className="text-sm font-bold tracking-wide text-brand">
            VOCA BRAIN MAP
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{actor.displayName}</span>
            <form action={signOut}>
              <button className="text-sm text-muted hover:text-ink">로그아웃</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-28 pt-6">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex flex-1 flex-col items-center gap-0.5 py-3 text-xs font-medium text-muted hover:text-brand"
            >
              <span aria-hidden className="text-base leading-none">
                {link.icon}
              </span>
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}
