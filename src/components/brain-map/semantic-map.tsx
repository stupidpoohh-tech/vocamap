'use client'

import { useId, useMemo } from 'react'
import {
  layoutNodes,
  MAP_CARD,
  MAP_CENTRE,
  MAP_MAX_NODES,
  MAP_MIN_WIDTH,
  mapFrameHeight,
} from '@/lib/learning/map-layout'
import {
  layoutMobileNodes,
  MOBILE_CENTRE,
  mobileFrameHeight,
  MOBILE_MAX_NODES,
} from '@/lib/learning/mobile-map-layout'
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

/**
 * Learning state, on its own palette.
 *
 * "Learning" used to be the brand colour, which made "this is selected" and
 * "you are part-way through this" the same shade — two unrelated facts sharing
 * one signal. The map's state colours are now a family of their own.
 */
/**
 * The wide map is drawn to scale, not to size.
 *
 * Its clearances were verified in pixels at a 600px frame, so every size here
 * is that measurement as a share of the frame — positions already were. The
 * map is then correct at any width its column happens to be, and grows into a
 * large screen instead of sitting in the middle of one at phone proportions.
 */
const share = (px: number) => `${(px / MAP_MIN_WIDTH) * 100}%`

const STATUS_DOT: Record<NodeStatus, string> = {
  completed: 'bg-data-known',
  learning: 'bg-data-learning',
  needsReview: 'bg-data-review',
  weak: 'bg-data-weak',
  unseen: 'bg-data-none',
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  completed: '완료',
  learning: '학습 중',
  needsReview: '보완 필요',
  weak: '약함',
  unseen: '아직 안 봄',
}

export function SemanticMap({
  lemma,
  nodes,
  selectedId,
  dimOthers = false,
  onSelect,
}: {
  lemma: string
  nodes: SemanticNode[]
  selectedId: string | null
  /** Fade the unselected nodes. Off until the reader picks one themselves. */
  dimOthers?: boolean
  onSelect: (id: string) => void
}) {
  // Which nodes belong on the map is decided upstream, where the curriculum
  // rule lives — a Brain Map is the few connections that must survive in the
  // student's head, not everything true about the word. Everything else sits
  // under it as a quiet row, so nothing a curator wrote becomes unreachable.
  // The slice is a rendering backstop, not the rule.
  const onMap = useMemo(
    () =>
      [...nodes]
        .sort((a, b) => b.importance - a.importance)
        .filter((n) => n.onMap)
        .slice(0, MAP_MAX_NODES),
    [nodes],
  )

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

  const height = mapFrameHeight(onMap.length)
  const fade = useId()

  return (
    <>
      {/* Constellation — desktop and tablet. */}
      <div
        className="@container relative mx-auto hidden w-full sm:block"
        style={{ aspectRatio: `${MAP_MIN_WIDTH} / ${height}` }}
      >
        <MapGround />

        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            {/* One paint for every connector: strong at the word, gone by the
                time it reaches a card. The lines then read as something the
                word radiates rather than as wires between boxes. */}
            <radialGradient id={fade} cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.62" />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0.22" />
            </radialGradient>
          </defs>
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
                stroke={active ? 'var(--color-brand)' : `url(#${fade})`}
                strokeWidth={active ? p.strokeWidth + 0.5 : p.strokeWidth}
                strokeOpacity={active ? 0.9 : selectedId ? 0.45 : 1}
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
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${p.x}%`, top: `${p.y}%`, width: share(MAP_CARD.width) }}
            >
              <NodeCard
                node={node}
                selected={selectedId === node.id}
                dimmed={dimOthers && selectedId !== node.id}
                onSelect={onSelect}
              />
            </div>
          )
        })}
      </div>

      {/* Phones get their own map, not this one at a smaller scale — see
          `MobileSemanticMap`. */}
      <MobileSemanticMap
        lemma={lemma}
        nodes={nodes}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </>
  )
}

/* ─────────────────────────────── on a phone ─────────────────────────────── */

/**
 * The same map, laid out for a narrow screen.
 *
 * This was a vertical list of cards, which is the one thing a Brain Map must
 * not be: a student scrolling past six stacked boxes learns that the word has
 * six attachments, not that they radiate from it. The centre word, the
 * connectors and three or four nodes now fit in a single frame at 320px, with
 * the rest behind an expand control rather than tacked on below.
 */
function MobileSemanticMap({
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
  const byImportance = useMemo(
    () => [...nodes].sort((a, b) => b.importance - a.importance),
    [nodes],
  )
  // Everything the frame can hold, always. There was an expand control here,
  // which meant the map arrived saying it was incomplete — the opposite of
  // "these are the connections of this word".
  const visible = byImportance.slice(0, MOBILE_MAX_NODES)

  const placed = useMemo(
    () =>
      new Map(
        layoutMobileNodes(
          visible.map((n) => ({
            id: n.id,
            importance: n.importance,
            relationStrength: n.relationStrength,
          })),
        ).map((p) => [p.id, p]),
      ),
    [visible],
  )

  const height = mobileFrameHeight(visible.length)
  const fade = useId()

  return (
    <div className="sm:hidden">
      {/* Full-bleed: the page's side padding costs the map 40px it needs to
          keep two nodes and the word on one line at 320px. */}
      <div className="relative -mx-5" style={{ height }}>
        <MapGround />

        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <radialGradient id={fade} cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.62" />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0.22" />
            </radialGradient>
          </defs>
          {visible.map((node) => {
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
                stroke={active ? 'var(--color-brand)' : `url(#${fade})`}
                strokeWidth={active ? p.strokeWidth + 0.5 : p.strokeWidth}
                strokeOpacity={active ? 0.9 : 1}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
        </svg>

        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-brand-line/70"
          style={{ height: MOBILE_CENTRE.height + 22, width: MOBILE_CENTRE.width + 22 }}
        />
        {/* Soft rounded rather than a strict circle: a circle wide enough for
            one syllable clipped every real headword. */}
        <div
          className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-core px-3"
          style={{ height: MOBILE_CENTRE.height, maxWidth: MOBILE_CENTRE.width }}
        >
          <span className="truncate text-[13px] font-medium lowercase tracking-[-0.015em] text-white">
            {lemma}
          </span>
        </div>

        {visible.map((node) => {
          const p = placed.get(node.id)
          if (!p) return null
          return (
            <div
              key={node.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.width }}
            >
              <MobileNode node={node} selected={selectedId === node.id} onSelect={onSelect} />
            </div>
          )
        })}
      </div>

    </div>
  )
}

