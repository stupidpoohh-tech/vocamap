'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Bottom navigation.
 *
 * Text only. The old bar mixed four unrelated glyphs — a magnifier, a star, a
 * ring, a tick — which is four icon families, and none of them said anything
 * the word beneath it did not. Three or five short Korean labels read faster
 * than icons anyway.
 *
 * The selected tab is marked with colour and a hairline above it. Not colour
 * and weight and a fill and an underline: navigation belongs a step behind the
 * content, and an active state that shouts is the fastest way to break that.
 */
export function BottomNav({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname()

  return (
    <div className="mx-auto flex max-w-2xl">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className="relative flex flex-1 justify-center py-3.5 text-[0.8125rem]"
          >
            <span className={active ? 'font-medium text-ink' : 'text-ink-3'}>{link.label}</span>
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 mx-auto h-px w-8 bg-brand"
              />
            ) : null}
          </Link>
        )
      })}
    </div>
  )
}

/** Same shape as the real bar, so the frame does not shift when roles arrive. */
export function NavShell({ children }: { children: React.ReactNode }) {
  return (
    <nav className={cn('fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/92 backdrop-blur')}>
      {children}
    </nav>
  )
}
