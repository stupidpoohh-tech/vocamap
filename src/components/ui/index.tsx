import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'lg'
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'lg' ? 'px-6 py-4 text-base' : 'px-4 py-2.5 text-sm',
        variant === 'primary' && 'bg-brand text-white hover:opacity-90 active:scale-[0.99]',
        variant === 'secondary' &&
          'border border-line bg-surface text-ink hover:bg-brand-soft active:scale-[0.99]',
        variant === 'ghost' && 'text-muted hover:bg-brand-soft hover:text-ink',
        variant === 'danger' && 'bg-bad text-white hover:opacity-90',
        className,
      )}
      {...props}
    />
  )
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('card p-5', className)} {...props} />
}

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold',
        tone === 'neutral' && 'bg-line/50 text-muted',
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

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-line bg-surface px-4 py-3 text-base',
        'placeholder:text-muted/60 focus:border-brand focus:outline-none',
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
        'w-full rounded-xl border border-line bg-surface px-4 py-3 text-base',
        'placeholder:text-muted/60 focus:border-brand focus:outline-none',
        className,
      )}
      {...props}
    />
  )
}

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
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-semibold">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-muted">{hint}</p> : null}
    </div>
  )
}

/**
 * Link-based tabs. Server-rendered on purpose: which list you are looking at is
 * a property of the URL, so it survives a reload and can be linked to.
 */
export function TabBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-5 flex gap-1 overflow-x-auto rounded-xl bg-line/40 p-1', className)}>
      {children}
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
      className={cn(
        'flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm font-semibold transition',
        active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
      )}
    >
      {children}
      {typeof count === 'number' ? (
        <span className="ml-1.5 text-xs font-medium tabular-nums opacity-70">{count}</span>
      ) : null}
    </Link>
  )
}

/**
 * Page links for a list.
 *
 * Server-rendered links rather than a client control: which page you are on is
 * a property of the URL, so it survives a reload, and the list stays a plain
 * server render with nothing to hydrate.
 */
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
  /** Builds the URL for a page index. */
  href: (page: number) => string
}) {
  if (pageCount <= 1) return null

  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="페이지">
      <PagerLink href={href(page - 1)} disabled={page === 0}>
        ← 이전
      </PagerLink>
      <span className="text-xs text-muted tabular-nums">
        {page + 1} / {pageCount}
        <span className="ml-1.5">· 전체 {total}개</span>
      </span>
      <PagerLink href={href(page + 1)} disabled={page >= pageCount - 1}>
        다음 →
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
    'rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
    disabled
      ? 'cursor-not-allowed border-line text-muted opacity-50'
      : 'border-line text-ink hover:border-brand hover:text-brand',
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
