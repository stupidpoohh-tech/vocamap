import { SkeletonLine, SkeletonRows } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="animate-rise" role="status" aria-label="불러오는 중">
      <SkeletonLine className="w-16" />
      <SkeletonLine className="mt-4 h-8 w-40" />
      <SkeletonLine className="mt-2 w-24 opacity-60" />
      {/* Reserves the constellation's box so the page does not jump when the
          map arrives. */}
      <div className="mt-8 hidden aspect-[16/10] w-full animate-pulse rounded-2xl bg-line/40 sm:block" />
      <div className="mt-8 sm:hidden">
        <SkeletonRows count={4} />
      </div>
    </div>
  )
}
