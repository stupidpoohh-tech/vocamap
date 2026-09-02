import { describe, expect, it } from 'vitest'
import { layoutNodes, sizeTier, type LayoutInput } from '@/lib/learning/map-layout'

// Measured from the rendered cards, not guessed — the first version of these
// was too narrow and let cards overlap on screen while the test passed.
const FOOTPRINT = {
  hero: { w: 13.5, h: 12 },
  primary: { w: 11.5, h: 12 },
  secondary: { w: 10, h: 11 },
  peripheral: { w: 8.5, h: 10 },
}

function nodes(count: number): LayoutInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    // A realistic spread: a couple of strong nodes, a long tail of detail.
    importance: Math.max(0.3, 1 - i * 0.06),
  }))
}

function overlaps(count: number): number {
  const placed = layoutNodes(nodes(count))
  let found = 0
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i]!
      const b = placed[j]!
      const fa = FOOTPRINT[a.tier]
      const fb = FOOTPRINT[b.tier]
      // A small tolerance: cards may sit shoulder to shoulder, not on top of
      // each other.
      if (
        Math.abs(a.x - b.x) < (fa.w + fb.w) * 0.82 &&
        Math.abs(a.y - b.y) < (fa.h + fb.h) * 0.82
      ) {
        found += 1
      }
    }
  }
  return found
}

describe('semantic map layout', () => {
  it('keeps cards from stacking, at every size a word actually reaches', () => {
    // Overlapping cards made the map look broken; a fixed outer radius could
    // not hold this many, so the ring widens with the count.
    for (const count of [3, 5, 6, 8]) {
      expect(overlaps(count), `${count} nodes`).toBe(0)
    }
  })

  it('places important nodes closer to the word than peripheral ones', () => {
    const placed = layoutNodes([
      { id: 'core', importance: 0.95 },
      { id: 'edge', importance: 0.32 },
    ])
    const distance = (id: string) => {
      const p = placed.find((n) => n.id === id)!
      return Math.hypot(p.x - 50, p.y - 50)
    }
    expect(distance('core')).toBeLessThan(distance('edge'))
  })

  it('never lets a lesser node sit closer to the word than a stronger one', () => {
    // Cartesian relaxation used to push the biggest cards outward to make room,
    // so a confusable the student keeps failing ended up further out than a
    // derived form. Distance has to keep meaning importance.
    const input = nodes(8)
    const placed = layoutNodes(input)
    const importance = new Map(input.map((n) => [n.id, n.importance]))
    const distance = (id: string) => {
      const p = placed.find((n) => n.id === id)!
      return Math.hypot(p.x - 50, p.y - 50)
    }
    for (const a of input) {
      for (const b of input) {
        // Only a difference the reader can actually see has to hold.
        if (importance.get(a.id)! - importance.get(b.id)! <= 0.1) continue
        expect(distance(a.id), `${a.id} vs ${b.id}`).toBeLessThanOrEqual(distance(b.id) + 0.5)
      }
    }
  })

  it('draws a heavier connector for a stronger relation', () => {
    const [strong, weak] = layoutNodes([
      { id: 'a', importance: 0.9, relationStrength: 1 },
      { id: 'b', importance: 0.4, relationStrength: 0.3 },
    ])
    expect(strong!.strokeWidth).toBeGreaterThan(weak!.strokeWidth)
    expect(strong!.strokeOpacity).toBeGreaterThan(weak!.strokeOpacity)
  })

  it('is stable, so the map does not rearrange between visits', () => {
    const input = nodes(9)
    expect(layoutNodes(input)).toEqual(layoutNodes(input))
  })

  it('keeps every card inside the box', () => {
    for (const p of layoutNodes(nodes(8))) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(100)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(100)
    }
  })

  it('sizes by importance, not by learning state', () => {
    expect(sizeTier(0.95)).toBe('hero')
    expect(sizeTier(0.8)).toBe('primary')
    expect(sizeTier(0.5)).toBe('secondary')
    expect(sizeTier(0.32)).toBe('peripheral')
  })
})
