'use client'

import { useMemo } from 'react'
import {
  layoutNodes,
  MAP_CARD,
  MAP_CENTRE,
  MAP_MAX_NODES,
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

  return (
    <>
      {/* Constellation — desktop and tablet. */}
      {/* Height is set per node count rather than by an aspect ratio: the
          clearances between a card, its neighbours and the word are measured in
          pixels, so the frame that guarantees them has to be too. */}
      <div className="relative mx-auto hidden w-full sm:block" style={{ height }}>
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
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
                strokeOpacity={active ? 1 : selectedId ? p.strokeOpacity * 0.55 : p.strokeOpacity}
                // Drawn in the brand, not in ink. The connectors are the one
                // part of the map that is pure structure, and tinting them is
                // what makes the word and its branches read as a single object
                // rather than as cards that happen to have lines behind them.
                className={active ? 'text-brand' : 'text-brand-line'}
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
              style={{ left: `${p.x}%`, top: `${p.y}%`, width: MAP_CARD.width }}
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

  return (
    <div className="sm:hidden">
      {/* Full-bleed: the page's side padding costs the map 40px it needs to
          keep two nodes and the word on one line at 320px. */}
      <div className="relative -mx-5" style={{ height }}>
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
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
                stroke="currentColor"
                strokeWidth={active ? p.strokeWidth + 0.6 : p.strokeWidth}
                strokeOpacity={active ? 0.9 : p.strokeOpacity}
                className={active ? 'text-brand' : 'text-brand-line'}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
        </svg>

        {/* Soft rounded rather than a strict circle: a circle wide enough for
            one syllable clipped every real headword. */}
        <div
          className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand px-3"
          style={{ height: MOBILE_CENTRE.height, maxWidth: MOBILE_CENTRE.width }}
        >
          <span className="truncate text-[13px] font-medium lowercase tracking-tight text-white">
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
        // Same family as the wide map's cards: lifted, not outlined.
        'w-full rounded-card bg-surface px-2 py-1.5 text-left shadow-card ring-1 transition',
        selected ? 'ring-brand' : urgent ? 'ring-brand-line' : 'ring-line/70',
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
          'mt-0.5 line-clamp-2 block text-[12px] leading-[1.35] break-keep',
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

/** The word itself, at the centre of the desktop map. */
function CentreWord({ lemma }: { lemma: string }) {
  return (
    <div
      className={cn(
        // The one filled shape on the map, and the only place the brand colour
        // appears at full strength. Everything orbiting it is drawn in ink.
        'absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2',
        'items-center justify-center rounded-full bg-brand text-center',
      )}
      style={{ width: MAP_CENTRE, height: MAP_CENTRE }}
    >
      <span className="px-3 text-[1.0625rem] font-medium lowercase tracking-tight text-white">
        {lemma}
      </span>
    </div>
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
      style={{ height: MAP_CARD.height }}
      className={cn(
        // Lifted rather than outlined. A ring of hairline boxes reads as a
        // form; a ring of cards that sit slightly above the page reads as a
        // diagram, which is what this is.
        'flex w-full flex-col justify-center rounded-container bg-surface px-3.5 text-left',
        'shadow-card ring-1 transition',
        selected
          ? 'ring-brand'
          : urgent
            ? 'ring-brand-line hover:ring-brand/50'
            : 'ring-line/70 hover:ring-brand-line',
        dimmed && !selected && 'opacity-40',
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
        <span className="truncate text-[0.6875rem] text-ink-3">{node.eyebrow}</span>
        {node.recommended ? (
          <span className="ml-auto shrink-0 text-[0.6875rem] text-brand">추천</span>
        ) : null}
      </span>

      {/* Clamped on the map: the frame reserves a fixed footprint per card, so
          a label that wrapped to a third line would overrun its neighbour. The
          list below the map renders the same node unclamped. */}
      <span
        className={cn(
          'mt-1.5 line-clamp-2 block text-[0.9375rem] leading-snug break-keep',
          // Importance shows in weight now that every card is one size.
          node.importance >= 0.85 ? 'font-medium text-ink' : 'text-ink',
        )}
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
