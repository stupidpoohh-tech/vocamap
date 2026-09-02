import { SkeletonLine } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex min-h-[70dvh] flex-col" role="status" aria-label="문제를 준비하고 있어요">
      <SkeletonLine className="mb-6 h-1.5 w-full" />
      <div className="card mb-6 flex min-h-36 items-center justify-center">
        <SkeletonLine className="h-6 w-40" />
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonLine key={i} className="h-14 w-full rounded-xl opacity-50" />
        ))}
      </div>
    </div>
  )
}
