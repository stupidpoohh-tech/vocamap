import { layoutNodes, MAP_CARD, MAP_CENTRE, MAP_MIN_WIDTH, mapFrameHeight } from '@/lib/learning/map-layout'

/**
 * The illustration is the real map, drawn to scale rather than to size.
 *
 * The app's map is laid out in pixels, because its clearances are pixel facts.
 * This one sits in a column that is anywhere from a phone's width to 860px, so
 * it renders at the design width and expresses every size as a share of its own
 * container — same geometry, any width, nothing to keep in sync by hand.
 */
const pct = (px: number) => `${(px / MAP_MIN_WIDTH) * 100}%`
const cqw = (px: number) => `${((px / MAP_MIN_WIDTH) * 100).toFixed(3)}cqw`

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

export function MapIllustration({ lemma = 'maintain' }: { lemma?: string }) {
  const placed = layoutNodes(DEMO.map((d) => ({ id: d.id, importance: d.importance })))

  return (
    <div
      className="@container relative w-full"
      style={{ aspectRatio: `${MAP_MIN_WIDTH} / ${mapFrameHeight(DEMO.length)}` }}
      role="img"
      aria-label={`${lemma}의 Brain Map 예시 — 핵심 의미, 헷갈리는 단어, 함께 쓰는 표현, 파생어가 연결되어 있습니다`}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
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
            className="text-brand-line"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div
        className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-center"
        style={{ width: pct(MAP_CENTRE), aspectRatio: '1' }}
      >
        <span
          className="px-[3%] font-medium lowercase tracking-tight text-white"
          style={{ fontSize: cqw(17) }}
        >
          {lemma}
        </span>
      </div>

      {placed.map((p) => {
        const node = DEMO.find((d) => d.id === p.id)!
        return (
          <div
            key={p.id}
            aria-hidden
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col justify-center rounded-container bg-surface px-[6%] text-left shadow-card ring-1 ring-line/70"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: pct(MAP_CARD.width),
              aspectRatio: `${MAP_CARD.width} / ${MAP_CARD.height}`,
            }}
          >
            <span className="flex items-center gap-[3%]">
              <span
                className={`aspect-square shrink-0 rounded-full ${TONE[node.tone]}`}
                style={{ width: cqw(6) }}
              />
              <span className="truncate text-ink-3" style={{ fontSize: cqw(11) }}>
                {node.eyebrow}
              </span>
            </span>
            <span
              className="mt-[3%] line-clamp-2 block leading-snug break-keep"
              style={{ fontSize: cqw(15) }}
            >
              {node.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