/**
 * The connections that did not fit the map.
 *
 * Rendered below the practice card rather than between it and the map: the two
 * of them are what the screen is for and they have to sit together on one phone
 * height. Always visible — never behind an expand control.
 */
export function MapOverflow({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: SemanticNode[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const rest = useMemo(() => {
    const byImportance = [...nodes].sort((a, b) => b.importance - a.importance)
    const placed = new Set(
      byImportance.filter((n) => n.onMap).slice(0, MAP_MAX_NODES).map((n) => n.id),
    )
    // A phone places more than the wide map does, so anything on either is out.
    for (const node of byImportance.slice(0, MOBILE_MAX_NODES)) placed.add(node.id)
    return byImportance.filter((n) => !placed.has(n.id))
  }, [nodes])

  if (!rest.length) return null

  return (
    <div>
      <p className="text-xs text-ink-3">그 밖의 연결</p>
      <ul className="mt-1 divide-y divide-line-soft border-t border-line">
        {rest.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              aria-pressed={selectedId === node.id}
              className="flex w-full items-baseline gap-2.5 py-2 text-left"
            >
              <span
                aria-hidden
                className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[node.status])}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[0.8125rem] break-keep',
                  selectedId === node.id ? 'text-brand' : 'text-ink',
                )}
              >
                {node.label}
              </span>
              <span className="shrink-0 truncate text-[0.6875rem] text-ink-3">{node.eyebrow}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A node at phone size: the vocabulary, at most two lines, and a status dot.
 * No gloss paragraph — long text belongs in the workspace below, not in a card
 * the reader is meant to take in at a glance.
 */
function MobileNode({
  node,
  selected,
  onSelect,
}: {
  node: SemanticNode
  selected: boolean
  onSelect: (id: string) => void
}) {
  const urgent = node.recommended || (node.status === 'weak' && node.importance >= 0.7)

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      className={cn(
        // Same family as the wide map's cards.
        'w-full rounded-card bg-surface px-2 py-1.5 text-left shadow-card ring-1 transition',
        selected ? 'bg-brand-soft ring-brand' : urgent ? 'ring-brand-line' : 'ring-line',
      )}
    >
      <span className="flex items-center gap-1">
        <span className={cn('h-1 w-1 shrink-0 rounded-full', STATUS_DOT[node.status])} />
        <span className="truncate text-[9px] text-ink-3">{node.eyebrow}</span>
        {node.recommended ? (
          <span className="ml-auto shrink-0 text-[9px] text-brand">추천</span>
        ) : null}
      </span>
      <span
        className={cn(
          'mt-0.5 line-clamp-2 text-[12px] leading-[1.35] break-keep',
          // Importance shows in weight as well as in size and distance, which
          // is what stops the map reading as a menu of equals.
          node.importance >= 0.85 ? 'font-medium text-ink' : 'text-ink',
        )}
      >
        {node.label}
      </span>
    </button>
  )
}

