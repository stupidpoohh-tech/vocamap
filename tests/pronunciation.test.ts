import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { vocabularies } from '@/lib/db/schema'
import { MockProvider, cleanIpa, setLLMProvider } from '@/lib/ai'
import { countMissingPronunciation, fillPronunciations } from '@/lib/data/pronunciation'
import { findOrCreateVocabulary } from '@/lib/data/vocabulary'
import { createUser, hasDatabase, resetDatabase } from './helpers/db'

/**
 * The phonetics the wordbooks did not print.
 *
 * What matters is not that a model was called but that the answers land on the
 * right words: a batch reply that drops or reorders an entry must not give one
 * word another's pronunciation.
 */
describe.skipIf(!hasDatabase)('filling in pronunciation', () => {
  beforeEach(async () => {
    await resetDatabase()
    setLLMProvider(null)
  })

  async function words(teacherId: string, lemmas: string[]) {
    const ids: Record<string, string> = {}
    for (const lemma of lemmas) {
      const { id } = await findOrCreateVocabulary({
        lemma,
        translations: [`${lemma} 뜻`],
        createdBy: teacherId,
      })
      ids[lemma] = id
    }
    return ids
  }

  function answering(entries: Array<{ lemma: string; ipa: string }>) {
    const provider = new MockProvider()
    provider.register('transcribe', { entries })
    setLLMProvider(provider)
  }

  const ipaOf = async (id: string) =>
    (await db.select().from(vocabularies).where(eq(vocabularies.id, id)))[0]?.pronunciation

  it('writes each transcription onto its own word', async () => {
    const teacher = await createUser('teacher')
    const ids = await words(teacher.id, ['aspire', 'assert'])
    answering([
      { lemma: 'aspire', ipa: 'əˈspaɪər' },
      { lemma: 'assert', ipa: 'əˈsɜːrt' },
    ])

    const result = await fillPronunciations()
    expect(result.filled).toBe(2)
    expect(await ipaOf(ids.aspire!)).toBe('əˈspaɪər')
    expect(await ipaOf(ids.assert!)).toBe('əˈsɜːrt')
  })

  it('matches on the word, not on position', async () => {
    // The list goes out alphabetically; a reply that comes back in another
    // order would hand `assert` the sound of `aspire`.
    const teacher = await createUser('teacher')
    const ids = await words(teacher.id, ['aspire', 'assert'])
    answering([
      { lemma: 'assert', ipa: 'əˈsɜːrt' },
      { lemma: 'aspire', ipa: 'əˈspaɪər' },
    ])

    await fillPronunciations()
    expect(await ipaOf(ids.aspire!)).toBe('əˈspaɪər')
    expect(await ipaOf(ids.assert!)).toBe('əˈsɜːrt')
  })

  it('leaves a word blank when the reply skipped it', async () => {
    const teacher = await createUser('teacher')
    const ids = await words(teacher.id, ['aspire', 'assert'])
    answering([{ lemma: 'aspire', ipa: 'əˈspaɪər' }])

    const result = await fillPronunciations()
    expect(result.filled).toBe(1)
    expect(result.remaining).toBe(1)
    expect(await ipaOf(ids.assert!)).toBeNull()
  })

  it('never overwrites one the tutor typed in from the book', async () => {
    const teacher = await createUser('teacher')
    const { id } = await findOrCreateVocabulary({
      lemma: 'govern',
      translations: ['다스리다'],
      pronunciation: 'ˈɡʌvərn',
      createdBy: teacher.id,
    })
    answering([{ lemma: 'govern', ipa: 'WRONG' }])

    // It is not even offered: the batch only ever picks up blanks.
    expect(await countMissingPronunciation()).toBe(0)
    const result = await fillPronunciations()
    expect(result.attempted).toBe(0)
    expect(await ipaOf(id)).toBe('ˈɡʌvərn')
  })

  it('counts what is still missing so the tutor knows to press again', async () => {
    const teacher = await createUser('teacher')
    await words(teacher.id, ['alpha', 'beta', 'gamma'])
    answering([{ lemma: 'alpha', ipa: 'ˈælfə' }])

    const result = await fillPronunciations({ limit: 1 })
    expect(result.attempted).toBe(1)
    expect(result.remaining).toBe(2)
  })
})

describe('reading a transcription back', () => {
  it('strips the brackets a model adds anyway', () => {
    expect(cleanIpa('/əˈspaɪər/')).toBe('əˈspaɪər')
    expect(cleanIpa('[ˈɡʌvərn]')).toBe('ˈɡʌvərn')
  })

  it('refuses prose and plain-letter respellings', () => {
    // A model that explains instead of transcribing has not answered, and a
    // sentence in the phonetics slot is worse than an empty one.
    expect(cleanIpa('I cannot determine the pronunciation')).toBeNull()
    expect(cleanIpa('AD-uh-kwut (adequate)')).toBeNull()
    expect(cleanIpa('   ')).toBeNull()
  })

  it('keeps a transcription that happens to contain plain letters', () => {
    expect(cleanIpa('ˈmædʒnɪt')).toBe('ˈmædʒnɪt')
    expect(cleanIpa('ˈɡʌvərn ˈbɒdi')).toBe('ˈɡʌvərn ˈbɒdi')
  })
})
