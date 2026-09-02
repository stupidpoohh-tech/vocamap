import { NODE_ANGLE, NODE_SHORT, type NodeType } from '@/lib/learning/nodes'

/**
 * A non-interactive Brain Map, for the landing page.
 *
 * Shares its geometry with the real map so the picture a visitor sees is the
 * screen they will actually get. Rendered as plain elements rather than the
 * live component on purpose: buttons that look pressable but do nothing are
 * worse than a picture.
 */

type Tone = 'idle' | 'active' | 'weak' | 'done'

const TONE: Record<Tone, { chip: string; dot: string }> = {
  idle: { chip: 'border-line bg-surface text-muted', dot: 'bg-line' },
  active: { chip: 'border-brand/40 bg-surface text-ink', dot: 'bg-brand' },
  weak: { chip: 'border-bad/50 bg-bad-soft text-bad', dot: 'bg-bad' },
  done: { chip: 'border-good/50 bg-good-soft text-good', dot: 'bg-good' },
}

// Chosen to show the colour language in one glance: something mastered,
// something struggling, something not started.
const DEMO: Record<NodeType, Tone> = {
  meaning_core: 'done',
  sentences: 'active',
  similar_words: 'weak',
  collocations: 'active',
  word_family: 'idle',
}

export function MapIllustration({ lemma = 'maintain' }: { lemma?: string }) {
  const nodes = Object.keys(DEMO) as NodeType[]

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[21rem]"
      role="img"
      aria-label={`${lemma} 단어의 Brain Map 예시 — 핵심 의미, 예문, 비슷한 단어, 함께 쓰는 표현, 파생어 다섯 갈래`}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden>
        {nodes.map((node) => {
          const rad = (NODE_ANGLE[node] * Math.PI) / 180
          return (
            <line
              key={node}
              x1={50}
              y1={50}
              x2={50 + Math.cos(rad) * 34}
              y2={50 + Math.sin(rad) * 34}
              stroke="currentColor"
              strokeWidth={DEMO[node] === 'idle' ? 0.4 : 0.8}
              className={DEMO[node] === 'idle' ? 'text-line' : 'text-brand/35'}
            />
          )
        })}
      </svg>

      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="flex h-26 w-26 items-center justify-center rounded-full border-2 border-brand bg-brand text-center shadow-lg shadow-brand/20">
          <span
            className={`px-2 font-bold uppercase leading-tight tracking-wide text-white ${
              lemma.length <= 8 ? 'text-sm' : 'text-xs'
            }`}
          >
            {lemma}
          </span>
        </div>
      </div>

      {nodes.map((node) => {
        const rad = (NODE_ANGLE[node] * Math.PI) / 180
        const tone = TONE[DEMO[node]]
        return (
          <div
            key={node}
            aria-hidden
            className={`absolute z-10 flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border px-2 py-2.5 text-center ${tone.chip}`}
            style={{
              left: `${50 + Math.cos(rad) * 38}%`,
              top: `${50 + Math.sin(rad) * 38}%`,
            }}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            <span className="text-[11px] font-semibold leading-tight">{NODE_SHORT[node]}</span>
          </div>
        )
      })}
    </div>
  )
}
