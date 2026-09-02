import type { BrainMapDraft } from '@/lib/ai/schema'

/**
 * Hand-authored seed content.
 *
 * This is not filler: it is the reference for what an *approved* Brain Map
 * should look like, and the standard the AI generator's output gets judged
 * against in review. `maintain`, `affect` and `issue` are written out in full
 * so every node of the UI has something real to render.
 *
 * Everything seeded is marked `isSeed`, so `pnpm db:reset-seed` can remove it
 * without touching production content.
 */

export type SeedWord = {
  lemma: string
  partOfSpeech: string
  level: string | null
  translations: string[]
  brainMap?: BrainMapDraft
}

export const SEED_WORDS: SeedWord[] = [
  {
    lemma: 'maintain',
    partOfSpeech: 'verb',
    level: 'B2',
    translations: ['유지하다', '주장하다', '정비하다'],
    brainMap: {
      meaningCoreKo: '어떤 상태가 끊기지 않고 계속 이어지도록 붙잡아 두다.',
      meaningCoreEn: 'to keep something in the same condition, by continued effort',
      primaryTranslations: ['유지하다', '주장하다', '정비하다'],
      meanings: [
        {
          ko: '(상태를) 유지하다',
          enDefinition: 'to keep something at the same level or in the same condition',
          connectionNote:
            '핵심 의미가 가장 직접적으로 드러나는 용법. 가만히 두는 것이 아니라 노력해서 계속 이어가는 것이 포인트다.',
          exampleChunk: 'maintain good health',
        },
        {
          ko: '(기계·건물을) 정비하다, 관리하다',
          enDefinition: 'to keep equipment in good condition by checking and repairing it',
          connectionNote:
            '상태를 계속 이어지게 하려면 손봐야 한다. "유지하다"에 실제 작업이 붙은 용법.',
          exampleChunk: 'maintain a machine',
        },
        {
          ko: '(의견을) 계속 주장하다',
          enDefinition: 'to keep saying that something is true, even when others disagree',
          connectionNote:
            '유지되는 대상이 상태가 아니라 "내 입장"인 경우. 반대에도 입장을 끊지 않고 이어간다는 점에서 핵심 의미와 연결된다.',
          exampleChunk: 'maintain his innocence',
        },
      ],
      sentences: [
        {
          text: 'Regular exercise helps maintain good health.',
          ko: '규칙적인 운동은 건강을 유지하는 데 도움이 된다.',
          targetMeaning: '상태를 유지하다',
          highlight: 'maintain good health',
          difficulty: 1,
        },
        {
          text: 'It is difficult to maintain a long-distance relationship.',
          ko: '장거리 연애를 유지하는 것은 어렵다.',
          targetMeaning: '관계를 이어가다',
          highlight: 'maintain a long-distance relationship',
          difficulty: 2,
        },
        {
          text: 'The machine must be properly maintained to work safely.',
          ko: '그 기계는 안전하게 작동하려면 제대로 정비되어야 한다.',
          targetMeaning: '기계를 정비하다',
          highlight: 'properly maintained',
          difficulty: 3,
        },
        {
          text: 'He maintained that he had never seen the document.',
          ko: '그는 그 문서를 결코 본 적이 없다고 주장했다.',
          targetMeaning: '의견을 주장하다',
          highlight: 'maintained that',
          difficulty: 4,
        },
      ],
      collocations: [
        {
          expression: 'maintain a relationship',
          ko: '관계를 유지하다',
          exampleSentence: 'They maintained a close relationship for twenty years.',
          importance: 1,
        },
        {
          expression: 'maintain quality',
          ko: '품질을 유지하다',
          exampleSentence: 'Small farms find it hard to maintain quality at scale.',
          importance: 1,
        },
        {
          expression: 'maintain order',
          ko: '질서를 유지하다',
          exampleSentence: 'The teachers struggled to maintain order in the hall.',
          importance: 2,
        },
      ],
      wordFamily: [
        {
          lemma: 'maintenance',
          partOfSpeech: 'noun',
          ko: '유지, 정비, 보수',
          exampleSentence: 'Regular maintenance is essential for the machine.',
        },
        {
          lemma: 'maintainable',
          partOfSpeech: 'adjective',
          ko: '유지할 수 있는',
          exampleSentence: 'The team rewrote the code to make it maintainable.',
        },
      ],
      similarWords: [
        {
          lemma: 'keep',
          coreDifference:
            'keep은 그냥 계속 가지고 있거나 그 상태로 두는 것이고, maintain은 그 상태가 무너지지 않도록 의식적으로 노력하는 것이다. 그래서 maintain은 격식 있는 글이나 품질·질서·기계처럼 관리가 필요한 대상에 쓰인다.',
          usageRule:
            '일상적인 "계속 ~하다"는 keep, 노력과 관리가 들어간 "유지하다"는 maintain.',
          questions: [
            {
              prompt: 'The hospital must ___ strict hygiene standards at all times.',
              answer: 'maintain',
              explanation:
                '병원이 위생 "기준"을 관리하고 지켜내는 상황이라 maintain이 자연스럽다.',
            },
            {
              prompt: 'Please ___ the door open for a second.',
              answer: 'keep',
              explanation:
                '잠깐 문을 그 상태로 두라는 일상적인 요청이므로 keep. 여기서 maintain은 지나치게 격식적이다.',
            },
            {
              prompt: 'Engineers ___ the bridge twice a year.',
              answer: 'maintain',
              explanation: '정기적인 점검·보수를 뜻하므로 maintain.',
            },
          ],
        },
      ],
    },
  },
  {
    lemma: 'affect',
    partOfSpeech: 'verb',
    level: 'B1',
    translations: ['영향을 미치다', '~인 척하다'],
    brainMap: {
      meaningCoreKo: '어떤 것이 다른 것에 작용해서 그 상태나 결과를 바꾸다.',
      meaningCoreEn: 'to produce a change in someone or something',
      primaryTranslations: ['영향을 미치다', '(감정을) 흔들다'],
      meanings: [
        {
          ko: '~에 영향을 미치다',
          enDefinition: 'to cause a change in something',
          connectionNote:
            '가장 기본적인 용법. 목적어를 바로 취하는 타동사라서 "affect to"처럼 쓰지 않는다.',
          exampleChunk: 'affect the results',
        },
        {
          ko: '(감정적으로) 마음을 움직이다',
          enDefinition: "to cause a strong emotion in someone",
          connectionNote:
            '"바꾸다"의 대상이 사람의 마음인 경우. 보통 수동태 be deeply affected 형태로 자주 쓰인다.',
          exampleChunk: 'deeply affected by the news',
        },
      ],
      sentences: [
        {
          text: 'The weather can affect how well you sleep.',
          ko: '날씨는 당신이 얼마나 잘 자는지에 영향을 줄 수 있다.',
          targetMeaning: '영향을 미치다',
          highlight: 'affect how well you sleep',
          difficulty: 1,
        },
        {
          text: 'Rising prices affect low-income families the most.',
          ko: '물가 상승은 저소득 가정에 가장 큰 영향을 미친다.',
          targetMeaning: '집단에 영향을 미치다',
          highlight: 'affect low-income families',
          difficulty: 2,
        },
        {
          text: 'She was deeply affected by her grandfather’s death.',
          ko: '그녀는 할아버지의 죽음에 깊이 마음이 흔들렸다.',
          targetMeaning: '감정을 움직이다',
          highlight: 'deeply affected',
          difficulty: 3,
        },
      ],
      collocations: [
        {
          expression: 'directly affect',
          ko: '직접적으로 영향을 미치다',
          exampleSentence: 'The new rule directly affects part-time workers.',
          importance: 1,
        },
        {
          expression: 'adversely affect',
          ko: '악영향을 미치다',
          exampleSentence: 'Lack of sleep adversely affects concentration.',
          importance: 2,
        },
        {
          expression: 'be deeply affected by',
          ko: '~에 깊이 영향을 받다',
          exampleSentence: 'The whole town was deeply affected by the flood.',
          importance: 2,
        },
      ],
      wordFamily: [
        {
          lemma: 'affection',
          partOfSpeech: 'noun',
          ko: '애정',
          exampleSentence: 'He showed great affection for his students.',
        },
      ],
      similarWords: [
        {
          lemma: 'effect',
          coreDifference:
            'affect는 거의 항상 동사로 "영향을 미치다", effect는 거의 항상 명사로 "영향, 결과"다. 발음이 비슷해서 헷갈리지만 문장에서의 자리가 완전히 다르다.',
          usageRule:
            '앞에 the/an이 오면 effect(명사), 주어 뒤에 바로 오면 affect(동사)라고 생각하면 대부분 맞는다.',
          questions: [
            {
              prompt: 'Too much caffeine can ___ your sleep.',
              answer: 'affect',
              explanation: 'can 뒤에는 동사가 와야 하므로 affect.',
            },
            {
              prompt: 'The medicine had no ___ on the pain.',
              answer: 'effect',
              explanation: 'no 뒤에 오는 명사 자리이므로 effect.',
            },
            {
              prompt: 'Scientists studied the ___ of sunlight on plants.',
              answer: 'effect',
              explanation: 'the ___ of 구조는 명사 자리이므로 effect.',
            },
          ],
        },
      ],
    },
  },
  {
    lemma: 'issue',
    partOfSpeech: 'noun',
    level: 'B1',
    translations: ['문제, 쟁점', '(잡지의) 호', '발행하다'],
    brainMap: {
      meaningCoreKo: '밖으로 나와서 사람들 사이에 놓이게 된 것 — 다뤄야 할 문제이거나, 세상에 내보낸 것.',
      meaningCoreEn: 'something brought out into the open: a matter to deal with, or something sent out',
      primaryTranslations: ['문제', '쟁점'],
      meanings: [
        {
          ko: '(다뤄야 할) 문제, 쟁점',
          enDefinition: 'an important topic that people are discussing or arguing about',
          connectionNote:
            '드러나서 다 같이 다뤄야 하는 상태가 된 것. problem과 달리 "해결해야 할 골칫거리"보다 "논의 대상"에 가깝다.',
          exampleChunk: 'an important issue',
        },
        {
          ko: '(정기 간행물의) 호',
          enDefinition: 'one of a regular series of a magazine or newspaper',
          connectionNote:
            '"밖으로 내보낸 것"이라는 감각. 이번 달에 세상에 나온 한 권이 this month’s issue다.',
          exampleChunk: "this month's issue",
        },
        {
          ko: '(공식적으로) 발급하다, 발표하다',
          enDefinition: 'to officially give out or announce something',
          connectionNote:
            '동사로 쓰일 때의 용법. 기관이 무언가를 밖으로 내보낸다는 점에서 명사 뜻과 뿌리가 같다.',
          exampleChunk: 'issue a statement',
        },
      ],
      sentences: [
        {
          text: 'Climate change is the most urgent issue of our time.',
          ko: '기후 변화는 우리 시대의 가장 시급한 문제다.',
          targetMeaning: '사회적 쟁점',
          highlight: 'the most urgent issue',
          difficulty: 2,
        },
        {
          text: 'I have an issue with the way this was decided.',
          ko: '나는 이것이 결정된 방식에 이견이 있다.',
          targetMeaning: '개인적인 이견·불만',
          highlight: 'an issue with',
          difficulty: 3,
        },
        {
          text: 'Her article appeared in last month’s issue.',
          ko: '그녀의 기사는 지난달 호에 실렸다.',
          targetMeaning: '간행물의 호',
          highlight: 'last month’s issue',
          difficulty: 2,
        },
        {
          text: 'The government issued a warning about the storm.',
          ko: '정부는 폭풍에 대한 경보를 발령했다.',
          targetMeaning: '공식적으로 발표하다',
          highlight: 'issued a warning',
          difficulty: 3,
        },
      ],
      collocations: [
        {
          expression: 'raise an issue',
          ko: '문제를 제기하다',
          exampleSentence: 'She raised the issue at the staff meeting.',
          importance: 1,
        },
        {
          expression: 'address an issue',
          ko: '문제를 다루다',
          exampleSentence: 'The report fails to address the real issue.',
          importance: 1,
        },
        {
          expression: 'a controversial issue',
          ko: '논란이 되는 쟁점',
          exampleSentence: 'Voting age is a controversial issue in many countries.',
          importance: 2,
        },
      ],
      wordFamily: [],
      similarWords: [
        {
          lemma: 'problem',
          coreDifference:
            'problem은 반드시 해결해야 하는 나쁜 상황이고, issue는 사람들이 논의하고 있는 사안이다. issue는 중립적일 수 있지만 problem은 거의 항상 부정적이다.',
          usageRule:
            '고쳐야 할 고장·곤란은 problem, 토론하거나 다뤄야 할 사안은 issue.',
          questions: [
            {
              prompt: 'Privacy is a major ___ in the age of social media.',
              answer: 'issue',
              explanation: '사회적으로 논의되는 사안이므로 issue.',
            },
            {
              prompt: 'My laptop has a serious ___ with overheating.',
              answer: 'problem',
              explanation: '고장이라는 부정적 상황이므로 problem이 자연스럽다.',
            },
          ],
        },
      ],
    },
  },
  { lemma: 'significant', partOfSpeech: 'adjective', level: 'B2', translations: ['중요한', '상당한'] },
  { lemma: 'contribute', partOfSpeech: 'verb', level: 'B2', translations: ['기여하다', '기부하다'] },
  { lemma: 'increase', partOfSpeech: 'verb', level: 'A2', translations: ['증가하다', '늘리다'] },
  { lemma: 'demand', partOfSpeech: 'noun', level: 'B1', translations: ['수요', '요구'] },
  { lemma: 'supply', partOfSpeech: 'noun', level: 'B1', translations: ['공급', '공급하다'] },
  { lemma: 'approach', partOfSpeech: 'noun', level: 'B1', translations: ['접근법', '다가가다'] },
  { lemma: 'account', partOfSpeech: 'noun', level: 'B1', translations: ['계좌', '설명', '계정'] },
]
