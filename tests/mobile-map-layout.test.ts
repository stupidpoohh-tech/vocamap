import { describe, expect, it } from 'vitest'
import {
  layoutMobileNodes,
  MOBILE_CENTRE,
  mobileFrameHeight,
  MOBILE_MAX_NODES,
  type MobileInput,
} from '@/lib/learning/mobile-map-layout'

/** The narrowest phone we support. */
const NARROW_FRAME = 320
/** Eyebrow, two lines of label, a status line and padding. */
const CARD_HEIGHT = 72

function nodes(count: number): MobileInput[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    importance: 1 - i * 0.12,
  }))
}

function boxes(count: number) {
  const height = mobileFrameHeight(count)
  return layoutMobileNodes(nodes(count)).map((p) => {
    const cx = (p.x / 100) * NARROW_FRAME
    const cy = (p.y / 100) * height
    return {
      id: p.id,
      left: cx - p.width / 2,
      right: cx + p.width / 2,
      top: cy - CARD_HEIGHT / 2,
      bottom: cy + CARD_HEIGHT / 2,
      cx,
      cy,
      height,
    }
  })
}

const overlaps = (a: ReturnType<typeof boxes>[number], b: ReturnType<typeof boxes>[number]) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

describe('mobile map layout', () => {
  it('never overlaps a card with another card, at any size the map reaches', () => {
    for (let count = 1; count <= MOBILE_MAX_NODES; count += 1) {
      const placed = boxes(count)
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          expect(overlaps(placed[i]!, placed[j]!), `${count} nodes: ${i} vs ${j}`).toBe(false)
        }
      }
    }
  })

  it('never lets a card cross the centre word', () => {
    // The whole point of the frame is that the word sits in the middle of it.
    for (let count = 1; count <= MOBILE_MAX_NODES; count += 1) {
      const height = mobileFrameHeight(count)
      const centre = {
        id: 'centre',
        left: NARROW_FRAME / 2 - MOBILE_CENTRE.width / 2,
        right: NARROW_FRAME / 2 + MOBILE_CENTRE.width / 2,
        top: height / 2 - MOBILE_CENTRE.height / 2,
        bottom: height / 2 + MOBILE_CENTRE.height / 2,
        cx: 0,
        cy: 0,
        height,
      }
      for (const card of boxes(count)) {
        expect(overlaps(card, centre), `${count} nodes: ${card.id}`).toBe(false)
      }
    }
  })

  it('keeps every card inside the frame', () => {
    // A map that needs scrolling to be read is not a map.
    for (let count = 1; count <= MOBILE_MAX_NODES; count += 1) {
      for (const card of boxes(count)) {
        expect(card.left, `${count}: ${card.id} left`).toBeGreaterThanOrEqual(0)
        expect(card.right, `${count}: ${card.id} right`).toBeLessThanOrEqual(NARROW_FRAME)
        expect(card.top, `${count}: ${card.id} top`).toBeGreaterThanOrEqual(0)
        expect(card.bottom, `${count}: ${card.id} bottom`).toBeLessThanOrEqual(card.height)
      }
    }
  })

  it('puts the most important node nearest the word', () => {
    for (const count of [3, 4, 5, 6]) {
      const placed = boxes(count)
      const height = mobileFrameHeight(count)
      const distance = (c: (typeof placed)[number]) =>
        Math.hypot(c.cx - NARROW_FRAME / 2, c.cy - height / 2)
      // Slots are ordered by importance, so distance has to climb with them.
      expect(distance(placed[0]!), `${count} nodes`).toBeLessThan(distance(placed.at(-1)!))
    }
  })

  it('draws a heavier connector for a stronger relation', () => {
    const [strong, weak] = layoutMobileNodes([
      { id: 'a', importance: 0.95, relationStrength: 1 },
      { id: 'b', importance: 0.5, relationStrength: 0.3 },
    ])
    expect(strong!.strokeWidth).toBeGreaterThan(weak!.strokeWidth)
    expect(strong!.strokeOpacity).toBeGreaterThan(weak!.strokeOpacity)
  })

  it('places what it can and leaves the rest to the list beneath the map', () => {
    expect(layoutMobileNodes(nodes(9))).toHaveLength(MOBILE_MAX_NODES)
  })

  it('stays inside the height a phone screen can show at a glance', () => {
    // A map that needs scrolling to be taken in is not a map. Six is the one
    // size allowed past this, and only because the alternative is hiding
    // connections the word actually has.
    for (const count of [1, 2, 3, 4, 5]) {
      expect(mobileFrameHeight(count), `${count} nodes`).toBeLessThanOrEqual(400)
    }
  })
})
