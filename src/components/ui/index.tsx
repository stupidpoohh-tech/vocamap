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
