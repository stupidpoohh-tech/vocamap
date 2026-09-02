/**
 * The shape of one editable piece of a Brain Map.
 *
 * A generated draft is a starting point, not an answer — the teacher who knows
 * the student is the one who decides whether a sentence earns its place. These
 * specs are the single definition of what an item is made of: the review screen
 * renders its form from them and the server validates against them, so a field
 * cannot exist on screen without a rule behind it.
 *
 * Pure on purpose — no database, no React — so the rules can be tested directly.
 */

export type ItemKind =
  | 'meaning'
  | 'sentence'
  | 'collocation'
  | 'wordFamily'
  | 'pair'
  | 'pairQuestion'

export type ItemField = {
  name: string
  label: string
  input: 'text' | 'textarea' | 'number' | 'select'
  required?: boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  hint?: string
  options?: Array<{ value: string; label: string }>
  /** Set once at creation and then fixed — see ITEM_FIELDS.pair. */
  createOnly?: boolean
}

export const ITEM_LABEL: Record<ItemKind, string> = {
  meaning: '뜻',
  sentence: '예문',
  collocation: '함께 쓰는 표현',
  wordFamily: '파생어',
  pair: '헷갈리는 단어',
  pairQuestion: '구별 문제',
}

/**
 * Mirrors the caps in `brainMapDraftSchema`: a Brain Map is a selection.
 *
 * Each is one slot above what the model is asked for, so a curator has room to
 * add the thing they know matters — and still cannot turn the map back into a
 * dictionary entry.
 */
export const ITEM_MAX: Record<ItemKind, number> = {
  meaning: 3,
  sentence: 4,
  collocation: 3,
  wordFamily: 3,
  pair: 2,
  pairQuestion: 5,
}

/** What actually reaches the map, per section. Shown next to the cap. */
export const ITEM_ON_MAP: Partial<Record<ItemKind, number>> = {
  meaning: 2,
  collocation: 2,
  pair: 1,
}

export const ITEM_FIELDS: Record<ItemKind, ItemField[]> = {
  meaning: [
    { name: 'ko', label: '뜻', input: 'text', required: true, maxLength: 200 },
    { name: 'enDefinition', label: '영영 정의', input: 'text', maxLength: 240 },
    {
      name: 'connectionNote',
      label: '중심 개념과의 연결',
      input: 'textarea',
      maxLength: 300,
      hint: '이 뜻이 중심 개념에서 어떻게 나오는지 설명해요. 학생이 실제로 읽는 부분이에요.',
    },
    { name: 'exampleChunk', label: '짧은 예시', input: 'text', maxLength: 80, hint: '예: maintain health' },
  ],
  sentence: [
    { name: 'text', label: '영어 문장', input: 'textarea', required: true, minLength: 5, maxLength: 180 },
    { name: 'ko', label: '한국어 번역', input: 'text', required: true, maxLength: 200 },
    {
      name: 'targetMeaning',
      label: '보여주는 용법',
      input: 'text',
      required: true,
      maxLength: 200,
      hint: '이 문장이 어떤 쓰임을 보여주는지. 예문끼리 겹치는지 판단하는 기준이에요.',
    },
    {
      name: 'highlight',
      label: '강조할 부분',
      input: 'text',
      maxLength: 60,
      hint: '영어 문장 안에 그대로 들어 있는 표현이어야 해요. 비워 두면 강조하지 않아요.',
    },
    { name: 'difficulty', label: '난이도', input: 'number', min: 1, max: 5, hint: '1(쉬움) ~ 5(어려움)' },
  ],
  collocation: [
    { name: 'expression', label: '표현', input: 'text', required: true, maxLength: 200 },
    { name: 'ko', label: '뜻', input: 'text', required: true, maxLength: 200 },
    { name: 'exampleSentence', label: '예문', input: 'textarea', minLength: 5, maxLength: 180 },
    {
      name: 'importance',
      label: '중요도',
      input: 'select',
      required: true,
      options: [
        { value: '1', label: '1 · 반드시' },
        { value: '2', label: '2 · 알아두면 좋음' },
        { value: '3', label: '3 · 참고' },
      ],
    },
  ],
  wordFamily: [
    { name: 'lemma', label: '단어', input: 'text', required: true, maxLength: 200 },
    {
      name: 'partOfSpeech',
      label: '품사',
      input: 'select',
      required: true,
      options: [
        { value: 'noun', label: '명사' },
        { value: 'verb', label: '동사' },
        { value: 'adjective', label: '형용사' },
        { value: 'adverb', label: '부사' },
        { value: 'other', label: '기타' },
      ],
    },
    { name: 'ko', label: '뜻', input: 'text', required: true, maxLength: 200 },
    { name: 'exampleSentence', label: '예문', input: 'textarea', minLength: 5, maxLength: 180 },
  ],
  pair: [
    {
      name: 'lemma',
      label: '헷갈리는 단어',
      input: 'text',
      required: true,
      maxLength: 200,
      // Two words identify the pair, and the pair is shared by both words' maps.
      // Renaming one would silently become a different pair, so the way to
      // change it is to delete this one and add the right one.
      createOnly: true,
      hint: '추가한 뒤에는 바꿀 수 없어요. 다른 단어로 바꾸려면 삭제하고 다시 추가해 주세요.',
    },
    {
      name: 'coreDifference',
      label: '핵심 차이',
      input: 'textarea',
      required: true,
      minLength: 5,
      maxLength: 300,
      hint: '이 설명은 두 단어의 맵에서 함께 쓰여요.',
    },
    { name: 'usageRule', label: '사용 규칙', input: 'textarea', maxLength: 300 },
  ],
  pairQuestion: [
    {
      name: 'prompt',
      label: '문제 문장',
      input: 'textarea',
      required: true,
      minLength: 5,
      maxLength: 180,
      hint: '빈칸 ___ 을 정확히 하나 포함해야 해요.',
    },
    { name: 'answer', label: '정답', input: 'text', required: true, maxLength: 200 },
    { name: 'explanation', label: '해설', input: 'textarea', required: true, minLength: 5, maxLength: 300 },
  ],
}

