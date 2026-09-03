import { describe, expect, it } from 'vitest'
import {
  layoutNodes,
  MAP_CARD,
  MAP_CENTRE,
  MAP_MAX_NODES,
  MAP_MIN_WIDTH,
  mapFrameHeight,
  type LayoutInput,
} from '@/lib/learning/map-layout'

/**
 * Cards have to be this far apart, not merely non-overlapping — the same rule
 * the phone map is held to, for the same reason: a table that clears by a
 * fraction of a pixel is one font-metric change away from cards touching.
 */
const CLEARANCE = 12

function nodes(count: number): LayoutInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    // A realistic spread: a couple of strong nodes, a long tail of detail.
    importance: Math.max(0.3, 1 - i * 0.06),
  }))
}

type Box = { id: string; l: number; r: number; t: number; b: number; cx: number; cy: number }

function boxes(count: number, width = MAP_MIN_WIDTH): Box[] {
  const height = mapFrameHeight(count)
  return layoutNodes(nodes(count)).map((p) => {
    const cx = (p.x / 100) * width
    const cy = (p.y / 100) * height
    return {
      id: p.id,
      l: cx - MAP_CARD.width / 2,
      r: cx + MAP_CARD.width / 2,
      t: cy - MAP_CARD.height / 2,
      b: cy + MAP_CARD.height / 2,
      cx,
      cy,
    }
  })
}

function word(count: number, width = MAP_MIN_WIDTH): Box {
  const height = mapFrameHeight(count)
  return {
    id: 'word',
    l: width / 2 - MAP_CENTRE / 2,
    r: width / 2 + MAP_CENTRE / 2,
    t: height / 2 - MAP_CENTRE / 2,
    b: height / 2 + MAP_CENTRE / 2,
    cx: width / 2,
    cy: height / 2,
  }
}

const tooClose = (a: Box, b: Box) =>
  a.l < b.r + CLEARANCE && b.l < a.r + CLEARANCE && a.t < b.b + CLEARANCE && b.t < a.b + CLEARANCE

const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8]

describe('semantic map layout', () => {
  it('keeps every card clear of every other card, at every size a map reaches', () => {
    // A map is three to five nodes now; six to eight cover the maps written
    // before that rule, which still have to render.
    for (const count of COUNTS) {
      const placed = boxes(count)
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          expect(tooClose(placed[i]!, placed[j]!), `${count} nodes: ${i} vs ${j}`).toBe(false)
        }
      }
    }
  })

  it('never lets a card reach the word in the middle', () => {
    for (const count of COUNTS) {
      for (const card of boxes(count)) {
        expect(tooClose(card, word(count)), `${count} nodes: ${card.id}`).toBe(false)
      }
    }
  })

  it('keeps every card inside the frame, at every width the wide map is used at', () => {
    // 600px is what a 640px viewport leaves once the page's padding is taken;
    // below that the phone map takes over.
    for (const width of [MAP_MIN_WIDTH, 632]) {
      for (const count of COUNTS) {
        const height = mapFrameHeight(count)
        for (const card of boxes(count, width)) {
          expect(card.l, `${width}/${count}: ${card.id} left`).toBeGreaterThanOrEqual(0)
          expect(card.r, `${width}/${count}: ${card.id} right`).toBeLessThanOrEqual(width)
          expect(card.t, `${width}/${count}: ${card.id} top`).toBeGreaterThanOrEqual(0)
          expect(card.b, `${width}/${count}: ${card.id} bottom`).toBeLessThanOrEqual(height)
        }
      }
    }
  })

  it('is mirror-symmetric about the word', () => {
    // The arrangement needs a centre line for the eye to read it against.
    // Without one a constellation looks like an accident, however carefully
    // its distances were chosen.
    // A lone node has nothing to mirror against; every other count does.
    for (const count of COUNTS.filter((c) => c > 1)) {
      const xs = layoutNodes(nodes(count)).map((p) => p.x)
      for (const x of xs) {
        const mirrored = xs.some((other) => Math.abs(other - (100 - x)) < 0.01)
        expect(mirrored, `${count} nodes: no mirror for x=${x}`).toBe(true)
      }
    }
  })

  it('puts the most important node nearest the word', () => {
    // Not a strict ordering across every slot: a mirror-symmetric arrangement
    // gives paired slots the same distance by construction. What has to hold is
    // that nothing outranks the node that matters most.
    for (const count of COUNTS) {
      const placed = boxes(count)
      const centre = word(count)
      const distance = (c: Box) => Math.hypot(c.cx - centre.cx, c.cy - centre.cy)
      const nearest = distance(placed[0]!)
      for (const other of placed.slice(1)) {
        expect(nearest, `${count} nodes vs ${other.id}`).toBeLessThanOrEqual(distance(other) + 0.5)
      }
    }
  })

  it('gives paired slots the same distance, rather than inventing an order', () => {
    const placed = boxes(3)
    const centre = word(3)
    const distance = (c: Box) => Math.hypot(c.cx - centre.cx, c.cy - centre.cy)
    expect(Math.abs(distance(placed[1]!) - distance(placed[2]!))).toBeLessThan(0.01)
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
    const input = nodes(6)
    expect(layoutNodes(input)).toEqual(layoutNodes(input))
  })

  it('places what it can and leaves the rest to the list beneath the map', () => {
    expect(layoutNodes(nodes(11))).toHaveLength(MAP_MAX_NODES)
  })
})