/**
 * The ground the map is drawn on.
 *
 * Not a card — no border, no edge you can point at. Just the faintest light
 * gathering where the word is, so the middle of the frame reads as the middle
 * of something rather than as an empty patch of page. It is what makes the map
 * a place instead of a group of boxes.
 */
function MapGround() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          'radial-gradient(58% 60% at 50% 50%, var(--color-brand-soft) 0%, transparent 70%)',
      }}
    />
  )
}

/**
 * The word itself, at the centre of the map.
 *
 * Near-black, not brand-coloured. It anchors the map by being the darkest
 * thing on the screen, which leaves the accent free to mean "this is the one
 * you are working on" — and stops the screen reading as a purple app.
 *
 * The ring around it is the orbit its branches sit on. One hairline, drawn
 * once; it does more for the map's identity than any amount of decoration.
 */
function CentreWord({ lemma }: { lemma: string }) {
  return (
    <>
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-brand-line/70"
        style={{ width: share(MAP_CENTRE + 30), aspectRatio: '1' }}
      />
      <div
        className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-core text-center"
        style={{ width: share(MAP_CENTRE), aspectRatio: '1' }}
      >
        <span
          className="px-3 font-medium lowercase tracking-[-0.015em] text-white"
          style={{ fontSize: 'clamp(1rem, 2.9cqw, 1.3rem)' }}
        >
          {lemma}
        </span>
      </div>
    </>
  )
}

function NodeCard({
  node,
  selected,
  dimmed,
  onSelect,
}: {
  node: SemanticNode
  selected: boolean
  dimmed: boolean
  onSelect: (id: string) => void
}) {
  // Something both important and shaky is the reason the word was expanded, so
  // it stays legible before anything is selected.
  const urgent = node.recommended || (node.status === 'weak' && node.importance >= 0.7)

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      style={{ aspectRatio: `${MAP_CARD.width} / ${MAP_CARD.height}` }}
      className={cn(
        // Objects on a canvas, so: a hairline and the barest lift. The panel
        // below is the screen's one raised surface, and a ring of cards with
        // the same shadow would flatten the difference between "here is the
        // structure" and "here is what you are doing".
        'flex w-full flex-col justify-center overflow-hidden rounded-card bg-surface text-left',
        'px-[7%] shadow-card ring-1 transition duration-200',
        selected
          ? 'bg-brand-soft ring-brand'
          : urgent
            ? 'ring-brand-line hover:ring-brand/45'
            : 'ring-line hover:ring-ink-3/40',
        dimmed && !selected && 'opacity-45',
      )}
    >
      {/* The status dot rides in front of the category, where the mock has a
          bullet. One row instead of two, and the colour is doing the work the
          third line used to do in words. */}
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[node.status])}
        />
        <span
          className="truncate tracking-[0.02em] text-ink-3"
          style={{ fontSize: 'clamp(0.6875rem, 1.9cqw, 0.8125rem)' }}
        >
          {node.eyebrow}
        </span>
        {node.recommended ? (
          <span
            className="ml-auto shrink-0 text-brand"
            style={{ fontSize: 'clamp(0.6875rem, 1.9cqw, 0.8125rem)' }}
          >
            추천
          </span>
        ) : null}
      </span>

      {/* Clamped on the map: the frame reserves a fixed footprint per card, so
          a label that wrapped to a third line would overrun its neighbour. The
          list below the map renders the same node unclamped. */}
      <span
        className={cn(
          'mt-1.5 line-clamp-2 leading-[1.35] tracking-[-0.006em] break-keep',
          // Importance shows in weight now that every card is one size.
          node.importance >= 0.85 ? 'font-medium text-ink' : 'text-ink',
        )}
        style={{ fontSize: 'clamp(0.9375rem, 2.6cqw, 1.0625rem)' }}
      >
        {node.label}
      </span>
    </button>
  )
}

export function MapLegend({ statuses }: { statuses: NodeStatus[] }) {
  // Only the states this word actually has. A fixed five-colour key asked the
  // reader to memorise four things that were not on the map in front of them.
  const present = ORDERED_STATUS.filter((status) => statuses.includes(status))
  if (present.length < 2) return null

  return (
    <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-ink-3 sm:mt-3">
      {present.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} aria-hidden />
          {STATUS_LABEL[status]}
        </li>
      ))}
    </ul>
  )
}

const ORDERED_STATUS: NodeStatus[] = ['weak', 'needsReview', 'learning', 'completed', 'unseen']
