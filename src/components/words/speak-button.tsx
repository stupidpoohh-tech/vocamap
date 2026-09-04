'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Says the word out loud.
 *
 * Uses the browser's own speech synthesis rather than an audio service: it
 * costs nothing, needs no network round trip, and works for every word in the
 * library including ones nobody has recorded. The voice is whatever the
 * student's phone already speaks English with, which on a Korean device is the
 * same voice their other apps use.
 *
 * Hidden entirely where the browser cannot speak — an inert speaker icon is
 * worse than no speaker icon.
 */
export function SpeakButton({
  text,
  size = 'sm',
  className,
}: {
  text: string
  size?: 'sm' | 'lg'
  className?: string
}) {
  // Support is read after mount: on the server, and during hydration, there is
  // no `speechSynthesis` to ask.
  const [supported, setSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window)
  }, [])

  useEffect(() => {
    // Leaving a page mid-word would otherwise keep talking over the next one.
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  if (!supported) return null

  const speak = (event: React.MouseEvent) => {
    // The button lives inside rows that are themselves links.
    event.preventDefault()
    event.stopPropagation()

    const synth = window.speechSynthesis
    synth.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    // A shade under natural pace: this is a word being learned, not read.
    utterance.rate = 0.9
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)

    setSpeaking(true)
    synth.speak(utterance)
  }

  return (
    <button
      type="button"
      onClick={speak}
      aria-label={`${text} 발음 듣기`}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-chip transition',
        size === 'lg' ? 'h-9 w-9 ring-1 ring-line hover:ring-ink-3/40' : 'h-8 w-8',
        speaking ? 'text-brand' : 'text-ink-3 hover:text-ink-2',
        className,
      )}
    >
      {/* The navigation's icon family — 24px grid, 1.6 stroke, round caps. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={size === 'lg' ? 'h-[1.125rem] w-[1.125rem]' : 'h-4 w-4'}
        aria-hidden
      >
        <path d="M11 5.5 6.8 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.8L11 18.5V5.5Z" />
        <path d="M15.4 9.2a4 4 0 0 1 0 5.6" />
        {/* The outer wave only at the larger size — at 16px it closes up into a
            smudge and stops reading as sound. */}
        {size === 'lg' ? <path d="M18.2 6.4a8 8 0 0 1 0 11.2" /> : null}
      </svg>
    </button>
  )
}
