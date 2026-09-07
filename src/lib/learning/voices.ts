/**
 * Choosing the voice that says an English word.
 *
 * Pure — it takes the list a browser hands over and returns one of them — so
 * the rule is testable, which matters here more than usual: the bug it fixes
 * is one you can only hear, and the machine running the tests has no voices at
 * all.
 *
 * `SpeechSynthesisUtterance.lang` states what language the text is in. It does
 * not choose the voice, and browsers are free to use the default one anyway —
 * which on a Korean phone is a Korean voice. Every English word in the app was
 * being read with Korean sounds, and the engine was doing exactly what it had
 * been asked.
 */

/** Just enough of `SpeechSynthesisVoice` to choose between them. */
export type VoiceLike = { lang: string; name?: string }

export type VoiceChoice<V extends VoiceLike> =
  /** The browser has not published its voices yet. Ask again on `voiceschanged`. */
  | { state: 'loading' }
  /** A voice that will say English as English. */
  | { state: 'found'; voice: V }
  /** The device has voices and none of them speak English. */
  | { state: 'none' }

const tag = (voice: VoiceLike) => voice.lang.replace('_', '-').toLowerCase()

/**
 * The best English voice among the ones installed.
 *
 * General American first, because that is what the material is written in;
 * then British; then any other English, which is still an English voice.
 *
 * An empty list is not "no English voice". `getVoices()` commonly returns
 * nothing on the first call and fills in later, and a browser that never
 * publishes a list can still speak — so the two are answered differently, and
 * only a device that has voices and no English one is told so.
 */
export function pickEnglishVoice<V extends VoiceLike>(voices: readonly V[]): VoiceChoice<V> {
  if (!voices.length) return { state: 'loading' }

  const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang))
  if (!english.length) return { state: 'none' }

  const exactly = (wanted: string) => english.find((voice) => tag(voice) === wanted)
  const voice = exactly('en-us') ?? exactly('en-gb') ?? english[0]!
  return { state: 'found', voice }
}
