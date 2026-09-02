import { cn } from '@/lib/utils'

/**
 * Placeholders shown while a screen's data is on its way.
 *
 * The database sits behind an edge proxy, so a server render is never instant.
 * Without a boundary the browser held the *old* page until the new one was
 * ready, and a tap that changes nothing for half a second reads as a broken
 * app rather than a slow one. This is the cheapest fix for that by a wide
 * margin: nothing here waits on data.
 */
export function SkeletonLine({ className }: { className?: string }) {
  return <span className={cn('block h-3 animate-pulse rounded-full bg-line', className)} />
}

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="card flex items-center gap-3 px-4 py-3.5">
          <span className="min-w-0 flex-1">
            <SkeletonLine className="w-28" />
            <SkeletonLine className="mt-2 w-20 opacity-60" />
          </span>
          <SkeletonLine className="h-6 w-10 rounded-full" />
        </li>
      ))}
    </ul>
  )
}

export function SkeletonHeader() {
  return (
    <div className="mb-6" aria-hidden>
      <SkeletonLine className="h-6 w-24" />
      <SkeletonLine className="mt-2 w-48 opacity-60" />
    </div>
  )
}

export function SkeletonScreen({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-rise" role="status" aria-label="불러오는 중">
      <SkeletonHeader />
      <SkeletonLine className="mb-5 h-12 w-full rounded-card opacity-40" />
      <SkeletonRows count={rows} />
    </div>
  )
}
