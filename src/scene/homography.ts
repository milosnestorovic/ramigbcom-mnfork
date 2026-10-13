export type Point = readonly [number, number]

/**
 * CSS matrix3d() that maps the rectangle (0,0)-(w,h) onto an arbitrary quad.
 * Corners are given clockwise from top-left. Used to seat DOM content inside
 * the CRT screen so it follows the camera like part of the room.
 */
export function quadToMatrix3d(w: number, h: number, quad: readonly [Point, Point, Point, Point]): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad
  // Projective map from the unit square to the quad (Heckbert's closed form).
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  const det = dx1 * dy2 - dx2 * dy1
  const g = det === 0 ? 0 : (sx * dy2 - dx2 * sy) / det
  const hh = det === 0 ? 0 : (dx1 * sy - sx * dy1) / det
  const a = x1 - x0 + g * x1
  const b = x3 - x0 + hh * x3
  const c = x0
  const d = y1 - y0 + g * y1
  const e = y3 - y0 + hh * y3
  const f = y0
  // Pre-scale so the element's own pixel box maps onto the unit square.
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1]
  return `matrix3d(${m.map((n) => +n.toFixed(9)).join(',')})`
}

/**
 * The reverse: a 3x3 matrix (row-major) taking a point inside the quad back to the
 * unit square, up to scale. The room shader uses it to draw onto the CRT's glass.
 */
export function quadToUnitSquare(quad: readonly [Point, Point, Point, Point]): number[] {
  const m = quadToMatrix3d(1, 1, quad).slice(9, -1).split(',').map(Number)
  const at = (i: number) => m[i] ?? 0
  const [a, b, c, d, e, f, g, h] = [at(0), at(4), at(12), at(1), at(5), at(13), at(3), at(7)]
  // Adjugate of [[a, b, c], [d, e, f], [g, h, 1]].
  return [e - f * h, c * h - b, b * f - c * e, f * g - d, a - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d]
}

/** Apply the same mapping to a point, for tests. */
export function mapPoint(w: number, h: number, quad: readonly [Point, Point, Point, Point], x: number, y: number): Point {
  const m = quadToMatrix3d(w, h, quad).slice(9, -1).split(',').map(Number)
  const at = (i: number) => m[i] ?? 0
  const X = at(0) * x + at(4) * y + at(12)
  const Y = at(1) * x + at(5) * y + at(13)
  const W = at(3) * x + at(7) * y + at(15)
  return [X / W, Y / W]
}
