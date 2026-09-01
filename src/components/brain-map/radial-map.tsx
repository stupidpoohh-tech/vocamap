'use client'

import { NODE_LABEL, NODE_SHORT, type NodeStatus, type NodeType } from '@/lib/learning/nodes'

/**
 * The Brain Map.
 *
 * Laid out with CSS transforms on a square container rather than SVG or a graph
 * library: the five nodes are at fixed angles, so there is no layout to
 * compute, nothing to re-render on resize, and it stays legible and tappable at
 * 360px wide. A force-directed graph would look more impressive and be worse to
 * use on a phone.
 *
 * Colour is state, never decoration — a student can read their progress from
 * across the room without reading a word.
 */

const ANGLES: Record<NodeType, number> = {
  meaning_core: -90,
  collocations: -18,
  word_family: 54,
  sentences: 126,
  similar_words: 198,
}

const STATUS_STYLE: Record<NodeStatus, { dot: string; ring: string; text: string }> = {
  locked: { dot: 'bg-line', ring: 'border-line bg-surface', text: 'text-muted/60' },
  available: { dot: 'bg-brand', ring: 'border-brand/40 bg-surface', text: 'text-ink' },
  learning: { dot: 'bg-brand', ring: 'border-brand bg-brand-soft', text: 'text-brand' },
  weak: { dot: 'bg-bad', ring: 'border-bad bg-bad-soft', text: 'text-bad' },
  mastered: { dot: 'bg-good', ring: 'border-good bg-good-soft', text: 'text-good' },
}

export type MapNode = { node: NodeType; status: NodeStatus; itemCount: number }

export function RadialMap({
  lemma,
  nodes,
  activeNode,
  onSelect,
}: {
  lemma: string
  nodes: MapNode[]
  activeNode: NodeType | null
  onSelect: (node: NodeType) => void
}) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[22rem] select-none">
      {/* Spokes, drawn behind the nodes. */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden>
        {nodes.map((n) => {
          const rad = (ANGLES[n.node] * Math.PI) / 180
          return (
            <line
              key={n.node}
              x1={50}
              y1={50}
              x2={50 + Math.cos(rad) * 34}
              y2={50 + Math.sin(rad) * 34}
              stroke="currentColor"
              strokeWidth={n.status === 'locked' ? 0.4 : 0.8}
              className={n.status === 'locked' ? 'text-line' : 'text-brand/35'}
            />
          )
        })}
      </svg>

      {/* The word itself, at the centre. Type scales with length so a long
          lemma stays on one line instead of breaking mid-word. */}
      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="flex h-26 w-26 items-center justify-center rounded-full border-2 border-brand bg-brand text-center shadow-lg shadow-brand/20">
          <span
            className={`px-2 font-bold uppercase leading-tight tracking-wide text-white ${
              lemma.length <= 8 ? 'text-sm' : lemma.length <= 12 ? 'text-xs' : 'text-[10px]'
            }`}
          >
            {lemma}
          </span>
        </div>
      </div>

      {nodes.map((n) => {
        const rad = (ANGLES[n.node] * Math.PI) / 180
        const style = STATUS_STYLE[n.status]
        const disabled = n.status === 'locked'

        return (
          <button
            key={n.node}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(n.node)}
            aria-pressed={activeNode === n.node}
            aria-label={`${NODE_LABEL[n.node]} — ${n.itemCount}개`}
            className={`absolute z-10 flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border px-2 py-2.5 text-center transition
              ${style.ring} ${disabled ? 'cursor-not-allowed opacity-55' : 'hover:scale-105 active:scale-100'}
              ${activeNode === n.node ? 'ring-2 ring-brand ring-offset-2' : ''}`}
            style={{
              left: `${50 + Math.cos(rad) * 38}%`,
              top: `${50 + Math.sin(rad) * 38}%`,
            }}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
            <span className={`text-[11px] font-semibold leading-tight ${style.text}`}>
              {NODE_SHORT[n.node]}
            </span>
            <span className="text-[10px] tabular-nums text-muted">
              {disabled ? '—' : n.itemCount}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function MapLegend() {
  const items: Array<[NodeStatus, string]> = [
    ['available', '학습 가능'],
    ['learning', '학습 중'],
    ['weak', '약함'],
    ['mastered', '완료'],
    ['locked', '아직 없음'],
  ]
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {items.map(([status, label]) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLE[status].dot}`} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  )
}
