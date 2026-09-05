'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Bottom navigation.
 *
 * A floating bar rather than a strip welded to the bottom edge: the page
 * scrolls under it, which is what makes the screen read as one surface with a
 * control resting on it instead of two panes stacked.
 *
 * The icons are one family — 24px, 1.6 stroke, round caps, no fills — and each
 * carries its label, because a glyph alone is a guess and five Korean labels
 * alone are a wall of text at this size. The selected tab is marked in the
 * brand colour and nothing else: navigation belongs a step behind the content,
 * and an active state that also grows, fills and underlines breaks that.
 */
export function BottomNav({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname()

  return (
    <div className="mx-auto flex max-w-md items-stretch justify-between gap-1 px-2">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
        const Icon = ICON[link.label] ?? ICON['단어']!
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 rounded-container py-1.5 transition sm:gap-1 sm:py-2.5',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            <Icon />
            <span className={cn('text-[0.6875rem]', active ? 'font-semibold' : undefined)}>
              {link.label}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

/**
 * The fixed bottom chrome: the tab bar, and the credit line under it.
 *
 * One container rather than two fixed elements stacked, so the strip has a
 * single height the page can be padded against — and so the credit cannot end
 * up behind the bar it is supposed to sit below.
 *
 * `children` is the bar itself, which streams in once the reader's role is
 * known; the shape is the same either way, so the frame does not shift.
 */
export function NavShell({
  children,
  footer,
}: {
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 px-4 pb-1 sm:pb-2">
      {/* Ground under the strip.
          The bar is a pill with air around it, and the credit line beneath it
          has no fill at all, so a scrolling page used to run straight through
          both. This fades the page out before it reaches them — content
          dissolves into the ground rather than colliding with the chrome. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 bottom-0"
        style={{
          background: 'linear-gradient(to bottom, transparent 0%, var(--color-paper) 42%)',
        }}
      />
      <nav className="relative mx-auto max-w-md rounded-panel bg-surface/80 shadow-float ring-1 ring-line/80 backdrop-blur-xl">
        {children}
      </nav>
      {footer ? <div className="relative">{footer}</div> : null}
    </div>
  )
}

/* ─────────────────────────────────── icons ─────────────────────────────────── */

/**
 * One family, drawn here rather than pulled from a set.
 *
 * A dependency would bring several hundred glyphs to use five of, in whatever
 * proportions its author chose. These five share a stroke, a cap and a grid, so
 * the row reads as one control.
 */
function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 sm:h-[1.375rem] sm:w-[1.375rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** An open book — the list of words you test yourself on. */
const BookIcon = () => (
  <Svg>
    <path d="M12 6.5C10.5 5.2 8.6 4.6 6 4.6H4v13h2c2.6 0 4.5.6 6 1.9 1.5-1.3 3.4-1.9 6-1.9h2v-13h-2c-2.6 0-4.5.6-6 1.9Z" />
    <path d="M12 6.5v12.9" />
  </Svg>
)

/**
 * A clock turning back — the forgetting curve, and the words it brings round
 * again. A bookmark used to sit here, from when this tab was a saved list.
 */
const ReviseIcon = () => (
  <Svg>
    <path d="M4.6 10.2A7.6 7.6 0 1 1 4.5 14" />
    <path d="M4.4 5.6v4.6H9" />
    <path d="M12 8.6V12l2.4 1.6" />
  </Svg>
)

/** A mortarboard — the teacher's own screens. */
const TeacherIcon = () => (
  <Svg>
    <path d="M12 4.5 2.5 9 12 13.5 21.5 9 12 4.5Z" />
    <path d="M6.5 11v4.6c0 .5.3 1 .8 1.2 1.3.7 2.9 1.2 4.7 1.2s3.4-.5 4.7-1.2c.5-.2.8-.7.8-1.2V11" />
  </Svg>
)

/** A ticked box — review, where a draft is accepted or sent back. */
const ReviewIcon = () => (
  <Svg>
    <rect x="4" y="4" width="16" height="16" rx="3.2" />
    <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
  </Svg>
)

const ICON: Record<string, () => React.ReactElement> = {
  단어: BookIcon,
  복습: ReviseIcon,
  교사: TeacherIcon,
  검수: ReviewIcon,
}
