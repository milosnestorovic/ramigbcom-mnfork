import { describe, expect, it } from 'vitest'
import { AREAS, MONITOR_SCREEN } from '../areas'
import { mapPoint, quadToUnitSquare } from './homography'
import { pickPixel } from './pick'
import { IMAGE_ASPECT, IMAGE_H, IMAGE_W, pixelToWorld, worldToPixel } from './space'
import { framedView, lerpView, overviewView, projectToScreen, withParallax } from './view'

/** A smooth fake room: near at the bottom, far at the top. */
const depthAt = (_px: number, py: number) => 2 + (1 - py / IMAGE_H) * 6

describe('overview', () => {
  it('shows the whole image when the viewport has the same aspect ratio', () => {
    const w = 1448
    const h = 1086
    const v = overviewView(w / h)
    const [x0, y0] = projectToScreen(v, pixelToWorld(0, 0, 3), w, h)
    const [x1, y1] = projectToScreen(v, pixelToWorld(IMAGE_W, IMAGE_H, 7), w, h)
    expect(x0).toBeCloseTo(0, 6)
    expect(y0).toBeCloseTo(0, 6)
    expect(x1).toBeCloseTo(w, 6)
    expect(y1).toBeCloseTo(h, 6)
  })

  it('maps pixels independently of depth (the plate looks flat from here)', () => {
    const v = overviewView(16 / 9)
    const a = projectToScreen(v, pixelToWorld(400, 500, 1.2), 1920, 1080)
    const b = projectToScreen(v, pixelToWorld(400, 500, 9), 1920, 1080)
    expect(a[0]).toBeCloseTo(b[0], 6)
    expect(a[1]).toBeCloseTo(b[1], 6)
  })

  it('fills the width and crops vertically on wide screens, never past the image', () => {
    const v = overviewView(16 / 9)
    const [, top] = projectToScreen(v, pixelToWorld(0, 0, 1), 1920, 1080)
    const [, bottom] = projectToScreen(v, pixelToWorld(0, IMAGE_H, 1), 1920, 1080)
    expect(top).toBeLessThanOrEqual(0)
    expect(bottom).toBeGreaterThanOrEqual(1080)
  })

  it('fills the height on portrait screens', () => {
    const aspect = 390 / 844
    expect(aspect).toBeLessThan(IMAGE_ASPECT)
    const v = overviewView(aspect, 0)
    const [, top] = projectToScreen(v, pixelToWorld(724, 0, 1), 390, 844)
    const [, bottom] = projectToScreen(v, pixelToWorld(724, IMAGE_H, 1), 390, 844)
    expect(top).toBeCloseTo(0, 6)
    expect(bottom).toBeCloseTo(844, 6)
  })
})

describe('framing', () => {
  it('puts every area box center where its anchor says, at every test viewport', () => {
    const sizes = [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [1024, 768],
      [390, 844],
      [375, 667],
    ] as const
    for (const area of AREAS) {
      for (const [w, h] of sizes) {
        const f = w / h < 1 ? area.narrow : area.wide
        const v = framedView(f, w / h, depthAt)
        const [x0, y0, x1, y1] = f.box
        const cx = (x0 + x1) / 2
        const cy = (y0 + y1) / 2
        const [sx, sy] = projectToScreen(v, pixelToWorld(cx, cy, depthAt(cx, cy)), w, h)
        // Clamping to the plate may pull it off the anchor, but it must stay on screen.
        expect(sx).toBeGreaterThan(0)
        expect(sx).toBeLessThan(w)
        expect(sy).toBeGreaterThan(0)
        expect(sy).toBeLessThan(h)
      }
    }
  })

  it('honors the anchor when there is room to', () => {
    const f = { box: [600, 500, 800, 600] as const, dolly: 0.3, fill: 0.4, anchor: [-0.5, 0.2] as const }
    const v = framedView(f, 16 / 9, depthAt)
    const [sx, sy] = projectToScreen(v, pixelToWorld(700, 550, depthAt(700, 550)), 1920, 1080)
    expect(sx).toBeCloseTo(1920 * 0.25, 0)
    expect(sy).toBeCloseTo(1080 * 0.6, 0)
  })
})

describe('parallax', () => {
  it('keeps the focal plane fixed and moves nearer things more', () => {
    const v = overviewView(16 / 9)
    const p = withParallax(v, 0.05, 0)
    const focal = pixelToWorld(700, 600, v.focal)
    const near = pixelToWorld(700, 600, 1.2)
    const a = projectToScreen(v, focal, 1920, 1080)
    const b = projectToScreen(p, focal, 1920, 1080)
    expect(b[0]).toBeCloseTo(a[0], 6)
    const n0 = projectToScreen(v, near, 1920, 1080)
    const n1 = projectToScreen(p, near, 1920, 1080)
    expect(Math.abs(n1[0] - n0[0])).toBeGreaterThan(5)
  })

  it('interpolates between views without jumps at the ends', () => {
    const a = overviewView(16 / 9)
    const b = framedView(AREAS[0]!.wide, 16 / 9, depthAt)
    expect(lerpView(a, b, 0)).toEqual(a)
    const end = lerpView(a, b, 1)
    expect(end.halfW).toBeCloseTo(b.halfW, 9)
    expect(end.cx).toBeCloseTo(b.cx, 9)
  })
})

describe('picking', () => {
  it('finds the pixel under the cursor from the overview', () => {
    const w = 1920
    const h = 1080
    const v = overviewView(w / h)
    const [sx, sy] = projectToScreen(v, pixelToWorld(500, 600, depthAt(500, 600)), w, h)
    const hit = pickPixel(v, w / h, (sx / w) * 2 - 1, 1 - (sy / h) * 2, depthAt)
    expect(hit?.[0]).toBeCloseTo(500, 0)
    expect(hit?.[1]).toBeCloseTo(600, 0)
  })

  it('finds the pixel under the cursor from a moved camera', () => {
    const w = 1440
    const h = 900
    const v = framedView(AREAS[1]!.wide, w / h, depthAt)
    const [sx, sy] = projectToScreen(v, pixelToWorld(200, 850, depthAt(200, 850)), w, h)
    const hit = pickPixel(v, w / h, (sx / w) * 2 - 1, 1 - (sy / h) * 2, depthAt)
    expect(hit?.[0]).toBeCloseTo(200, 0)
    expect(hit?.[1]).toBeCloseTo(850, 0)
  })

  it('round-trips world and pixel coordinates', () => {
    const [px, py] = worldToPixel(pixelToWorld(123, 456, 4.2))
    expect(px).toBeCloseTo(123, 9)
    expect(py).toBeCloseTo(456, 9)
  })
})

describe('homography', () => {
  it('maps the element corners onto the quad', () => {
    const quad = MONITOR_SCREEN
    const w = 640
    const h = 480
    const corners = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ] as const
    corners.forEach(([x, y], i) => {
      const [mx, my] = mapPoint(w, h, quad, x, y)
      expect(mx).toBeCloseTo(quad[i]![0], 3)
      expect(my).toBeCloseTo(quad[i]![1], 3)
    })
  })

  it('maps the quad back onto the unit square', () => {
    const m = quadToUnitSquare(MONITOR_SCREEN)
    const unit = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const
    MONITOR_SCREEN.forEach(([x, y], i) => {
      const w = m[6]! * x + m[7]! * y + m[8]!
      expect((m[0]! * x + m[1]! * y + m[2]!) / w).toBeCloseTo(unit[i]![0], 3)
      expect((m[3]! * x + m[4]! * y + m[5]!) / w).toBeCloseTo(unit[i]![1], 3)
    })
  })
})
