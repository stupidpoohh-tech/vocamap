import { redirect } from 'next/navigation'

/**
 * The 맵 tab, folded into the study book.
 *
 * Having a map is a property of a word, and every word row already says which
 * words have one — so a screen listing the same sets and the same words with
 * the unmapped ones hidden was this screen wearing a different name. It is a
 * filter inside the set now.
 *
 * Kept as a redirect because the links are already out there: a bookmark, the
 * "← 맵" that used to sit on every word page, a message to a student.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; set?: string }>
}) {
  const { tab, q, set } = await searchParams

  // The curator queues were never about one set — they are the map pipeline,
  // and that lives in 검수 now.
  if (tab === 'pending') redirect('/admin')
  if (tab === 'missing') redirect('/admin?tab=missing')
  // "저장한 맵" was the star, which has its own tab in the study book.
  if (tab === 'saved') redirect('/study?tab=saved')

  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (set) {
    params.set('set', set)
    params.set('view', 'map')
  }
  const rest = params.toString()
  redirect(rest ? `/study?${rest}` : '/study')
}
