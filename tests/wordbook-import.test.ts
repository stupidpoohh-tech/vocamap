import { describe, expect, it } from 'vitest'
import { parseWordbook } from '@/lib/import/wordbook'

/**
 * The page this format exists to transcribe — Word Master 고등 COMPLETE p.166,
 * typed as a tutor would type it. If the format cannot take this without
 * fighting, it is the wrong format.
 */
const PAGE = `
contemporary [kəntémpərèri]
a. 현대의, 동시대의
- Most contemporary art began as some sort of craft.
= 대부분의 현대 예술은 일종의 공예로서 시작했다.
n. 동년배, 동시대인
+ contemporary art / 현대 미술
+ contemporary music / 현대 음악
+ contemporary literature / 현대 문학
+ my contemporaries at school / 나의 동기생들
≒ modern / 현대의
≒ current / 현재의

candidate [kǽndidèit]
n. 후보, 출마자; 지원자
- We decided to narrow down the candidates.
= 우리는 후보군을 좁히기로 했다.
+ presidential candidate / 대통령 후보
+ doctoral candidate / 박사 학위 지원자
* candidacy / n. / 입후보
`

describe('wordbook import format', () => {
  it('reads a real page without complaint', () => {
    const { entries, problems } = parseWordbook(PAGE)
    expect(problems).toEqual([])
    expect(entries.map((e) => e.lemma)).toEqual(['contemporary', 'candidate'])
  })

  it('keeps the pronunciation the book prints beside the headword', () => {
    // The one thing a student always asks about a new word.
    const [first] = parseWordbook(PAGE).entries
    expect(first!.lemma).toBe('contemporary')
    expect(first!.pronunciation).toBe('kəntémpərèri')
  })

  it('takes a pronunciation written between slashes too', () => {
    const [entry] = parseWordbook('candidate /ˈkændɪdeɪt/\nn. 후보').entries
    expect(entry!.lemma).toBe('candidate')
    expect(entry!.pronunciation).toBe('ˈkændɪdeɪt')
  })

  it('leaves the pronunciation null when the book printed none', () => {
    const [entry] = parseWordbook('ethics\nn. 윤리학').entries
    expect(entry!.pronunciation).toBeNull()
  })

  it('keeps each part of speech as its own sense, in book order', () => {
    const [first] = parseWordbook(PAGE).entries
    expect(first!.senses.map((s) => [s.partOfSpeech, s.ko])).toEqual([
      ['adjective', '현대의, 동시대의'],
      ['noun', '동년배, 동시대인'],
    ])
  })

  it('binds an example and its translation to the sense above them', () => {
    const [first] = parseWordbook(PAGE).entries
    expect(first!.senses[0]!.examples).toEqual([
      {
        en: 'Most contemporary art began as some sort of craft.',
        ko: '대부분의 현대 예술은 일종의 공예로서 시작했다.',
      },
    ])
    // The second sense has none, and that is not an error — the book only
    // printed one example.
    expect(first!.senses[1]!.examples).toEqual([])
  })

  it('reads collocations and derived forms', () => {
    const { entries } = parseWordbook(PAGE)
    expect(entries[0]!.collocations).toHaveLength(4)
    expect(entries[0]!.collocations[0]).toEqual({
      expression: 'contemporary art',
      ko: '현대 미술',
    })
    expect(entries[1]!.wordFamily).toEqual([
      { lemma: 'candidacy', partOfSpeech: 'noun', ko: '입후보' },
    ])
  })

  it('accepts a derived form without a part of speech', () => {
    const { entries, problems } = parseWordbook('ethics\nn. 윤리학\n* ethically / 윤리적으로')
    expect(problems).toEqual([])
    expect(entries[0]!.wordFamily).toEqual([
      { lemma: 'ethically', partOfSpeech: null, ko: '윤리적으로' },
    ])
  })

  it('collects synonyms separately, because v1 does not import them', () => {
    // The book lists them without saying how they differ, and a "자주 헷갈림"
    // node with no difference to teach would be an invention.
    const [first] = parseWordbook(PAGE).entries
    expect(first!.synonyms).toEqual([
      { lemma: 'modern', ko: '현대의' },
      { lemma: 'current', ko: '현재의' },
    ])
  })

  it('names the line when a line cannot be read', () => {
    const { problems } = parseWordbook('candidate\nn. 후보\n후보를 좁히다')
    expect(problems).toHaveLength(1)
    expect(problems[0]!.line).toBe(3)
    expect(problems[0]!.message).toContain('알 수 없는 줄')
  })

  it('refuses a block whose first line is not an English headword', () => {
    // The usual mistake: forgetting the blank line between two words.
    const { entries, problems } = parseWordbook('후보, 출마자\nn. 후보')
    expect(entries).toEqual([])
    expect(problems[0]!.message).toContain('영어 표제어')
  })

  it('refuses a word with no sense at all', () => {
    const { entries, problems } = parseWordbook('candidate\n+ presidential candidate / 대통령 후보')
    expect(entries).toEqual([])
    expect(problems[0]!.message).toContain('뜻이 없습니다')
  })

  it('says so when a translation has no example above it', () => {
    const { problems } = parseWordbook('candidate\nn. 후보\n= 해석만 있습니다')
    expect(problems[0]!.message).toContain('예문(-)이 없습니다')
  })

  it('ignores comments and tolerates extra blank lines', () => {
    const { entries, problems } = parseWordbook(
      '# 16과 시험범위\n\n\ncandidate\nn. 후보\n\n\n\nethics\nn. 윤리학\n',
    )
    expect(problems).toEqual([])
    expect(entries.map((e) => e.lemma)).toEqual(['candidate', 'ethics'])
  })
})
