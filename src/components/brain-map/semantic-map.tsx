'use client'

import { useMemo } from 'react'
import { layoutNodes, type PlacedNode, type SizeTier } from '@/lib/learning/map-layout'
import type { NodeStatus, SemanticNode } from '@/lib/data/semantic-map'
import { cn } from '@/lib/utils'

/**
 * The word's semantic network.
 *
 * Every node's largest text is a piece of vocabulary — never a category name.
 * Importance is carried by size, distance from the centre and connector weight,
 * so the reader can see what matters without a legend; learning state is a
 * single dot, so the map stays a map instead of turning into a dashboard.
 */

const STATUS_DOT: Record<NodeStatus, string> = {
  completed: 'bg-good',
  learning: 'bg-brand',
  needsReview: 'bg-warn',
  weak: 'bg-bad',
  unseen: 'bg-line',
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  completed: '완료',
  learning: '학습 중',
  needsReview: '보완 필요',
  weak: '약함',
  unseen: '아직 안 봄',
}

/**
 * Card scale per tier. Deliberately uneven — equal cards read as a menu.
 *
 * Widths are a share of the map box rather than a fixed rem, so a card always
 * occupies the same fraction of the layout's coordinate space no matter how
 * wide the viewport is. Sizing them in rem meant the collision footprints the
 * layout works with were only correct at one screen width.
 */
const TIER: Record<SizeTier, { widthPct: number; pad: string; label: string }> = {
  hero: { widthPct: 27, pad: 'px-4 py-3', label: 'text-[15px] leading-snug' },
  primary: { widthPct: 23, pad: 'px-3.5 py-2.5', label: 'text-[14px] leading-snug' },
  secondary: { widthPct: 20, pad: 'px-3 py-2', label: 'text-[13px] leading-snug' },
  peripheral: { widthPct: 17, pad: 'px-2.5 py-1.5', label: 'text-[12px] leading-snug' },
}

/**
 * Past roughly this many cards a constellation stops reading as one shape and
 * starts reading as clutter, whatever the layout does.
 */
const CONSTELLATION_LIMIT = 8

