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

/**
 * The most the frame can place without crowding at 320px.
 *
 * There is no smaller "opening" count: the map shows every connection it can
 * hold from the start. Hiding some behind an expand control made the map
 * announce that it was incomplete, which is the opposite of what it is for.
 */
export const MOBILE_MAX_NODES = 6

/** Frame height in px, per node count. Wide enough that nothing scrolls. */
const FRAME_HEIGHT: Record<number, number> = {
  1: 212,
  2: 232,
  3: 256,
  4: 252,
  5: 272,
  6: 272,
}

/**
 * Slot tables, ordered most important first.
 *
 * Every row was checked numerically at a 320px-wide frame against the 96x64
 * centre word and the 65px a two-line card actually measures in the browser,
 * with 3px of clearance required rather than mere non-overlap: no card comes
 * near the centre, its neighbours, or the frame edge, and the first slot is
 * always the one nearest the centre.
 *
 * The frames are as short as those clearances allow, because the map and the
 * practice card have to share one phone height without scrolling.
 */
const SLOTS: Record<number, MobileSlot[]> = {
  1: [{ x: 50, y: 17, width: 128 }],
  2: [
    { x: 50, y: 16, width: 126 },
    { x: 50, y: 84, width: 118 },
  ],
  3: [
    { x: 50, y: 15, width: 124 },
    { x: 19, y: 78, width: 102 },
    { x: 81, y: 78, width: 102 },
  ],
  4: [
    { x: 50, y: 22, width: 124 },
    { x: 15, y: 50, width: 96 },
    { x: 85, y: 50, width: 96 },
    { x: 50, y: 85, width: 112 },
  ],
  5: [
    { x: 50, y: 20, width: 122 },
    { x: 15, y: 50, width: 92 },
    { x: 85, y: 50, width: 92 },
    { x: 27, y: 82, width: 96 },
    { x: 73, y: 82, width: 96 },
  ],
  6: [
    { x: 50, y: 21, width: 118 },
    { x: 15, y: 39, width: 88 },
    { x: 85, y: 39, width: 88 },
    { x: 15, y: 65, width: 86 },
    { x: 85, y: 65, width: 86 },
    { x: 50, y: 87, width: 102 },
  ],
}

/**
 * The centre word's box, in px. A circle wide enough for one syllable clipped
 * every real headword, so it is a soft rounded rect that fits a lemma — and
 * every slot above is placed to clear it at 320px.
 */
export const MOBILE_CENTRE = { width: 96, height: 64 }

export function mobileFrameHeight(count: number): number {
  return FRAME_HEIGHT[clampCount(count)] ?? FRAME_HEIGHT[MOBILE_MAX_NODES]!
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
      strokeOpacity: 0.5 + strength * 0.45,
    }
  })
}

function clampCount(count: number): number {
  return Math.min(MOBILE_MAX_NODES, Math.max(1, count))
}
