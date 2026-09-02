import { layoutNodes } from '@/lib/learning/map-layout'

/**
 * A non-interactive Brain Map for the landing page.
 *
 * Shares the layout engine with the real map, so the picture a visitor sees is
 * the screen they will get — including that the nodes carry real vocabulary
 * rather than category names. Rendered as plain elements on purpose: buttons
 * that look pressable but do nothing are worse than a picture.
 */

type Demo = {
  id: string
  eyebrow: string
  label: string
  importance: number
  tone: 'idle' | 'active' | 'weak' | 'done'
}

// Chosen to show the whole language in one glance: what matters, what is
// shaky, and what has not been met yet.
const DEMO: Demo[] = [
  { id: 'vs-keep', eyebrow: '자주 헷갈림', label: 'maintain vs keep', importance: 1, tone: 'weak' },
  { id: 'core', eyebrow: '핵심 의미', label: '유지하다', importance: 0.95, tone: 'done' },
  { id: 'quality', eyebrow: '함께 쓰는 표현', label: 'maintain quality', importance: 0.82, tone: 'active' },
  { id: 'order', eyebrow: '함께 쓰는 표현', label: 'maintain order', importance: 0.66, tone: 'active' },
  { id: 'machine', eyebrow: '확장 의미', label: 'maintain a machine', importance: 0.5, tone: 'idle' },
  { id: 'maintenance', eyebrow: '파생어', label: 'maintenance', importance: 0.44, tone: 'idle' },
]

const TONE: Record<Demo['tone'], string> = {
  idle: 'bg-line',
  active: 'bg-data-learning',
  weak: 'bg-bad',
  done: 'bg-good',
}

const SIZE = {
  hero: 'w-[11rem] px-3 py-2',
  primary: 'w-[10rem] px-3 py-2',
  secondary: 'w-[9rem] px-2.5 py-1.5',
  peripheral: 'w-[8rem] px-2.5 py-1.5',
} as const

export function MapIllustration({ lemma = 'maintain' }: { lemma?: string }) {
  const placed = layoutNodes(DEMO.map((d) => ({ id: d.id, importance: d.importance })))

  return (
    <div
      className="relative aspect-[16/12] w-full"
      role="img"
      aria-label={`${lemma}의 Brain Map 예시 — 핵심 의미, 헷갈리는 단어, 함께 쓰는 표현, 파생어가 연결되어 있습니다`}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden>
        {placed.map((p) => (
          <line
            key={p.id}
            x1={50}
            y1={50}
            x2={p.x}
            y2={p.y}
            stroke="currentColor"
            strokeWidth={p.strokeWidth}
            strokeOpacity={p.strokeOpacity}
            className="text-brand/70"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="absolute left-1/2 top-1/2 z-10 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-center">
        <span className="px-2 text-sm font-semibold lowercase tracking-tight text-white">
          {lemma}
        </span>
      </div>

      {placed.map((p) => {
        const node = DEMO.find((d) => d.id === p.id)!
        return (
          <div
            key={p.id}
            aria-hidden
            className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-surface text-left ${SIZE[p.tier]}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <span className="block truncate text-[10px] font-medium uppercase tracking-wide text-ink-3">
              {node.eyebrow}
            </span>
            <span
              className={`mt-0.5 block font-semibold break-keep ${
                p.tier === 'hero' ? 'text-[13px]' : 'text-[12px]'
              }`}
            >
              {node.label}
            </span>
            <span className="mt-1 flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${TONE[node.tone]}`} />
            </span>
          </div>
        )
      })}
    </div>
  )
}
