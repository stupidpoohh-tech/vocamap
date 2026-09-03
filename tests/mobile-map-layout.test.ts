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
/** Measured from the rendered card at 320px in a browser, not guessed. */
const CARD_HEIGHT = 65
/**
 * Cards have to be this far apart, not merely non-overlapping.
 *
 * A slot table that clears by a fraction of a pixel is one font-metric change
 * away from cards touching, and a map whose cards touch reads as a stack.
 */
const CLEARANCE = 3

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

const tooClose = (a: ReturnType<typeof boxes>[number], b: ReturnType<typeof boxes>[number]) =>
  a.left < b.right + CLEARANCE &&
  b.left < a.right + CLEARANCE &&
  a.top < b.bottom + CLEARANCE &&
  b.top < a.bottom + CLEARANCE

describe('mobile map layout', () => {
  it('keeps every card clear of every other card, at any size the map reaches', () => {
    for (let count = 1; count <= MOBILE_MAX_NODES; count += 1) {
      const placed = boxes(count)
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          expect(tooClose(placed[i]!, placed[j]!), `${count} nodes: ${i} vs ${j}`).toBe(false)
        }
      }
    }
  })

  it('never lets a card reach the centre word', () => {
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
        expect(tooClose(card, centre), `${count} nodes: ${card.id}`).toBe(false)
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
    // Not a strict ordering across every slot: a symmetric arrangement in a
    // frame that is wider than it is tall cannot give six slots six distinct
    // distances without wasting the height the practice card needs. What has
    // to hold is that nothing outranks the node that matters most.
    for (const count of [3, 4, 5, 6]) {
      const placed = boxes(count)
      const height = mobileFrameHeight(count)
      const distance = (c: (typeof placed)[number]) =>
        Math.hypot(c.cx - NARROW_FRAME / 2, c.cy - height / 2)
      const nearest = distance(placed[0]!)
      for (const other of placed.slice(1)) {
        expect(nearest, `${count} nodes vs ${other.id}`).toBeLessThanOrEqual(distance(other) + 0.5)
      }
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
    // The map and the practice card have to share one phone screen, so the
    // frame is budgeted rather than merely bounded.
    for (const count of [1, 2, 3, 4, 5, 6]) {
      expect(mobileFrameHeight(count), `${count} nodes`).toBeLessThanOrEqual(262)
    }
  })
})
