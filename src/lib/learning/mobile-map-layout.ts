/**
 * Where the nodes go on a phone.
 *
 * Deliberately not the desktop layout at a smaller scale. That algorithm packs
 * cards onto a ring sized in percentages, which at 320px either shrinks the
 * type past reading size or overlaps — and shrinking a constellation is how the
 * mobile map became a vertical list of cards in the first place, losing the one
 * thing a map is for.
 *
 * So: fixed slots, chosen per node count, verified to clear the centre word and
 * each other at the narrowest phone. Slot order is importance order, and the
 * slots get further from the centre as they go, so distance still means what it
 * means on desktop.
 *
 * Pure — no React, no DOM — so the geometry can be tested directly.
 */

export type MobileSlot = {
  /** Node centre, as a percentage of the frame. */
  x: number
  y: number
  /** Card width in px. Fixed, because a percentage of 320 is unreadable. */
  width: number
}

export type MobilePlacement = MobileSlot & {
  id: string
  /** Stroke width for the connector, in the frame's 0..100 space. */
  strokeWidth: number
  strokeOpacity: number
}

/** How many nodes the map opens with. The rest wait behind "+N개 연결". */
export const MOBILE_DEFAULT_NODES = 4
/** The most the frame can hold without crowding, once expanded. */
export const MOBILE_MAX_NODES = 6

/** Frame height in px, per node count. Wide enough that nothing scrolls. */
const FRAME_HEIGHT: Record<number, number> = {
  1: 260,
  2: 288,
  3: 320,
  4: 344,
  5: 372,
  // Only reached once the reader asks for more, so it is allowed past the
  // at-a-glance height the default view keeps to.
  6: 420,
}

/**
 * Slot tables, ordered most important first.
 *
 * Each row was checked at a 320px frame against a 60px centre and a card up to
 * 72px tall: no card crosses the centre word, its neighbours, or the frame.
 */
const SLOTS: Record<number, MobileSlot[]> = {
  1: [{ x: 50, y: 19, width: 126 }],
  2: [
    { x: 50, y: 22, width: 124 },
    { x: 50, y: 80, width: 116 },
  ],
  3: [
    { x: 50, y: 20, width: 124 },
    { x: 19, y: 68, width: 100 },
    { x: 81, y: 68, width: 100 },
  ],
  4: [
    { x: 50, y: 22, width: 124 },
    { x: 16, y: 47, width: 94 },
    { x: 84, y: 47, width: 94 },
    { x: 50, y: 83, width: 110 },
  ],
  5: [
    { x: 50, y: 22, width: 122 },
    { x: 15, y: 46, width: 90 },
    { x: 85, y: 46, width: 90 },
    { x: 28, y: 84, width: 96 },
    { x: 72, y: 84, width: 96 },
  ],
  6: [
    { x: 50, y: 23, width: 118 },
    { x: 15, y: 45, width: 88 },
    { x: 85, y: 45, width: 88 },
    { x: 15, y: 74, width: 86 },
    { x: 85, y: 74, width: 86 },
    { x: 50, y: 90, width: 102 },
  ],
}

/**
 * The centre word's box, in px. A circle wide enough for one syllable clipped
 * every real headword, so it is a soft rounded rect that fits a lemma — and
 * every slot above is placed to clear it at 320px.
 */
export const MOBILE_CENTRE = { width: 92, height: 60 }

export function mobileFrameHeight(count: number): number {
  return FRAME_HEIGHT[clampCount(count)] ?? FRAME_HEIGHT[MOBILE_DEFAULT_NODES]!
}

export type MobileInput = { id: string; importance: number; relationStrength?: number }

/**
 * Assigns nodes to slots, strongest first, and derives each connector's weight.
 * Anything past the last slot is not placed — the caller shows it behind the
 * expand control rather than squeezing it in.
 */
export function layoutMobileNodes(nodes: MobileInput[]): MobilePlacement[] {
  if (!nodes.length) return []

  const ordered = [...nodes].sort((a, b) => b.importance - a.importance)
  const slots = SLOTS[clampCount(ordered.length)] ?? SLOTS[MOBILE_MAX_NODES]!

  return ordered.slice(0, slots.length).map((node, index) => {
    const slot = slots[index]!
    const strength = node.relationStrength ?? node.importance
    return {
      id: node.id,
      ...slot,
      // A visible spread, but nothing thick enough to compete with the cards.
      strokeWidth: 0.5 + strength * 0.9,
      strokeOpacity: 0.2 + strength * 0.35,
    }
  })
}

function clampCount(count: number): number {
  return Math.min(MOBILE_MAX_NODES, Math.max(1, count))
}
