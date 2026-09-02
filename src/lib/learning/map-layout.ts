/**
 * Places semantic nodes around a word.
 *
 * The old map put five category cards at five fixed angles, all the same size.
 * That reads as a menu, and a menu cannot say which of these things matters or
 * which one you are weak at. This lays out arbitrary nodes so that importance
 * is legible without a legend: important nodes are larger and sit closer in.
 *
 * Deterministic — a word always lays out the same way, so the map does not
 * rearrange itself under the reader between visits. Pure, so it can be tested
 * without a browser.
 */

export type SizeTier = 'hero' | 'primary' | 'secondary' | 'peripheral'

export type LayoutInput = {
  id: string
  /** 0..1. Drives size, distance from centre and link weight. */
  importance: number
  /** 0..1. How strongly this belongs to the word. Drives the connector only. */
  relationStrength?: number
}

export type PlacedNode = {
  id: string
  /** Percentages within the map box, node centre. */
  x: number
  y: number
  tier: SizeTier
  /** Stroke width for the connector, in viewBox units. */
  strokeWidth: number
  strokeOpacity: number
}

export function sizeTier(importance: number): SizeTier {
  if (importance >= 0.9) return 'hero'
  if (importance >= 0.7) return 'primary'
  if (importance >= 0.45) return 'secondary'
  return 'peripheral'
}

/** Half-extents per tier, in the same 0..100 space as the positions. */
const FOOTPRINT: Record<SizeTier, { w: number; h: number }> = {
  hero: { w: 16, h: 9 },
  primary: { w: 14, h: 8 },
  secondary: { w: 12, h: 7 },
  peripheral: { w: 10, h: 6 },
}

const CENTRE = { x: 50, y: 50 }
/** Keeps nodes clear of the central word. */
const CENTRE_CLEARANCE = 15
const MIN_RADIUS = 23
const MAX_RADIUS = 41
const GOLDEN_ANGLE = 137.508

/** FNV-1a. Small, stable, and good enough to scatter angles reproducibly. */
function hash(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0xffffffff
}

/**
 * Golden-angle placement, perturbed per node so the result never reads as a
 * regular polygon, then relaxed so cards do not overlap.
 */
export function layoutNodes(nodes: LayoutInput[]): PlacedNode[] {
  if (!nodes.length) return []

  // Most important first, so the strongest nodes claim their spot before the
  // relaxation pass starts pushing things around.
  const ordered = [...nodes].sort((a, b) => b.importance - a.importance)

  const placed = ordered.map((node, index) => {
    const seed = hash(node.id)
    const importance = clamp(node.importance, 0, 1)

    // Deliberately not evenly spaced: the golden angle never repeats a
    // direction, and the jitter breaks any residual regularity.
    const angle = ((index * GOLDEN_ANGLE + seed * 34 - 17) * Math.PI) / 180
    const radius =
      MIN_RADIUS + (1 - importance) * (MAX_RADIUS - MIN_RADIUS) + (seed - 0.5) * 5

    const tier = sizeTier(importance)
    return {
      id: node.id,
      x: CENTRE.x + Math.cos(angle) * radius,
      y: CENTRE.y + Math.sin(angle) * radius * 0.95,
      tier,
      strokeWidth: 0.55 + (node.relationStrength ?? importance) * 1.15,
      strokeOpacity: 0.22 + (node.relationStrength ?? importance) * 0.42,
    }
  })

  relax(placed)
  return placed
}

/**
 * Pushes overlapping cards apart, away from the centre, and back inside the
 * box. Few enough nodes that a fixed iteration count is plenty.
 */
function relax(nodes: PlacedNode[]): void {
  for (let pass = 0; pass < 90; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]!
      const fa = FOOTPRINT[a.tier]

      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]!
        const fb = FOOTPRINT[b.tier]

        const dx = b.x - a.x
        const dy = b.y - a.y
        const overlapX = fa.w + fb.w - Math.abs(dx)
        const overlapY = fa.h + fb.h - Math.abs(dy)
        if (overlapX <= 0 || overlapY <= 0) continue

        // Separate along whichever axis needs the least movement.
        if (overlapX < overlapY) {
          const push = (overlapX / 2) * (dx >= 0 ? 1 : -1) * 0.55
          a.x -= push
          b.x += push
        } else {
          const push = (overlapY / 2) * (dy >= 0 ? 1 : -1) * 0.55
          a.y -= push
          b.y += push
        }
      }

      // Out of the central word's way. The clearance has to follow the card's
      // own extent in the direction it sits, or a wide card placed level with
      // the centre still lands on top of it.
      const dx = a.x - CENTRE.x
      const dy = a.y - CENTRE.y
      const distance = Math.hypot(dx, dy) || 0.001
      const reach =
        (Math.abs(dx) / distance) * fa.w + (Math.abs(dy) / distance) * fa.h
      const minimum = CENTRE_CLEARANCE + reach
      if (distance < minimum) {
        a.x = CENTRE.x + (dx / distance) * minimum
        a.y = CENTRE.y + (dy / distance) * minimum
      }

      a.x = clamp(a.x, fa.w + 1, 100 - fa.w - 1)
      a.y = clamp(a.y, fa.h + 1, 100 - fa.h - 1)
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
