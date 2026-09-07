import { describe, expect, it } from 'vitest'
import { pickEnglishVoice } from '@/lib/learning/voices'

const voice = (lang: string, name = lang) => ({ lang, name })

describe('choosing a voice for an English word', () => {
  it('does not read English with the phone default when that is Korean', () => {
    // The whole bug: naming the language and letting the browser pick.
    const chosen = pickEnglishVoice([voice('ko-KR', 'Yuna'), voice('en-US', 'Samantha')])
    expect(chosen).toEqual({ state: 'found', voice: voice('en-US', 'Samantha') })
  })

  it('prefers General American, then British, then any English', () => {
    expect(
      pickEnglishVoice([voice('en-AU'), voice('en-GB'), voice('en-US')]),
    ).toMatchObject({ voice: voice('en-US') })
    expect(pickEnglishVoice([voice('en-AU'), voice('en-GB')])).toMatchObject({
      voice: voice('en-GB'),
    })
    expect(pickEnglishVoice([voice('en-IN'), voice('en-ZA')])).toMatchObject({
      voice: voice('en-IN'),
    })
  })

  it('reads en_US as en-US, which some engines write', () => {
    expect(pickEnglishVoice([voice('en_GB'), voice('en_US')])).toMatchObject({
      voice: voice('en_US'),
    })
  })

  it('is not fooled by a language that merely starts with those letters', () => {
    expect(pickEnglishVoice([voice('eng-x'), voice('en-US')])).toMatchObject({
      voice: voice('en-US'),
    })
    expect(pickEnglishVoice([voice('eng-x')])).toEqual({ state: 'none' })
  })

  it('tells an empty list apart from a list with no English in it', () => {
    // `getVoices()` is commonly empty on the first call and fills in later, so
    // an empty list means "not yet", never "this device cannot say English".
    expect(pickEnglishVoice([])).toEqual({ state: 'loading' })
    expect(pickEnglishVoice([voice('ko-KR'), voice('ja-JP')])).toEqual({ state: 'none' })
  })
})
