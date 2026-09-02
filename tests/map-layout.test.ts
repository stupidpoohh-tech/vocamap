import { describe, expect, it } from 'vitest'
import { layoutNodes, sizeTier, type LayoutInput } from '@/lib/learning/map-layout'

const nodes: LayoutInput[] = [
  { id: 'confusable', importance: 1 },
  { id: 'core', importance: 0.95 },
  { id: 'raise', importance: 0.82 },
  { id: 'address', importance: 0.78 },
  { id: 'public', importance: 0.55 },
  { id: 'statement', importance: 0.48 },
  { id: 'month', importance: 0.32 },
]

const distance = (p: { x: number; y: number }) => Math.hypot(p.x - 50, p.y - 50)

describe('semantic map layout', () => {
  it('sizes nodes by importance, not uniformly', () => {
    expect(sizeTier(1)).toBe('hero')
    expect(sizeTier(0.82)).toBe('primary')
    expect(sizeTier(0.55)).toBe('secondary')
    expect(sizeTier(0.32)).toBe('peripheral')

    const tiers = new Set(layoutNodes(nodes).map((p) => p.tier))
    expect(tiers.size).toBeGreaterThan(2)
  })

  it('pulls important nodes closer to the word than peripheral ones', () => {
    const placed = new Map(layoutNodes(nodes).map((p) => [p.id, p]))
    expect(distance(placed.get('confusable')!)).toBeLessThan(distance(placed.get('month')!))
    expect(distance(placed.get('core')!)).toBeLessThan(distance(placed.get('statement')!))
  })

  it('draws a stronger connector for a stronger relation', () => {
    const placed = new Map(layoutNodes(nodes).map((p) => [p.id, p]))
    expect(placed.get('confusable')!.strokeWidth).toBeGreaterThan(placed.get('month')!.strokeWidth)
    expect(placed.get('confusable')!.strokeOpacity).toBeGreaterThan(
      placed.get('month')!.strokeOpacity,
    )
  })

  it('is not a regular polygon', () => {
    // Equal spacing is what made the old map read as a menu. Angles must not
    // come out evenly divided, and radii must not all be equal.
    const placed = layoutNodes(nodes)
    const radii = placed.map(distance)
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(4)

    const angles = placed
      .map((p) => (Math.atan2(p.y - 50, p.x - 50) * 180) / Math.PI)
      .sort((a, b) => a - b)
    const gaps = angles.slice(1).map((a, i) => a - angles[i]!)
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(8)
  })

  it('keeps nodes clear of the centre and inside the box', () => {
    for (const p of layoutNodes(nodes)) {
      expect(distance(p)).toBeGreaterThan(14)
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(100)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(100)
    }
  })

  it('does not overlap cards', () => {
    const placed = layoutNodes(nodes)
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!
        const b = placed[j]!
        // Peripheral half-extents; any pair must clear at least this much.
        const clearsX = Math.abs(a.x - b.x) >= 19
        const clearsY = Math.abs(a.y - b.y) >= 11
        expect(clearsX || clearsY, `${a.id} overlaps ${b.id}`).toBe(true)
      }
    }
  })

  it('lays the same word out the same way every time', () => {
    expect(layoutNodes(nodes)).toEqual(layoutNodes(nodes))
  })

  it('handles a single node and an empty map', () => {
    expect(layoutNodes([])).toEqual([])
    expect(layoutNodes([{ id: 'only', importance: 0.9 }])).toHaveLength(1)
  })
})