export function SemanticMap({
  lemma,
  nodes,
  selectedId,
  onSelect,
}: {
  lemma: string
  nodes: SemanticNode[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  // A constellation stops reading as one past roughly a dozen cards. The most
  // important nodes stay on the map; the rest sit under it as a quiet row, so
  // nothing becomes unreachable just because a word is rich.
  const { onMap, overflow } = useMemo(() => {
    const byImportance = [...nodes].sort((a, b) => b.importance - a.importance)
    return {
      onMap: byImportance.slice(0, CONSTELLATION_LIMIT),
      overflow: byImportance.slice(CONSTELLATION_LIMIT),
    }
  }, [nodes])

  const placed = useMemo(
    () =>
      new Map(
        layoutNodes(
          onMap.map((n) => ({
            id: n.id,
            importance: n.importance,
            relationStrength: n.relationStrength,
          })),
        ).map((p) => [p.id, p]),
      ),
    [onMap],
  )

  return (
    <>
      {/* Constellation — desktop and tablet. */}
      <div className="relative hidden aspect-[16/10] w-full sm:block">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden>
          {onMap.map((node) => {
            const p = placed.get(node.id)
            if (!p) return null
            const active = selectedId === node.id
            return (
              <line
                key={node.id}
                x1={50}
                y1={50}
                x2={p.x}
                y2={p.y}
                stroke="currentColor"
                strokeWidth={active ? p.strokeWidth + 0.7 : p.strokeWidth}
                strokeOpacity={active ? 0.85 : selectedId ? p.strokeOpacity * 0.5 : p.strokeOpacity}
                className={active ? 'text-brand' : 'text-brand/70'}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
        </svg>

        <CentreWord lemma={lemma} />

        {onMap.map((node) => {
          const p = placed.get(node.id)
          if (!p) return null
          return (
            <div
              key={node.id}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 justify-center"
              style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${TIER[p.tier].widthPct}%` }}
            >
              <NodeCard
                node={node}
                tier={p.tier}
                selected={selectedId === node.id}
                dimmed={Boolean(selectedId) && selectedId !== node.id}
                onSelect={onSelect}
              />
            </div>
          )
        })}
      </div>

      {overflow.length ? (
        <div className="mt-2 hidden sm:block">
          <p className="mb-2 text-xs text-muted">그 밖의 연결</p>
          <div className="flex flex-wrap gap-2">
            {overflow.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                tier="peripheral"
                selected={selectedId === node.id}
                dimmed={false}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Phones get the same hierarchy without shrinking the type: the centre
          word, then nodes in importance order down a connecting rail. */}
      <div className="sm:hidden">
        <div className="mb-4 flex justify-center">
          <CentreWord lemma={lemma} inline />
        </div>
        <ol className="relative flex flex-col gap-2.5 pl-5">
          <span aria-hidden className="absolute bottom-4 left-1.5 top-0 w-px bg-line" />
          {[...nodes]
            .sort((a, b) => b.importance - a.importance)
            .map((node) => (
              <li key={node.id} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-3.5 top-1/2 h-px w-3 -translate-y-1/2 bg-line"
                />
                <NodeCard
                  node={node}
                  tier={tierFor(node.importance)}
                  selected={selectedId === node.id}
                  dimmed={false}
                  onSelect={onSelect}
                  fullWidth
                />
              </li>
            ))}
        </ol>
      </div>
    </>
  )
}

function tierFor(importance: number): SizeTier {
  if (importance >= 0.9) return 'hero'
  if (importance >= 0.7) return 'primary'
  if (importance >= 0.45) return 'secondary'
  return 'peripheral'
}

function CentreWord({ lemma, inline = false }: { lemma: string; inline?: boolean }) {
  return (
    <div
      className={cn(
        'z-10 flex items-center justify-center rounded-full border border-brand bg-brand text-center shadow-sm shadow-brand/20',
        inline ? 'h-20 w-20' : 'absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2',
      )}
    >
      <span
        className={cn(
          'px-2 font-semibold lowercase tracking-tight text-white',
          lemma.length <= 9 ? 'text-base' : lemma.length <= 13 ? 'text-sm' : 'text-xs',
        )}
      >
        {lemma}
      </span>
    </div>
  )
}

function NodeCard({
  node,
  tier,
  selected,
  dimmed,
  onSelect,
  fullWidth = false,
}: {
  node: SemanticNode
  tier: SizeTier
  selected: boolean
  dimmed: boolean
  onSelect: (id: string) => void
  fullWidth?: boolean
}) {
  const spec = TIER[tier]
  // Something both important and shaky is the reason the word was expanded, so
  // it stays legible before anything is selected.
  const urgent = node.recommended || (node.status === 'weak' && node.importance >= 0.7)

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      style={fullWidth ? undefined : { width: '100%' }}
      className={cn(
        'group rounded-xl border bg-surface text-left transition',
        fullWidth ? 'w-full px-4 py-3' : spec.pad,
        selected
          ? 'border-brand ring-1 ring-brand'
          : urgent
            ? 'border-brand/45 shadow-[0_1px_0_theme(colors.line)]'
            : 'border-line hover:border-brand/50',
        dimmed && !selected && 'opacity-45',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-muted">
          {node.eyebrow}
        </span>
        {node.recommended ? (
          <span className="shrink-0 text-[10px] font-semibold text-brand">· 추천</span>
        ) : null}
      </span>

      {/* Clamped on the map: the layout reserves a fixed footprint per tier, so a
          label that wrapped to a third line would overrun its neighbour. The
          list below the map renders the same node unclamped. */}
      <span
        className={cn(
          'mt-1 block font-semibold break-keep',
          fullWidth ? '' : 'line-clamp-2',
          spec.label,
        )}
      >
        {node.label}
      </span>

      <span className="mt-1.5 flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[node.status])} />
        <span className="truncate text-[11px] text-muted">
          {node.secondaryLabel ?? STATUS_LABEL[node.status]}
        </span>
      </span>
    </button>
  )
}

export function MapLegend() {
  const items: Array<[NodeStatus, string]> = [
    ['completed', '완료'],
    ['learning', '학습 중'],
    ['needsReview', '보완 필요'],
    ['weak', '약함'],
    ['unseen', '아직 안 봄'],
  ]
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {items.map(([status, label]) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  )
}
