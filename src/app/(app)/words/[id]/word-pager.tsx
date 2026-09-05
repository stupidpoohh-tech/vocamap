'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import type { WordNeighbour } from '@/lib/data/library'

/**
 * The word before and the word after, in the list this page was opened from.
 *
 * Studying a set is working down it, and going back to the list to open the
 * next word is three taps for what is one gesture on a phone. So the page
 * swipes: left for the next word, right for the one before.
 *
 * The links stay on screen anyway. A gesture nobody is told about is a gesture
 * nobody uses, and it is the only thing a mouse or a keyboard has.
 */
export function WordPager({
  prev,
  next,
  query,
}: {
  prev: WordNeighbour | null
  next: WordNeighbour | null
  /** The list context, carried on so the next word knows it too. */
  query: string
}) {
  const router = useRouter()
  const start = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!prev && !next) return

    function onStart(event: TouchEvent) {
      const touch = event.touches[0]
      if (!touch || event.touches.length > 1) {
        start.current = null
        return
      }
      // A map that scrolls sideways owns its own horizontal gestures; taking
      // them would make the map impossible to pan.
      if (inScroller(event.target)) {
        start.current = null
        return
      }
      start.current = { x: touch.clientX, y: touch.clientY }
    }

    function onEnd(event: TouchEvent) {
      const from = start.current
      start.current = null
      const touch = event.changedTouches[0]
      if (!from || !touch) return

      const dx = touch.clientX - from.x
      const dy = touch.clientY - from.y
      // Far enough to be deliberate, and much more sideways than down: a
      // slightly slanted scroll must stay a scroll.
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return

      const target = dx < 0 ? next : prev
      if (target) router.push(`/words/${target.id}${query}`)
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [next, prev, query, router])

  if (!prev && !next) return null

  return (
    <nav className="mt-10 flex items-stretch gap-2 border-t border-line pt-4 text-[0.8125rem]">
      {prev ? (
        <Link
          href={`/words/${prev.id}${query}`}
          // The two words most likely to be opened next, fetched in full when
          // the pager scrolls into view — which is when the student has reached
          // the bottom of this one and is about to move on.
          prefetch
          className="group min-w-0 flex-1 text-left text-ink-3 transition hover:text-ink-2"
        >
          <span className="block text-xs text-ink-3">← 이전</span>
          <span className="mt-0.5 block truncate text-ink-2 group-hover:text-ink">
            {prev.lemma}
          </span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <Link
          href={`/words/${next.id}${query}`}
          prefetch
          className="group min-w-0 flex-1 text-right text-ink-3 transition hover:text-ink-2"
        >
          <span className="block text-xs text-ink-3">다음 →</span>
          <span className="mt-0.5 block truncate text-ink-2 group-hover:text-ink">
            {next.lemma}
          </span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
    </nav>
  )
}

/** True if the touch began inside something that scrolls sideways itself. */
function inScroller(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null
  while (node) {
    if (node.scrollWidth > node.clientWidth + 8) {
      const overflow = getComputedStyle(node).overflowX
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
    node = node.parentElement
  }
  return false
}