export type ItemValues = Record<string, string | number | null>

export type ItemValidation =
  | { ok: true; values: ItemValues }
  | { ok: false; errors: Record<string, string> }

/**
 * Checks one item's raw form values.
 *
 * Beyond the per-field limits there are two cross-field rules, and they are the
 * same two that block a whole generated draft: a highlight the sentence does
 * not contain has nothing to mark up, and a cloze prompt without exactly one
 * blank is not answerable. Both would render as a broken card, so an edit is
 * held to them too.
 */
export function validateItem(
  kind: ItemKind,
  raw: Record<string, string>,
  context: { lemma?: string } = {},
): ItemValidation {
  const errors: Record<string, string> = {}
  const values: ItemValues = {}

  for (const field of ITEM_FIELDS[kind]) {
    const text = (raw[field.name] ?? '').trim()

    if (!text) {
      if (field.required) {
        errors[field.name] = '필수 항목이에요.'
        continue
      }
      values[field.name] = field.input === 'number' ? null : null
      continue
    }

    if (field.input === 'number') {
      const parsed = Number(text)
      if (!Number.isInteger(parsed)) {
        errors[field.name] = '숫자를 입력해 주세요.'
      } else if (
        (field.min !== undefined && parsed < field.min) ||
        (field.max !== undefined && parsed > field.max)
      ) {
        errors[field.name] = `${field.min}에서 ${field.max} 사이로 입력해 주세요.`
      } else {
        values[field.name] = parsed
      }
      continue
    }

    if (field.options && !field.options.some((o) => o.value === text)) {
      errors[field.name] = '목록에서 골라 주세요.'
      continue
    }
    if (field.minLength && text.length < field.minLength) {
      errors[field.name] = `${field.minLength}자 이상 입력해 주세요.`
      continue
    }
    if (field.maxLength && text.length > field.maxLength) {
      errors[field.name] = `${field.maxLength}자 이하로 입력해 주세요.`
      continue
    }
    values[field.name] = text
  }

  if (kind === 'sentence' && !errors.text && !errors.highlight) {
    const text = String(values.text ?? '')
    const highlight = values.highlight ? String(values.highlight) : ''
    if (highlight && !text.toLowerCase().includes(highlight.toLowerCase())) {
      errors.highlight = '영어 문장 안에 그대로 들어 있는 표현이어야 해요.'
    }
  }

  if (kind === 'pairQuestion' && !errors.prompt) {
    const blanks = String(values.prompt ?? '').match(/_{2,}/g)?.length ?? 0
    if (blanks !== 1) {
      errors.prompt = '빈칸 ___ 을 정확히 하나만 넣어 주세요.'
    }
  }

  if (kind === 'pair' && !errors.lemma && context.lemma) {
    const other = String(values.lemma ?? '').trim().toLowerCase()
    if (other === context.lemma.trim().toLowerCase()) {
      errors.lemma = '같은 단어끼리는 짝지을 수 없어요.'
    }
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values }
}
