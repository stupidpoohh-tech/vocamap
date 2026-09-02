import { SkeletonLine, SkeletonRows } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="animate-rise" role="status" aria-label="불러오는 중">
      <SkeletonLine className="w-16" />
      <SkeletonLine className="mt-4 h-8 w-32" />
      <SkeletonLine className="mt-2 w-56 opacity-60" />
      <div className="mt-8">
        <SkeletonRows count={5} />
      </div>
    </div>
  )
}
