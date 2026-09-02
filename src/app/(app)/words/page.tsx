import { redirect } from 'next/navigation'

/**
 * The old library lives on as the study book at /study, which is where the
 * search, the set filter and the star all moved. Kept as a redirect so links
 * already handed out — and the "← 단어" on every word page — still land
 * somewhere useful.
 */
export default async function WordsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; set?: string; only?: string }>
}) {
  const { q, set, only } = await searchParams
  if (only === 'bookmarked') redirect('/vault')

  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (set) params.set('set', set)
  const rest = params.toString()
  redirect(rest ? `/study?${rest}` : '/study')
}
