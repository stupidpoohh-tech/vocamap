export const NODE_TYPES = [
  'meaning_core',
  'sentences',
  'similar_words',
  'collocations',
  'word_family',
] as const

export type NodeType = (typeof NODE_TYPES)[number]

export const NODE_STATUSES = ['locked', 'available', 'learning', 'weak', 'mastered'] as const
export type NodeStatus = (typeof NODE_STATUSES)[number]

export const NODE_LABEL: Record<NodeType, string> = {
  meaning_core: '핵심 의미',
  sentences: '예문',
  similar_words: '비슷한 단어',
  collocations: '함께 쓰는 표현',
  word_family: '파생어',
}

export const NODE_SHORT: Record<NodeType, string> = {
  meaning_core: 'Meaning',
  sentences: 'Sentences',
  similar_words: 'Similar',
  collocations: 'Collocations',
  word_family: 'Family',
}

export const NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  locked: '아직 없음',
  available: '학습 가능',
  learning: '학습 중',
  weak: '약함',
  mastered: '완료',
}
