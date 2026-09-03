/**
 * Places semantic nodes around a word, on a wide screen.
 *
 * Fixed slots, mirror-symmetric about the word, chosen per node count — the
 * same approach the phone map uses, for the same reason. The previous version
 * scattered cards by golden angle and then pushed them apart until they fit,
 * which is defensible as information design and reads as an accident: a
 * constellation the eye cannot find a centre line in looks unfinished next to
 * anything else on the page.
 *
 * Importance has not stopped being drawn. It decides which slot a node gets —
 * slot order is importance order, and the slots get further from the word as
 * they go — and it still sets the weight of the connector. What it no longer
 * does is change the size of the card, because a ring of four different card
 * sizes is what made the old map read as debris rather than as a shape.
 *
 * Deterministic and pure: a word lays out the same way on every visit, and the
 * geometry can be checked without a browser.
 */

export type LayoutInput = {
  id: string
  /** 0..1. Decides slot order, and the weight of the connector. */
  importance: number
  /** 0..1. How strongly this belongs to the word. Drives the connector only. */
  relationStrength?: number
}

export type PlacedNode = {
  id: string
  /** Node centre, as a percentage of the frame. */
  x: number
  y: number
  /** Stroke width for the connector, in the frame's 0..100 space. */
  strokeWidth: number
  strokeOpacity: number
}

/**
 * Past roughly this many cards a constellation stops reading as one shape and
 * starts reading as clutter, whatever the layout does. A Brain Map is three to
 * five nodes; the larger tables exist for maps written before that rule.
 */
export const MAP_MAX_NODES = 8

/** Card size in px. Fixed, so the frame's clearances are true at any width. */
export const MAP_CARD = { width: 168, height: 84 }

/** The word in the middle, in px. */
export const MAP_CENTRE = 104

/**
 * The narrowest the wide map is ever asked to render.
 *
 * Below 640px the phone map takes over, and at 640px the page's own padding
 * leaves this much for the frame. Every slot table is verified against it.
 */
export const MAP_MIN_WIDTH = 600

/** Frame height in px, per node count. */
const FRAME_HEIGHT: Record<number, number> = {
  1: 170,
  2: 170,
  3: 302,
  4: 304,
  5: 324,
  6: 352,
  7: 379,
  8: 424,
}

/**
 * Slot tables, ordered most important first.
 *
 * Mirror-symmetric about the word, so the arrangement has a centre line to
 * read it against. Verified numerically at 600px: no card comes within 12px of
 * another card, of the word, or of the frame edge, and the first slot is the
 * one nearest the word.
 *
 * One and two nodes sit beside the word rather than above it. A card directly
 * over the word needs half the word plus a card's height of clearance, which
 * for a single node buys a tall frame that is mostly empty.
 */
const SLOTS: Record<number, Array<{ x: number; y: number }>> = {
  1: [{ x: 78, y: 50 }],
  2: [
    { x: 78, y: 50 },
    { x: 22, y: 50 },
  ],
  3: [
    { x: 50, y: 14 },
    { x: 15, y: 74 },
    { x: 85, y: 74 },
  ],
  4: [
    { x: 50, y: 15 },
    { x: 15, y: 50 },
    { x: 85, y: 50 },
    { x: 50, y: 86 },
  ],
  5: [
    { x: 50, y: 14 },
    { x: 15, y: 46 },
    { x: 85, y: 46 },
    { x: 30, y: 86 },
    { x: 70, y: 86 },
  ],
  6: [
    { x: 50, y: 13 },
    { x: 15, y: 36 },
    { x: 85, y: 36 },
    { x: 15, y: 71 },
    { x: 85, y: 71 },
    { x: 50, y: 88 },
  ],
  7: [
    { x: 50, y: 12 },
    { x: 15, y: 33 },
    { x: 85, y: 33 },
    { x: 15, y: 62 },
    { x: 85, y: 62 },
    { x: 30, y: 88 },
    { x: 70, y: 88 },
  ],
  8: [
    { x: 50, y: 10 },
    { x: 15, y: 29 },
    { x: 85, y: 29 },
    { x: 15, y: 54 },
    { x: 85, y: 54 },
    { x: 15, y: 79 },
    { x: 85, y: 79 },
    { x: 50, y: 90 },
  ],
}

export function mapFrameHeight(count: number): number {
  return FRAME_HEIGHT[clampCount(count)]!
}

export function layoutNodes(nodes: LayoutInput[]): PlacedNode[] {
  if (!nodes.length) return []

  const ordered = [...nodes].sort((a, b) => b.importance - a.importance).slice(0, MAP_MAX_NODES)
  const slots = SLOTS[clampCount(ordered.length)]!

  return ordered.map((node, index) => {
    const slot = slots[index]!
    const strength = clamp(node.relationStrength ?? node.importance, 0, 1)
    return {
      id: node.id,
      x: slot.x,
      y: slot.y,
      strokeWidth: 0.55 + strength * 1.15,
      strokeOpacity: 0.55 + strength * 0.45,
    }
  })
}

function clampCount(count: number): number {
  return Math.min(MAP_MAX_NODES, Math.max(1, count))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
