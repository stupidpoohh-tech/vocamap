'use client'

import { useEffect, useState } from 'react'
import { pickEnglishVoice, type VoiceChoice } from '@/lib/learning/voices'
import { cn } from '@/lib/utils'

/**
 * Says the word out loud.
 *
 * Uses the browser's own speech synthesis rather than an audio service: it
 * costs nothing, needs no network round trip, and works for every word in the
 * library including ones nobody has recorded. The voice is whichever English
 * one the student's phone already has — chosen explicitly, because the default
 * on a Korean device is a Korean voice. See `useEnglishVoice`.
 *
 * Hidden entirely where the browser cannot speak — an inert speaker icon is
 * worse than no speaker icon.
 */
/**
 * The English voice this device will use, and whether it has one at all.
 *
 * The rule for choosing lives in `pickEnglishVoice`, which is pure and tested;
 * this is the part that has to watch the browser publish its list, since
 * `getVoices()` is commonly empty on the first call.
 */
function useEnglishVoice(): VoiceChoice<SpeechSynthesisVoice> {
  const [choice, setChoice] = useState<VoiceChoice<SpeechSynthesisVoice>>({ state: 'loading' })

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const synth = window.speechSynthesis

    const choose = () => setChoice(pickEnglishVoice(synth.getVoices()))
    choose()
    synth.addEventListener?.('voiceschanged', choose)
    return () => synth.removeEventListener?.('voiceschanged', choose)
  }, [])

  return choice
}

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
  const voice = useEnglishVoice()

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

  // Hidden where the browser cannot speak, and equally where it can speak but
  // not in English: a speaker button that says 스트렝쓰 is worse than no
  // speaker button, which is the same reason the inert one is not drawn. An
  // empty voice list is not that case — it is a list that has not arrived —
  // so the button stays and the utterance goes out with its language named.
  if (!supported || voice.state === 'none') return null

  const speak = (event: React.MouseEvent) => {
    // The button lives inside rows that are themselves links.
    event.preventDefault()
    event.stopPropagation()

    const synth = window.speechSynthesis
    synth.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    // Naming the language is not choosing a voice. On a Korean phone the
    // default voice is Korean, and a Korean voice handed English text reads it
    // with Korean sounds — "strength" comes out as 스트렝쓰. The engine is
    // doing what it was asked; it was never asked for an English voice. See
    // `pickEnglishVoice`.
    if (voice.state === 'found') utterance.voice = voice.voice
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
