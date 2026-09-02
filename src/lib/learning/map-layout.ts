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

/**
 * Half-extents per tier, in the same 0..100 space as the positions.
 *
 * Vertical extents are relatively large because the box is wider than it is
 * tall — one unit of y covers fewer pixels than one unit of x — and because
 * labels wrap to two lines. Sizing these from a single line is what let cards
 * overlap.
 */
const FOOTPRINT: Record<SizeTier, { w: number; h: number }> = {
  hero: { w: 13.5, h: 12 },
  primary: { w: 11.5, h: 12 },
  secondary: { w: 10, h: 11 },
  peripheral: { w: 8.5, h: 10 },
}

const CENTRE = { x: 50, y: 50 }
/**
 * Keeps nodes clear of the central word. Uniform on purpose: scaling it by the
 * card's own height pushed the biggest cards furthest out, which inverted the
 * one thing the distance is supposed to say.
 */
const CENTRE_CLEARANCE = 26
const GOLDEN_ANGLE = 137.508
/**
 * Positions are a circle in the box's own 0..100 space, which the box's 16:10
 * aspect renders as an ellipse. That is deliberate: nodes of equal importance
 * land on one ring the reader can see, and squashing the circle to compensate
 * would only make the ring stop being a ring.
 */
const PASSES = 400

/**
 * A fixed outer radius only fits a handful of cards; past that the relaxation
 * pass has nowhere to put them and they end up stacked. The ring widens with
 * the number of nodes instead.
 */
function maxRadius(count: number): number {
  return Math.min(48, 32 + count * 1.3)
}

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
 *
 * The relaxation works in polar coordinates on purpose. Pushing cards apart in
 * x/y is simpler, but it moves them radially, and radius is the one thing that
 * has to keep meaning importance — a confusable the student keeps failing
 * ended up further out than a derived form that way. Here overlaps are
 * resolved by sliding cards *around* the word, and a card is only allowed to
 * drift outward when there is genuinely no room at its own radius — and then
 * only the less important card of the pair.
 */
export function layoutNodes(nodes: LayoutInput[]): PlacedNode[] {
  if (!nodes.length) return []

  // Most important first: the sweep below always yields to the earlier node, so
  // this is what makes "more important stays closer" hold.
  const ordered = [...nodes].sort((a, b) => b.importance - a.importance)

  const outer = maxRadius(ordered.length)

  const polar: Polar[] = ordered.map((node, index) => {
    const seed = hash(node.id)
    const importance = clamp(node.importance, 0, 1)

    // Deliberately not evenly spaced: the golden angle never repeats a
    // direction, and the jitter breaks any residual regularity.
    // Jitter goes into the angle only. A radial wobble reads as noise on the
    // one channel that has to stay readable: a node 1.5 units closer than a
    // more important one is a lie about which one matters.
    const angle = ((index * GOLDEN_ANGLE + seed * 34 - 17) * Math.PI) / 180
    const radius = CENTRE_CLEARANCE + (1 - importance) * (outer - CENTRE_CLEARANCE)

    return {
      id: node.id,
      angle,
      radius,
      tier: sizeTier(importance),
      strokeWidth: 0.55 + (node.relationStrength ?? importance) * 1.15,
      strokeOpacity: 0.22 + (node.relationStrength ?? importance) * 0.42,
    }
  })

  relax(polar)

  return polar.map((node) => ({
    id: node.id,
    x: CENTRE.x + Math.cos(node.angle) * node.radius,
    y: CENTRE.y + Math.sin(node.angle) * node.radius ,
    tier: node.tier,
    strokeWidth: node.strokeWidth,
    strokeOpacity: node.strokeOpacity,
  }))
}

type Polar = {
  id: string
  angle: number
  radius: number
  tier: SizeTier
  strokeWidth: number
  strokeOpacity: number
}

/** How far the box lets a card at this angle sit before it clips an edge. */
function radiusLimit(angle: number, tier: SizeTier): number {
  const f = FOOTPRINT[tier]
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  const byX = cos < 1e-6 ? Infinity : (49 - f.w) / cos
  const byY = sin < 1e-6 ? Infinity : (49 - f.h) / sin
  return Math.max(CENTRE_CLEARANCE, Math.min(byX, byY))
}

function relax(nodes: Polar[]): void {
  for (let pass = 0; pass < PASSES; pass += 1) {
    // Radial relief is a last resort, so it only switches on once sliding
    // around the word has had a fair chance to work.
    const radialRelief = pass > PASSES * 0.4

    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]!
      const fa = FOOTPRINT[a.tier]

      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]!
        const fb = FOOTPRINT[b.tier]

        const dx = b.radius * Math.cos(b.angle) - a.radius * Math.cos(a.angle)
        const dy = b.radius * Math.sin(b.angle) - a.radius * Math.sin(a.angle)
        const overlapX = fa.w + fb.w - Math.abs(dx)
        const overlapY = fa.h + fb.h - Math.abs(dy)
        if (overlapX <= 0 || overlapY <= 0) continue

        // Smallest translation that separates the two cards.
        const push =
          overlapX < overlapY
            ? { x: (overlapX / 2) * (dx >= 0 ? 1 : -1), y: 0 }
            : { x: 0, y: (overlapY / 2) * (dy >= 0 ? 1 : -1) }

        // `a` is the more important of the two, so it gives less ground.
        slide(a, -push.x * 0.35, -push.y * 0.35)
        slide(b, push.x * 0.65, push.y * 0.65)

        if (radialRelief) {
          // Only outward, and only for the less important card, so the pair
          // never ends up in the wrong order.
          const outward = push.x * Math.cos(b.angle) + push.y * Math.sin(b.angle)
          if (outward > 0) b.radius += outward * 0.3
        }
      }

      a.radius = clamp(a.radius, CENTRE_CLEARANCE, radiusLimit(a.angle, a.tier))
    }

    // Radial relief can push a card past one that matters less than it does.
    // `nodes` is sorted by importance, so making the radii non-decreasing along
    // it restores the invariant — by pulling the stronger card back in, never by
    // pushing the weaker one further out into the margin. Inside the loop, so
    // the remaining passes clear any overlap this reopens.
    for (let i = nodes.length - 2; i >= 0; i -= 1) {
      const here = nodes[i]!
      here.radius = Math.min(here.radius, nodes[i + 1]!.radius)
    }
  }
}

/** Turns a cartesian nudge into rotation around the word, dropping the rest. */
function slide(node: Polar, dx: number, dy: number): void {
  const tangential = -dx * Math.sin(node.angle) + dy * Math.cos(node.angle)
  node.angle += tangential / Math.max(node.radius, 1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
