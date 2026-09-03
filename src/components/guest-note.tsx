import Link from 'next/link'

/**
 * Said once, quietly, where it matters.
 *
 * A guest can read every word and every map, and can work through the
 * questions — none of it is recorded, because there is no account to record it
 * against. That is worth saying plainly on the two screens where a reader would
 * otherwise assume their effort was being kept, and worth saying nowhere else:
 * a banner on every screen is the sign-in wall this app just removed, wearing a
 * different hat.
 */
export function GuestNote({ next, children }: { next: string; children: React.ReactNode }) {
  return (
    <p className="mb-5 text-[0.8125rem] text-ink-3 break-keep">
      {children}{' '}
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className="text-brand underline-offset-2 hover:underline"
      >
        로그인
      </Link>
    </p>
  )
}
