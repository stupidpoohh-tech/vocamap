import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

/**
 * The primitives, rebuilt around three rules that the old set broke.
 *
 *  - Content before chrome. A row of words is a row of words, not fifteen
 *    bordered cards. Separation is spacing and a hairline first, a surface
 *    second, a border third.
 *  - One accent, rationed. The brand colour marks the primary action and the
 *    selected state. It is not a heading colour, not a number colour, and not
 *    the navigation.
 *  - Weight is hierarchy. When every label was semibold, none of them ranked.
 */

/* ─────────────────────────────── actions ─────────────────────────────── */

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-control font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-40',
        size === 'lg' && 'px-5 py-3.5 text-[0.9375rem]',
        size === 'md' && 'px-3.5 py-2 text-sm',
        size === 'sm' && 'px-2.5 py-1.5 text-xs',
        // Exactly one filled button belongs on a screen. Everything else is a
        // step quieter, so the eye never has to choose between two answers.
        variant === 'primary' && 'bg-brand text-white hover:bg-brand/90',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-sunken',
        variant === 'ghost' && 'text-ink-2 hover:bg-sunken hover:text-ink',
        variant === 'danger' && 'border border-bad/25 bg-bad-soft text-bad hover:bg-bad/10',
        className,
      )}
      {...props}
    />
  )
}

/* ─────────────────────────────── surfaces ─────────────────────────────── */

/**
 * A card is an independent unit holding several related elements. A single
 * number does not get one — it gets a line of type.
 */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('card p-4', className)} {...props} />
}

/**
 * A list of like things: hairlines between rows, no box around each one.
 * This replaced fifteen stacked cards, which made the borders the pattern the
 * eye followed instead of the words.
 */
export function Rows({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cn('divide-y divide-line-soft', className)} {...props} />
}

/* ─────────────────────────────── labels ─────────────────────────────── */

/**
 * Secondary information. Small, low chroma, barely tinted — a tag is never the
 * thing you read first.
 */
export function Tag({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-chip px-1.5 py-0.5 text-[0.6875rem] font-medium',
        tone === 'neutral' && 'bg-sunken text-ink-2',
        tone === 'good' && 'bg-good-soft text-good',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'bad' && 'bg-bad-soft text-bad',
        tone === 'brand' && 'bg-brand-soft text-brand',
        className,
      )}
      {...props}
    />
  )
}

/** Kept for callers that still say Badge; identical to Tag. */
export const Badge = Tag

/** A section heading inside a screen. Neutral — headings are not accents. */
export function SectionTitle({
  children,
  aside,
  className,
}: {
  children: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-2.5 flex items-baseline justify-between gap-3', className)}>
      <h2 className="text-[0.8125rem] font-medium text-ink-2">{children}</h2>
      {aside ? <div className="shrink-0 text-xs text-ink-3">{aside}</div> : null}
    </div>
  )
}

/**
 * A number and the context that qualifies it, at two different sizes.
 * Showing "28" and "/ 245" at one size makes the reader do the ranking.
 */
export function Stat({
  value,
  unit,
  label,
  emphasis = false,
}: {
  value: ReactNode
  unit?: string
  label: string
  emphasis?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-0.5">
        <span
          className={cn(
            'numeral text-[1.375rem] font-semibold leading-none',
            emphasis ? 'text-ink' : 'text-ink-2',
          )}
        >
          {value}
        </span>
        {unit ? <span className="text-xs text-ink-3">{unit}</span> : null}
      </p>
    </div>
  )
}

/* ─────────────────────────────── inputs ─────────────────────────────── */

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[0.9375rem]',
        'placeholder:text-ink-3 focus:border-brand-line focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[0.9375rem] leading-relaxed',
        'placeholder:text-ink-3 focus:border-brand-line focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

/* ─────────────────────────────── structure ─────────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.5rem] font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-3">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm text-ink-2">{title}</p>
      {hint ? (
        <p className="mx-auto mt-1.5 max-w-xs text-[0.8125rem] leading-relaxed text-ink-3 break-keep">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Text tabs with an underline.
 *
 * These used to be rounded buttons inside a rounded, filled track — a pill
 * holding pills — which made choosing a list look heavier than reading it.
 * The rule is the same either way: which list you are on is a property of the
 * URL, so these are links and survive a reload.
 */
export function TabBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 border-b border-line', className)}>
      <div className="-mb-px flex gap-5 overflow-x-auto">{children}</div>
    </div>
  )
}

export function TabLink({
  href,
  active,
  count,
  children,
}: {
  href: string
  active: boolean
  count?: number
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'whitespace-nowrap border-b-2 pb-2.5 text-sm transition',
        // Colour and an indicator. Not colour, weight, fill and an indicator.
        active
          ? 'border-brand text-ink'
          : 'border-transparent text-ink-3 hover:text-ink-2',
      )}
    >
      {children}
      {typeof count === 'number' ? (
        <span className="numeral ml-1.5 text-xs text-ink-3">{count}</span>
      ) : null}
    </Link>
  )
}

export function Pager({
  page,
  pageCount,
  total,
  href,
}: {
  /** 0-based. */
  page: number
  pageCount: number
  total: number
  href: (page: number) => string
}) {
  if (pageCount <= 1) return null

  return (
    <nav className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3" aria-label="페이지">
      <PagerLink href={href(page - 1)} disabled={page === 0}>
        이전
      </PagerLink>
      <span className="numeral text-xs text-ink-3">
        {page + 1} / {pageCount} · 전체 {total}
      </span>
      <PagerLink href={href(page + 1)} disabled={page >= pageCount - 1}>
        다음
      </PagerLink>
    </nav>
  )
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string
  disabled: boolean
  children: ReactNode
}) {
  const className = cn(
    'rounded-chip px-2 py-1 text-xs transition',
    disabled ? 'cursor-not-allowed text-ink-3/50' : 'text-ink-2 hover:bg-sunken hover:text-ink',
  )
  if (disabled) {
    return (
      <span aria-disabled className={className}>
        {children}
      </span>
    )
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}
