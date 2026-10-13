import { quadToUnitSquare } from './homography'
import { easeInOutCubic } from './view'

/**
 * The radio on the right-hand shelves. It stands where the painted player was and
 * covers it: a battered steel cassette radio (LCD readout, two VU meters, a lit
 * cassette window, volume and tuning knobs, a row of labelled transport keys) with
 * a rack of cassettes beside it. Both stand on a shelf along the wall, facing the
 * middle of the room, so they are modelled as boxes in space and projected onto the
 * picture; their fronts are drawn flat and warped into place. Everything lands in one canvas that the room shader
 * lays over that patch of the picture. Positions on the picture are image pixels.
 */

export type DeckKeyName = 'play' | 'pause' | 'stop' | 'rewind' | 'forward' | 'eject'
export type DeckTarget =
  | { kind: 'key'; key: DeckKeyName }
  | { kind: 'tape'; index: number }
  | { kind: 'volume'; dir: -1 | 1 }

export interface DeckView {
  /** One cassette per name, top of the rack first. */
  tapes: readonly string[]
  loaded: number | null
  title: string
  /** e.g. "2/5", shown next to TRACK. */
  trackLabel: string
  playing: boolean
  paused: boolean
  /** 0..1, where the volume knob points. */
  volume: number
  at: number
  of: number
}

type P = readonly [number, number]
type Quad = readonly [P, P, P, P]

/** The patch of the picture this canvas covers: [x0, y0, x1, y1]. */
export const DECK_RECT = [1246, 446, 1440, 612] as const
/** The patch the sharper copy of the picture covers. */
export const PATCH_RECT = [1272, 468, 1408, 604] as const
/** Canvas pixels per image pixel. */
const RES = 9

/**
 * Where the radio stands. The right wall runs straight away from the viewer, its
 * lines meeting at EYE (measured off the lit units further along the same wall).
 * The radio stands square on a shelf against that wall like everything else on it:
 * its front looks across the room, so from the doorway it is seen from the side,
 * foreshortened and growing toward its near end, with one end turned to us.
 * Walk up to it and the view swings part of the way round to its front.
 * Units are image pixels at the depth of the front's far bottom corner, ORIGIN.
 */
const FOCAL = 1034
const EYE: P = [700, 200]
const ORIGIN: P = [1291, 536]
/** The angle between the line of sight and the fronts: square to the wall, and as seen from close by. */
const YAW_SHELF = Math.PI / 2
const YAW_CLOSE = (66 * Math.PI) / 180
/** The radio: width along its front, height, depth. */
const BOX = { w: 72, h: 68, d: 28 }
/** The cassette rack, standing against the radio's near end: `a` is where its front starts. */
const SHELF = { a: 74, w: 44, h: 62, d: 24 }
const SHELF_END = SHELF.a + SHELF.w
/** The board they stand on: how far it runs past them at each end, toward the room, to the wall, and how thick. */
const BOARD = { a0: -8, a1: SHELF_END + 3, front: 5, back: -31, t: 4 }
/** The view swings about the middle of the pair. */
const PIVOT = { a: 59, c: -14 }

/** How the pair sits on the picture for one angle of view. */
interface Pose {
  /** A point `a` along the fronts, `b` above the shelf and `c` out toward the room, on the picture. */
  project: (a: number, b: number, c: number) => P
  /** An upright rectangle parallel to the fronts, clockwise from top-left. */
  upright: (a0: number, a1: number, b0: number, b1: number, c: number) => Quad
  face: Quad
  rack: Quad
  lid: Quad
  nearSide: Quad
  rackLid: Quad
  rackSide: Quad
  /** The two silhouettes, and the box around everything: [x0, y0, x1, y1]. */
  outline: readonly (readonly P[])[]
  bounds: readonly [number, number, number, number]
}

/** The pose `turn` of the way from on-the-shelf (0) to up-close (1). */
function poseAt(turn: number): Pose {
  const yaw = YAW_SHELF + (YAW_CLOSE - YAW_SHELF) * turn
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const x0 = ORIGIN[0] - EYE[0] - PIVOT.c
  const y0 = ORIGIN[1] - EYE[1]
  const z0 = FOCAL - PIVOT.a
  const project = (a: number, b: number, c: number): P => {
    const da = a - PIVOT.a
    const dc = c - PIVOT.c
    const z = z0 - da * sin - dc * cos
    return [EYE[0] + (FOCAL * (x0 + da * cos - dc * sin)) / z, EYE[1] + (FOCAL * (y0 - b)) / z]
  }
  const upright = (a0: number, a1: number, b0: number, b1: number, c: number): Quad => [project(a0, b1, c), project(a1, b1, c), project(a1, b0, c), project(a0, b0, c)]
  const face = upright(0, BOX.w, 0, BOX.h, 0)
  const rack = upright(SHELF.a, SHELF_END, 0, SHELF.h, 0)
  const lid: Quad = [project(0, BOX.h, -BOX.d), project(BOX.w, BOX.h, -BOX.d), project(BOX.w, BOX.h, 0), project(0, BOX.h, 0)]
  const nearSide: Quad = [project(BOX.w, BOX.h, 0), project(BOX.w, BOX.h, -BOX.d), project(BOX.w, 0, -BOX.d), project(BOX.w, 0, 0)]
  const rackLid: Quad = [project(SHELF.a, SHELF.h, -SHELF.d), project(SHELF_END, SHELF.h, -SHELF.d), project(SHELF_END, SHELF.h, 0), project(SHELF.a, SHELF.h, 0)]
  const rackSide: Quad = [project(SHELF_END, SHELF.h, 0), project(SHELF_END, SHELF.h, -SHELF.d), project(SHELF_END, 0, -SHELF.d), project(SHELF_END, 0, 0)]
  const outline = [
    [lid[0], lid[1], nearSide[1], nearSide[2], face[2], face[3], face[0]],
    [rackLid[0], rackLid[1], rackSide[1], rackSide[2], rack[2], rack[3], rack[0]],
  ]
  const all = [...outline.flat(), project(BOARD.a0, -BOARD.t, BOARD.front), project(BOARD.a1, -BOARD.t, BOARD.front), project(BOARD.a1, 0, BOARD.back)]
  const bounds = [Math.min(...all.map((q) => q[0])), Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[0])), Math.max(...all.map((q) => q[1]))] as const
  return { project, upright, face, rack, lid, nearSide, rackLid, rackSide, outline, bounds }
}

const ON_SHELF = poseAt(0)
const UP_CLOSE = poseAt(1)
/** The two silhouettes as they stand on the shelf, for the hover outline, and the box around them. */
export const DECK_OUTLINE = ON_SHELF.outline
export const DECK_BOUNDS = ON_SHELF.bounds
/** The box around them once the view has swung round, for framing the close-up. */
export const DECK_CLOSE = UP_CLOSE.bounds
/** Everywhere they ever reach. */
export const DECK_REACH: readonly [number, number, number, number] = [
  Math.min(DECK_BOUNDS[0], DECK_CLOSE[0]),
  Math.min(DECK_BOUNDS[1], DECK_CLOSE[1]),
  Math.max(DECK_BOUNDS[2], DECK_CLOSE[2]),
  Math.max(DECK_BOUNDS[3], DECK_CLOSE[3]),
]

/** The radio's front, flat: logical size and how finely it is drawn before warping. */
const FW = 620
const FH = 656
const FRES = 1.5
/** The rack's front, flat. */
const RW = 400
const RH = 630
const RRES = 1.2
/** The lids and the rack's side, flat. */
const LID_W = 640
const LID_H = 280
const SIDE_W = 200
const SIDE_H = 630

/** The parts of the radio's front, in its logical pixels. */
const LCD = { x: 147, y: 49, w: 336, h: 112 }
const VU = { x: 31, w: 104, h: 58, ys: [224, 336] as const }
const DOOR = { x: 150, y: 208, w: 322, h: 220 }
const WIN = { x: 193, y: 240, w: 236, h: 130 }
const VOLUME: P = [538, 262]
const TUNING: P = [538, 384]
const KNOB_R = 30
const KEYS: readonly DeckKeyName[] = ['play', 'pause', 'stop', 'rewind', 'forward', 'eject']
const KEY_LABELS: Record<DeckKeyName, string> = { play: 'PLAY', pause: 'PAUSE', stop: 'STOP', rewind: 'REW', forward: 'FF', eject: 'EJECT' }
const KEY = { x: 140, y: 498, w: 63, h: 74, gap: 6.4 }
/** How far things stand off the front, in the same units as BOX. */
const KEY_OUT = 1.5
const KEY_DOWN = 0.45
const KNOB_OUT = 2.4
const BEZEL_OUT = 0.55
const HOUSING_OUT = 0.75
const NUB_OUT = 1.1

/** The rack's two stacking shelves: where a stack stands, how tall a case is, how many fit. */
const STACKS = [
  { floor: 206, h: 42, cap: 4 },
  { floor: 614, h: 36, cap: 5 },
] as const
const SPINE = { x: 34, w: 300 }
/** Inside the rack, in BOX units: its back wall, the backs of the cases, and where their spines sit. */
const RACK_BACK = -SHELF.d + 1.5
const CASE_BACK = -SHELF.d + 3
const CASE_OUT = -1.7
/** A spine, flat. */
const SW = 480
const SH = 68

const FLIGHT_S = 0.9
const INK = '#8ff0ea'
const AMBER = '#ffb347'
const LEGEND = 'rgba(226, 221, 204, 0.88)'
const HUES = [32, 4, 178, 262, 130, 330, 210, 52]
const MONO = "'Geist Mono Variable', ui-monospace, monospace"

function hueFor(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return HUES[h % HUES.length]!
}

function clock(s: number): string {
  if (!Number.isFinite(s)) return '--:--'
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)

/** The same pseudo-random numbers every time, so the wear never changes. */
function seeded(seed: number): () => number {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** The projective map from the unit square onto a quad (Heckbert's closed form). */
function ontoQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]: Quad): (s: number, t: number) => P {
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  const det = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / det
  const h = (dx1 * sy - sx * dy1) / det
  return (s, t) => {
    const w = g * s + h * t + 1
    return [((x1 - x0 + g * x1) * s + (x3 - x0 + h * x3) * t + x0) / w, ((y1 - y0 + g * y1) * s + (y3 - y0 + h * y3) * t + y0) / w]
  }
}

/** Where an image pixel falls on a quad, 0..1 across and down. */
function offQuad(m: readonly number[], px: number, py: number): P {
  const w = m[6]! * px + m[7]! * py + m[8]!
  return [(m[0]! * px + m[1]! * py + m[2]!) / w, (m[3]! * px + m[4]! * py + m[5]!) / w]
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = Math.round(w)
  c.height = Math.round(h)
  return [c, c.getContext('2d')!]
}

type Ctx = CanvasRenderingContext2D

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function vertical(ctx: Ctx, y0: number, y1: number, ...stops: readonly string[]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  stops.forEach((c, i) => g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c))
  return g
}

/** A plate standing proud of what is around it: a shadow under it, light along its top edge. */
function raised(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, top: string, bottom: string): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetX = -5
  ctx.shadowOffsetY = 3
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = vertical(ctx, y, y + h, top, bottom)
  ctx.fill()
  ctx.restore()
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(r - 1, 0))
  ctx.lineWidth = 2
  ctx.strokeStyle = vertical(ctx, y, y + h, 'rgba(255, 250, 232, 0.34)', 'rgba(255, 250, 232, 0.04)', 'rgba(0, 0, 0, 0.55)')
  ctx.stroke()
}

/** A hollow pressed into the steel: dark, shadowed under its top lip, a line of light on its bottom one. */
function recess(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = vertical(ctx, y, y + Math.min(h, 14), 'rgba(0, 0, 0, 0.7)', 'rgba(0, 0, 0, 0)')
  ctx.fillRect(x, y, w, Math.min(h, 14))
  ctx.restore()
  rr(ctx, x - 1, y - 1, w + 2, h + 2, r + 1)
  ctx.lineWidth = 2
  ctx.strokeStyle = vertical(ctx, y, y + h, 'rgba(0, 0, 0, 0.8)', 'rgba(0, 0, 0, 0.3)', 'rgba(255, 250, 232, 0.2)')
  ctx.stroke()
}

/** A slotted screw head, turned however it was last left. */
function screw(ctx: Ctx, x: number, y: number, r: number, turn: number): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.beginPath()
  ctx.arc(x, y + 1, r + 2.2, 0, Math.PI * 2)
  ctx.fill()
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0.5, x, y, r)
  g.addColorStop(0, '#9c9a8e')
  g.addColorStop(0.55, '#5b5a53')
  g.addColorStop(1, '#2b2b28')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineCap = 'round'
  for (const [dy, color, width] of [[0.7, 'rgba(255, 250, 232, 0.25)', 1.2], [0, '#141413', 2.2]] as const) {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(x - Math.cos(turn) * r * 0.72, y + dy - Math.sin(turn) * r * 0.72)
    ctx.lineTo(x + Math.cos(turn) * r * 0.72, y + dy + Math.sin(turn) * r * 0.72)
    ctx.stroke()
  }
  ctx.lineCap = 'butt'
  // Rust creeping out from under the head.
  const rust = ctx.createRadialGradient(x, y + r, 0, x, y + r, r * 2.6)
  rust.addColorStop(0, 'rgba(140, 66, 24, 0.3)')
  rust.addColorStop(1, 'rgba(140, 66, 24, 0)')
  ctx.fillStyle = rust
  ctx.fillRect(x - r * 3, y - r, r * 6, r * 4.5)
}

/** Lettering stamped into the steel: a dark line under each light one. */
function engrave(ctx: Ctx, text: string, x: number, y: number, size: number, align: CanvasTextAlign = 'center', color = LEGEND): void {
  ctx.font = `500 ${size}px ${MONO}`
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.fillText(text, x, y + 1.2)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

/**
 * Years of use, to lay over bare steel: grain, mottling, scratches, chipped paint,
 * streaks where something ran down it, rust gathering along the edges.
 */
function grunge(w: number, h: number, seed: number, res: number): HTMLCanvasElement {
  const [c, ctx] = canvasOf(w * res, h * res)
  const rnd = seeded(seed)
  const image = ctx.createImageData(c.width, c.height)
  for (let i = 0; i < image.data.length; i += 4) {
    const v = rnd()
    const light = v > 0.5
    image.data[i] = light ? 255 : 0
    image.data[i + 1] = light ? 248 : 0
    image.data[i + 2] = light ? 232 : 0
    image.data[i + 3] = Math.abs(v - 0.5) * (light ? 34 : 70)
  }
  ctx.putImageData(image, 0, 0)
  ctx.scale(res, res)
  const blot = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'))
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // Mottling: large soft patches, darker more often than lighter.
  for (let i = 0; i < 40; i++) {
    blot(rnd() * w, rnd() * h, 30 + rnd() * 110, rnd() > 0.38 ? `rgba(0, 0, 0, ${0.04 + rnd() * 0.1})` : `rgba(210, 215, 205, ${0.02 + rnd() * 0.04})`)
  }
  // Streaks running down from the top edges.
  for (let i = 0; i < 44; i++) {
    const x = rnd() * w
    const y = rnd() * h * 0.8
    const len = 30 + rnd() * 150
    ctx.fillStyle = vertical(ctx, y, y + len, `rgba(0, 0, 0, ${0.07 + rnd() * 0.12})`, 'rgba(0, 0, 0, 0)')
    ctx.fillRect(x, y, 1.5 + rnd() * 5, len)
  }
  // Rust: thick toward the edges and corners, a little everywhere.
  for (let i = 0; i < 110; i++) {
    const edge = rnd() > 0.18
    let x = rnd() * w
    let y = rnd() * h
    if (edge) {
      if (rnd() > 0.5) x = rnd() > 0.5 ? rnd() * 34 : w - rnd() * 34
      else y = rnd() > 0.5 ? rnd() * 30 : h - rnd() * 30
    }
    blot(x, y, 4 + rnd() * (edge ? 24 : 10), `rgba(${128 + rnd() * 50}, ${58 + rnd() * 28}, ${18 + rnd() * 14}, ${0.08 + rnd() * (edge ? 0.24 : 0.1)})`)
  }
  for (let i = 0; i < 320; i++) {
    ctx.fillStyle = `rgba(${150 + rnd() * 50}, ${72 + rnd() * 30}, 26, ${0.12 + rnd() * 0.3})`
    ctx.fillRect(rnd() * w, rnd() * h, 0.6 + rnd() * 1.8, 0.6 + rnd() * 1.6)
  }
  // Scratches: mostly along the grain, a few across it.
  ctx.lineCap = 'round'
  for (let i = 0; i < 220; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const a = rnd() > 0.2 ? (rnd() - 0.5) * 0.5 : rnd() * Math.PI
    const len = 6 + rnd() * rnd() * 150
    ctx.strokeStyle = rnd() > 0.45 ? `rgba(235, 232, 218, ${0.03 + rnd() * 0.11})` : `rgba(0, 0, 0, ${0.1 + rnd() * 0.25})`
    ctx.lineWidth = 0.4 + rnd() * 0.9
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  // Chips where the paint has gone through to bright metal.
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(214, 212, 200, ${0.06 + rnd() * 0.22})`
    ctx.fillRect(rnd() * w, rnd() * h, 0.5 + rnd() * 2.2, 0.5 + rnd() * 1.4)
  }
  return c
}

/** Fine dots for the LCD's glass, as a repeating tile. */
function dotTile(): HTMLCanvasElement {
  const [c, ctx] = canvasOf(3, 3)
  ctx.fillStyle = 'rgba(0, 8, 9, 0.32)'
  ctx.fillRect(2, 0, 1, 3)
  ctx.fillRect(0, 2, 3, 1)
  return c
}

export class DeckArt {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: Ctx
  /** Everything that never moves, already in place: what lies behind the cassettes, and the rack's frame in front of them. */
  private readonly shell: HTMLCanvasElement
  private readonly shellCtx: Ctx
  private readonly frame: HTMLCanvasElement
  private readonly frameCtx: Ctx
  private readonly textures = new Map<string, HTMLCanvasElement>()
  /** The radio's front with nothing live on it, and the surface the live parts are added on. */
  private readonly plate: HTMLCanvasElement
  private readonly plateCtx: Ctx
  private readonly face: HTMLCanvasElement
  private readonly faceCtx: Ctx
  /** The knobs' caps, on their own so they can stand off the front. */
  private readonly caps: HTMLCanvasElement
  private readonly capsCtx: Ctx
  private readonly spines = new Map<string, HTMLCanvasElement>()
  private pose = ON_SHELF
  private faceInverse: number[] = []
  private rackInverse: number[] = []
  private keyInverse: number[] = []
  private knobInverse: number[] = []
  /** How far the view has swung round to the front, and how far it should. */
  private turn = 0
  private turnGoal = 0
  private laid = false
  private view: DeckView = { tapes: [], loaded: null, title: '', trackLabel: '', playing: false, paused: false, volume: 0.8, at: 0, of: NaN }
  /** Per cassette: 0 in the rack, 1 inside the radio. */
  private travel: number[] = []
  private readonly press = new Map<DeckKeyName, number>()
  private readonly tapped = new Map<DeckKeyName, number>()
  private hover: DeckTarget | null = null
  private time = 0
  private age = 0
  private stale = true
  private built = false
  private seated = 0

  constructor() {
    const w = (DECK_RECT[2] - DECK_RECT[0]) * RES
    const h = (DECK_RECT[3] - DECK_RECT[1]) * RES
    ;[this.canvas, this.ctx] = canvasOf(w, h)
    ;[this.shell, this.shellCtx] = canvasOf(w, h)
    ;[this.frame, this.frameCtx] = canvasOf(w, h)
    ;[this.plate, this.plateCtx] = canvasOf(FW * FRES, FH * FRES)
    ;[this.face, this.faceCtx] = canvasOf(FW * FRES, FH * FRES)
    ;[this.caps, this.capsCtx] = canvasOf(FW * FRES, FH * FRES)
    this.setPose(ON_SHELF)
  }

  private setPose(pose: Pose): void {
    this.pose = pose
    this.faceInverse = quadToUnitSquare(pose.face)
    this.rackInverse = quadToUnitSquare(pose.upright(SHELF.a, SHELF_END, 0, SHELF.h, CASE_OUT))
    this.keyInverse = quadToUnitSquare(pose.upright(0, BOX.w, 0, BOX.h, KEY_OUT))
    this.knobInverse = quadToUnitSquare(pose.upright(0, BOX.w, 0, BOX.h, KNOB_OUT))
    this.laid = false
  }

  /** Swing the view round toward the radio's front (up close) or back square to the wall. */
  setTurned(on: boolean): void {
    this.turnGoal = on ? 1 : 0
  }

  setView(view: DeckView): void {
    if (view.tapes.length !== this.travel.length) {
      this.travel = view.tapes.map((_n, i) => (i === view.loaded ? 1 : 0))
      this.laid = false
    }
    this.view = view
    this.stale = true
  }

  setHover(target: DeckTarget | null): void {
    this.hover = target
    this.stale = true
  }

  /** A momentary press, for keys that don't stay down. */
  tap(key: DeckKeyName): void {
    this.tapped.set(key, 0.16)
    this.stale = true
  }

  /** Force a full repaint, e.g. once the fonts have arrived. */
  redraw(): void {
    this.built = false
    this.laid = false
    this.spines.clear()
    this.stale = true
  }

  /** What is under an image pixel: a key or the volume knob on the radio, or a spine in the rack. */
  targetAt(px: number, py: number): DeckTarget | null {
    // The keys and the knob stand off the front, so look on their tops first, then at their feet.
    for (const m of [this.keyInverse, this.faceInverse]) {
      const [s, t] = offQuad(m, px, py)
      const fx = s * FW
      const fy = t * FH
      if (fy < KEY.y || fy > KEY.y + KEY.h) continue
      const i = Math.floor((fx - KEY.x) / (KEY.w + KEY.gap))
      if (i >= 0 && i < KEYS.length && fx - KEY.x - i * (KEY.w + KEY.gap) <= KEY.w) return { kind: 'key', key: KEYS[i]! }
    }
    for (const m of [this.knobInverse, this.faceInverse]) {
      const [s, t] = offQuad(m, px, py)
      if (Math.hypot(s * FW - VOLUME[0], t * FH - VOLUME[1]) <= KNOB_R + 8) return { kind: 'volume', dir: s * FW < VOLUME[0] ? -1 : 1 }
    }
    const [rs, rt] = offQuad(this.rackInverse, px, py)
    const rx = rs * RW
    const ry = rt * RH
    for (let i = 0; i < this.travel.length; i++) {
      const slot = this.slot(i)
      if (!slot || this.travel[i]! > 0) continue
      if (rx >= SPINE.x && rx <= SPINE.x + SPINE.w && ry >= slot.y && ry <= slot.y + slot.h) return { kind: 'tape', index: i }
    }
    return null
  }

  /** Advance the animation. True when the canvas was repainted. */
  update(dt: number, lively: boolean): boolean {
    let moving = this.stale
    this.stale = false
    this.time += dt
    const toward = (cur: number, goal: number, rate: number) => {
      if (cur === goal) return cur
      moving = true
      const step = dt * rate
      return Math.abs(goal - cur) <= step ? goal : cur + Math.sign(goal - cur) * step
    }
    this.travel = this.travel.map((t, i) => toward(t, i === this.view.loaded ? 1 : 0, 1 / FLIGHT_S))
    const turn = toward(this.turn, this.turnGoal, 1 / 0.9)
    if (turn !== this.turn) {
      this.turn = turn
      this.setPose(turn === 0 ? ON_SHELF : turn === 1 ? UP_CLOSE : poseAt(easeInOutCubic(turn)))
    }
    for (const k of KEYS) {
      const left = Math.max(0, (this.tapped.get(k) ?? 0) - dt)
      this.tapped.set(k, left)
      const down = left > 0 || (k === 'play' && this.view.playing) || (k === 'pause' && this.view.paused)
      this.press.set(k, toward(this.press.get(k) ?? 0, down ? 1 : 0, 14))
    }
    // The display scrolls and dances while a tape runs, but only up close is that worth a repaint.
    this.age += dt
    const live = lively && (this.view.playing || this.view.paused)
    if (!moving && !(live && this.age > 0.06)) return false
    this.age = 0
    this.paint()
    return true
  }

  /** How much of cassette i is still in the rack (1 = there, 0 = gone). */
  private presence(i: number): number {
    return 1 - easeInOutCubic(clamp01(this.travel[i]! / 0.3))
  }

  /** Which stack cassette i belongs to, and the cassettes that share it. */
  private stackOf(i: number): { stack: (typeof STACKS)[number]; first: number; count: number } | null {
    let first = 0
    for (const stack of STACKS) {
      const count = Math.min(stack.cap, this.travel.length - first)
      if (i < first + count) return { stack, first, count }
      first += count
    }
    return null
  }

  /** Where spine i lies on the rack's front, wherever its stack has settled it. */
  private slot(i: number): { y: number; h: number } | null {
    const at = this.stackOf(i)
    if (!at) return null
    const { stack, first, count } = at
    // Spare cases fill the bottom of the stack; the tapes sit on top of them.
    let below = stack.cap - count
    for (let j = i + 1; j < first + count; j++) below += this.presence(j)
    return { y: stack.floor - (below + 1) * stack.h, h: stack.h }
  }

  private paint(): void {
    if (!this.built) {
      this.buildPlate()
      this.built = true
    }
    if (!this.laid) {
      this.layBack()
      this.layFrame()
      this.laid = true
    }
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.drawImage(this.shell, 0, 0)
    // The tapes, each stack from the bottom up so a case hides the top of the one under it.
    for (let i = this.travel.length - 1; i >= 0; i--) {
      const here = this.presence(i)
      const slot = this.slot(i)
      if (!slot || here < 0.02) continue
      const hovered = this.hover?.kind === 'tape' && this.hover.index === i
      // A hovered case eases out toward you, as far as the rack's own front.
      this.caseBox(ctx, this.spineArt(this.view.tapes[i] ?? '', hovered), SPINE.x, slot.y, SPINE.w, slot.h, hovered ? -0.25 : CASE_OUT, here)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(this.frame, 0, 0)
    this.drawFace()
    this.warp(ctx, this.face, this.pose.face, 26)
    this.drawRelief(ctx)
    this.travel.forEach((t, i) => {
      if (t > 0 && t < 1) this.drawFlight(i, t)
    })
  }

  /** A flat drawing made once and kept. */
  private tex(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
    let c = this.textures.get(key)
    if (!c) this.textures.set(key, (c = make()))
    return c
  }

  /**
   * Lay a flat drawing onto a quad of the picture in true perspective: a grid of
   * small cells, each placed with its own affine map.
   */
  private warp(ctx: Ctx, src: HTMLCanvasElement, quad: Quad, n: number, alpha = 1, part?: readonly [number, number, number, number]): void {
    const at = ontoQuad(quad)
    const [sx, sy, sw, sh] = part ?? [0, 0, src.width, src.height]
    const cw = sw / n
    const ch = sh / n
    ctx.save()
    ctx.globalAlpha = alpha
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const o = at(i / n, j / n)
        const u = at((i + 1) / n, j / n)
        const v = at(i / n, (j + 1) / n)
        ctx.setTransform(RES, 0, 0, RES, -DECK_RECT[0] * RES, -DECK_RECT[1] * RES)
        ctx.transform((u[0] - o[0]) / cw, (u[1] - o[1]) / cw, (v[0] - o[0]) / ch, (v[1] - o[1]) / ch, o[0], o[1])
        // A hair of overlap hides the seams between cells.
        const pad = part && (i === n - 1 || j === n - 1) ? 0 : 1
        ctx.drawImage(src, sx + i * cw, sy + j * ch, cw + pad, ch + pad, 0, 0, cw + pad, ch + pad)
      }
    }
    ctx.restore()
  }

  /** A filled shape on the picture, given in image pixels. */
  private shape(ctx: Ctx, points: readonly P[], fill: string | CanvasGradient, blur = 0, alpha = 1): void {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.setTransform(RES, 0, 0, RES, -DECK_RECT[0] * RES, -DECK_RECT[1] * RES)
    if (blur) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
      ctx.shadowBlur = blur * RES
    }
    ctx.beginPath()
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.restore()
  }

  /** Along the rack's front and up it, from its logical pixels to the fronts' own measure. */
  private along(x: number): number {
    return SHELF.a + (x / RW) * SHELF.w
  }

  private above(y: number): number {
    return SHELF.h * (1 - y / RH)
  }

  /**
   * One cassette case lying in the rack, as the box it is: its lid, its end toward
   * us, and its spine `out` units from the rack's front. Placed in the rack's logical pixels.
   */
  private caseBox(ctx: Ctx, spine: HTMLCanvasElement, x: number, y: number, w: number, h: number, out: number, alpha = 1): void {
    const p = this.pose.project
    const a0 = this.along(x)
    const a1 = this.along(x + w)
    const b1 = this.above(y)
    const b0 = this.above(y + h)
    this.shape(ctx, [p(a0, b1, CASE_BACK), p(a1, b1, CASE_BACK), p(a1, b1, out), p(a0, b1, out)], '#38322c', 0, alpha)
    this.shape(ctx, [p(a0, b1, CASE_BACK), p(a1, b1, CASE_BACK), p(a1, b1, out), p(a0, b1, out)], 'rgba(255, 170, 90, 0.12)', 0, alpha)
    const end = [p(a1, b1, out), p(a1, b1, CASE_BACK), p(a1, b0, CASE_BACK), p(a1, b0, out)]
    this.shape(ctx, end, '#221d18', 0, alpha)
    // Clear plastic: the neon shows in its end, brightest at the corner nearest the room.
    const g = ctx.createLinearGradient(end[0]![0], 0, end[1]![0], 0)
    g.addColorStop(0, 'rgba(255, 160, 70, 0.4)')
    g.addColorStop(1, 'rgba(255, 160, 70, 0.04)')
    this.shape(ctx, end, g, 0, alpha)
    this.warp(ctx, spine, this.pose.upright(a0, a1, b0, b1, out), 5, alpha)
  }

  /** A case on its way between the rack and the cassette door (or back). */
  private drawFlight(i: number, travel: number): void {
    const slot = this.slot(i)
    if (!slot) return
    const e = easeInOutCubic(travel)
    // Where it started, in the fronts' own measure, and where the door wants it.
    const from = { a: SHELF.a + (SPINE.x / RW) * SHELF.w, b: SHELF.h * (1 - (slot.y + slot.h) / RH), w: (SPINE.w / RW) * SHELF.w, h: (slot.h / RH) * SHELF.h }
    const to = { a: ((WIN.x + 8) / FW) * BOX.w, b: BOX.h * (1 - (WIN.y + WIN.h * 0.62) / FH), w: ((WIN.w - 16) / FW) * BOX.w, h: (slot.h / RH) * SHELF.h }
    // Out toward the bed, across to the radio, then in through the door.
    const across = easeInOutCubic(clamp01((e - 0.3) / 0.45))
    const out = e < 0.3 ? easeInOutCubic(e / 0.3) * 9 : e < 0.75 ? 9 : (1 - easeInOutCubic((e - 0.75) / 0.25)) * 9
    const a = mix(from.a, to.a, across)
    const b = mix(from.b, to.b, across)
    const w = mix(from.w, to.w, across)
    const h = mix(from.h, to.h, across)
    const going = clamp01((e - 0.8) / 0.2)
    this.warp(this.ctx, this.spineArt(this.view.tapes[i] ?? '', false), this.pose.upright(a, a + w, b, b + h, mix(CASE_OUT, 0.4, clamp01(e / 0.08)) + out), 5, 1 - going)
  }

  /** One case, edge-on: the inlay card's spine behind scuffed clear plastic. */
  private spineArt(name: string, lit: boolean): HTMLCanvasElement {
    const key = `${lit ? 1 : 0}${name}`
    const cached = this.spines.get(key)
    if (cached) return cached
    const [c, ctx] = canvasOf(SW * 1.5, SH * 1.5)
    ctx.scale(1.5, 1.5)
    const hue = hueFor(name)
    const rnd = seeded(hue * 7 + name.length + 3)
    ctx.fillStyle = vertical(ctx, 0, SH, '#2a2622', '#0f0d0b')
    ctx.fillRect(0, 0, SW, SH)
    // Cream paper gone yellow, dim: this is a dark corner.
    ctx.fillStyle = vertical(ctx, 5, SH - 7, lit ? '#d8cba8' : '#a99d7f', lit ? '#b9ab88' : '#857a62')
    ctx.fillRect(10, 5, SW - 20, SH - 12)
    ctx.fillStyle = `hsl(${hue} 52% ${lit ? 42 : 31}%)`
    ctx.fillRect(10, 5, 56, SH - 12)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
    ctx.fillRect(66, 5, 2, SH - 12)
    ctx.fillStyle = '#17110a'
    ctx.font = `600 37px ${MONO}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(name.toUpperCase(), 82, SH / 2 + 1, SW - 170)
    ctx.font = `500 22px ${MONO}`
    ctx.textAlign = 'right'
    ctx.globalAlpha = 0.6
    ctx.fillText('C60', SW - 24, SH / 2 + 1)
    ctx.globalAlpha = 1
    // Stains on the card, scuffs on the plastic.
    for (let k = 0; k < 9; k++) {
      ctx.fillStyle = `rgba(90, 60, 30, ${0.05 + rnd() * 0.1})`
      ctx.beginPath()
      ctx.arc(70 + rnd() * (SW - 90), rnd() * SH, 5 + rnd() * 18, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.lineWidth = 0.8
    for (let k = 0; k < 22; k++) {
      const x = rnd() * SW
      const y = rnd() * SH
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + rnd() * 0.12})`
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + 10 + rnd() * 60, y + (rnd() - 0.5) * 6)
      ctx.stroke()
    }
    // Plastic catching the neon on the right, a line of light on top, the seam below.
    const glow = ctx.createLinearGradient(SW * 0.5, 0, SW, 0)
    glow.addColorStop(0, 'rgba(255, 150, 60, 0)')
    glow.addColorStop(1, 'rgba(255, 140, 50, 0.26)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, SW, SH)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'
    ctx.fillRect(0, 0, SW, 2.5)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(0, SH - 6, SW, 6)
    this.spines.set(key, c)
    return c
  }

  /** Everything behind the cassettes, laid out for the current pose: the shelf, lids, sides, the rack's inside and what is left in it. */
  private layBack(): void {
    const ctx = this.shellCtx
    const p = this.pose.project
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.shell.width, this.shell.height)
    this.drawBoard(ctx)

    // The radio's lid: a folded handle, the aerial clipped down along the back, a vent.
    const lid = this.tex('lid', () => {
      const [c, l] = canvasOf(LID_W, LID_H)
      l.fillStyle = vertical(l, 0, LID_H, '#1c1f1e', '#3b3f3d')
      l.fillRect(0, 0, LID_W, LID_H)
      l.drawImage(grunge(LID_W, LID_H, 23, 1), 0, 0)
      recess(l, 150, 96, 340, 92, 20, '#161817')
      raised(l, 164, 110, 312, 64, 16, '#3c3f3d', '#262827')
      recess(l, 190, 128, 260, 28, 12, '#0f1010')
      l.fillStyle = vertical(l, 24, 44, '#b9b7ab', '#5d5c55')
      l.fillRect(40, 26, 520, 14)
      l.fillStyle = '#8f8d82'
      l.fillRect(40, 28, 360, 9)
      raised(l, 548, 18, 44, 30, 8, '#56595a', '#2a2c2b')
      for (let k = 0; k < 9; k++) recess(l, 40 + k * 11, 216, 6, 44, 2, '#0b0c0c')
      raised(l, 520, 196, 70, 62, 12, '#4a4d4b', '#2b2d2c')
      for (const [x, y] of [[18, 18], [622, 18], [18, 262], [622, 262]] as const) screw(l, x, y, 8, x + y)
      // Lit from the window behind it, warmer toward the neon.
      const wash = l.createLinearGradient(0, 0, LID_W, 0)
      wash.addColorStop(0, 'rgba(120, 190, 210, 0.14)')
      wash.addColorStop(1, 'rgba(255, 150, 70, 0.2)')
      l.fillStyle = wash
      l.fillRect(0, 0, LID_W, LID_H)
      return c
    })
    this.warp(ctx, lid, this.pose.lid, 10)

    // The radio's near side, mostly behind the rack: a speaker grille, warm where the neon reaches it.
    const flank = this.tex('flank', () => {
      const [c, f] = canvasOf(SIDE_W, SIDE_H)
      f.fillStyle = vertical(f, 0, SIDE_H, '#3a3d3b', '#1c1e1d')
      f.fillRect(0, 0, SIDE_W, SIDE_H)
      raised(f, 10, 10, SIDE_W - 20, SIDE_H - 20, 10, '#3f4341', '#242626')
      for (let k = 0; k < 16; k++) recess(f, 34, 40 + k * 15, SIDE_W - 68, 7, 3, '#080909')
      for (const [x, y] of [[24, 24], [SIDE_W - 24, 24], [24, SIDE_H - 24], [SIDE_W - 24, SIDE_H - 24]] as const) screw(f, x, y, 8, x + y)
      f.drawImage(grunge(SIDE_W, SIDE_H, 31, 1), 0, 0)
      const lit = f.createLinearGradient(0, 0, SIDE_W, 0)
      lit.addColorStop(0, 'rgba(255, 140, 50, 0.06)')
      lit.addColorStop(1, 'rgba(255, 140, 50, 0.3)')
      f.fillStyle = lit
      f.fillRect(0, 0, SIDE_W, SIDE_H)
      return c
    })
    this.warp(ctx, flank, this.pose.nearSide, 8)

    // Inside the rack: the back wall, the far wall turned toward us, the three boards the cases stand on.
    const far = this.along(16)
    const near = this.along(RW - 16)
    const head = this.above(16)
    const foot = this.above(RH - 16)
    this.shape(ctx, this.pose.upright(far, near, foot, head, RACK_BACK), '#090706')
    const inner = this.tex('rackInner', () => {
      const [c, w] = canvasOf(120, SIDE_H)
      const g = w.createLinearGradient(0, 0, 120, 0)
      g.addColorStop(0, '#6a4d33')
      g.addColorStop(1, '#1a130d')
      w.fillStyle = g
      w.fillRect(0, 0, 120, SIDE_H)
      const rnd = seeded(13)
      for (let k = 0; k < 40; k++) {
        w.fillStyle = `rgba(0, 0, 0, ${0.06 + rnd() * 0.2})`
        w.fillRect(rnd() * 120, 0, 1 + rnd() * 3, SIDE_H)
      }
      return c
    })
    this.warp(ctx, inner, [p(far, head, 0), p(far, head, RACK_BACK), p(far, foot, RACK_BACK), p(far, foot, 0)], 6)
    const floor = this.tex('rackFloor', () => {
      const [c, w] = canvasOf(RW, 120)
      w.fillStyle = vertical(w, 0, 120, '#120e0a', '#4a3828')
      w.fillRect(0, 0, RW, 120)
      const rnd = seeded(17)
      for (let k = 0; k < 40; k++) {
        w.fillStyle = `rgba(0, 0, 0, ${0.06 + rnd() * 0.2})`
        w.fillRect(0, rnd() * 120, RW, 1 + rnd() * 3)
      }
      return c
    })
    for (const y of [206, 412, RH - 16]) {
      const b = this.above(y)
      this.warp(ctx, floor, [p(far, b, RACK_BACK), p(near, b, RACK_BACK), p(near, b, 0), p(far, b, 0)], 6)
    }

    // Spare cases under the tapes, so the stacks look lived in.
    let first = 0
    STACKS.forEach((stack, n) => {
      const count = Math.min(stack.cap, Math.max(0, this.travel.length - first))
      for (let k = 0; k < stack.cap - count; k++) {
        const nudge = ((k * 37 + n * 11) % 9) - 4
        this.caseBox(ctx, this.blankArt(n * 8 + k, false), SPINE.x + nudge, stack.floor - (k + 1) * stack.h, SPINE.w, stack.h, CASE_OUT - ((k * 5 + n) % 3) * 0.5)
      }
      first += count
    })
    // The loose ones in the middle, standing on end, furthest first.
    ;[[40, 168], [86, 174], [132, 164], [204, 170], [262, 160]].forEach(([x, tall], k) => {
      this.caseBox(ctx, this.blankArt(20 + k, true), x!, 412 - tall!, 42, tall!, CASE_OUT - (k % 2) * 0.9)
    })
  }

  /** What stands in front of the cassettes: one last loose case, then the rack's lid, side and frame. */
  private layFrame(): void {
    const ctx = this.frameCtx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.frame.width, this.frame.height)
    this.caseBox(ctx, this.blankArt(31, true), 342, RH - 16 - 164, 38, 164, CASE_OUT)
    // The rack's lid and the side toward us close it in: they hide whatever of its inside lies behind them.
    const top = this.tex('rackLid', () => {
      const [c, t] = canvasOf(LID_W, LID_H)
      t.fillStyle = vertical(t, 0, LID_H, '#1d1a16', '#3d3329')
      t.fillRect(0, 0, LID_W, LID_H)
      t.drawImage(grunge(LID_W, LID_H, 41, 1), 0, 0)
      t.fillStyle = 'rgba(255, 150, 70, 0.14)'
      t.fillRect(LID_W * 0.4, 0, LID_W * 0.6, LID_H)
      return c
    })
    this.warp(ctx, top, this.pose.rackLid, 6)

    const side = this.tex('rackSide', () => {
      const [c, s] = canvasOf(SIDE_W, SIDE_H)
      s.fillStyle = vertical(s, 0, SIDE_H, '#3f3225', '#241c15')
      s.fillRect(0, 0, SIDE_W, SIDE_H)
      // Plywood: long grain, a hand-hold cut through near the top.
      const rnd = seeded(5)
      for (let k = 0; k < 90; k++) {
        s.fillStyle = rnd() > 0.5 ? `rgba(0, 0, 0, ${0.05 + rnd() * 0.16})` : `rgba(255, 210, 160, ${0.02 + rnd() * 0.06})`
        s.fillRect(rnd() * SIDE_W, 0, 1 + rnd() * 3, SIDE_H)
      }
      s.drawImage(grunge(SIDE_W, SIDE_H, 77, 1), 0, 0)
      recess(s, 52, 70, 96, 44, 22, '#070605')
      s.fillStyle = 'rgba(0, 0, 0, 0.5)'
      s.fillRect(0, 0, 12, SIDE_H)
      s.fillRect(0, SIDE_H - 16, SIDE_W, 16)
      s.fillStyle = 'rgba(255, 220, 180, 0.2)'
      s.fillRect(12, 0, 3, SIDE_H)
      for (const [x, y] of [[32, 26], [168, 26], [32, 602], [168, 602], [32, 316], [168, 316]] as const) screw(s, x, y, 9, x * y)
      // This is the side the neon reaches.
      const warm = s.createLinearGradient(0, 0, SIDE_W, 0)
      warm.addColorStop(0, 'rgba(255, 140, 50, 0.1)')
      warm.addColorStop(1, 'rgba(255, 140, 50, 0.3)')
      s.fillStyle = warm
      s.fillRect(0, 0, SIDE_W, SIDE_H)
      return c
    })
    this.warp(ctx, side, this.pose.rackSide, 8)
    this.warp(ctx, this.tex('rackFrame', () => rackFrame()), this.pose.rack, 14)
  }

  /** A spare case's spine, something scrawled along its card: lying, or stood on end. */
  private blankArt(k: number, standing: boolean): HTMLCanvasElement {
    return this.tex(`blank${k}${standing}`, () => {
      const [flat, ctx] = canvasOf(SW, SH)
      const rnd = seeded(101 + k * 13)
      const tone = rnd()
      ctx.fillStyle = vertical(ctx, 0, SH, '#26221e', '#0e0c0a')
      ctx.fillRect(0, 0, SW, SH)
      ctx.fillStyle = vertical(ctx, 0, SH, `hsl(42 ${18 + tone * 10}% ${32 + tone * 13}%)`, `hsl(40 16% ${23 + tone * 9}%)`)
      ctx.fillRect(9, 5, SW - 18, SH - 12)
      ctx.fillStyle = `hsl(${HUES[k % HUES.length]!} 36% 25%)`
      ctx.fillRect(9, 5, 46, SH - 12)
      // Handwriting, more or less.
      ctx.strokeStyle = 'rgba(24, 18, 12, 0.78)'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      let px = 76
      ctx.moveTo(px, SH / 2)
      const stop = SW * (0.5 + rnd() * 0.36)
      while (px < stop) {
        px += 4 + rnd() * 10
        if (rnd() > 0.84) {
          px += 14
          ctx.moveTo(px, SH / 2 + (rnd() - 0.5) * SH * 0.3)
        } else ctx.lineTo(px, SH / 2 + (rnd() - 0.5) * SH * 0.46)
      }
      ctx.stroke()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)'
      ctx.fillRect(0, 0, SW, 2.5)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(0, SH - 6, SW, 6)
      ctx.fillStyle = 'rgba(255, 140, 50, 0.12)'
      ctx.fillRect(SW * 0.6, 0, SW * 0.4, SH)
      if (!standing) return flat
      const [up, u] = canvasOf(SH, SW)
      u.translate(0, SW)
      u.rotate(-Math.PI / 2)
      u.drawImage(flat, 0, 0)
      return up
    })
  }

  /** The shelf under them: a board along the wall, dark underneath, shadowed where they stand. */
  private drawBoard(ctx: Ctx): void {
    const { a0, a1, front, back, t } = BOARD
    const lip = this.pose.upright(a0, a1, -t, 0, front)
    // Nothing is lit under a shelf: what was painted there sinks into its shadow.
    const under = ctx.createLinearGradient(0, lip[3][1] * RES - DECK_RECT[1] * RES, 0, (lip[2][1] + 22) * RES - DECK_RECT[1] * RES)
    under.addColorStop(0, 'rgba(0, 0, 0, 0.92)')
    under.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = under
    ctx.beginPath()
    const at = (p: P): P => [(p[0] - DECK_RECT[0]) * RES, (p[1] - DECK_RECT[1]) * RES]
    const end = this.pose.project(a1, -t, back)
    const points = [at(lip[3]), at(lip[2]), at(end), at([end[0], end[1] + 30]), at([lip[3][0], lip[2][1] + 30])]
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    const [wood, w] = canvasOf(LID_W, LID_H)
    const rnd = seeded(29)
    w.fillStyle = vertical(w, 0, LID_H, '#17130f', '#3b2f24')
    w.fillRect(0, 0, LID_W, LID_H)
    for (let k = 0; k < 70; k++) {
      w.fillStyle = rnd() > 0.5 ? `rgba(0, 0, 0, ${0.06 + rnd() * 0.2})` : `rgba(255, 210, 160, ${0.02 + rnd() * 0.06})`
      w.fillRect(0, rnd() * LID_H, LID_W, 1 + rnd() * 3)
    }
    w.drawImage(grunge(LID_W, LID_H, 67, 1), 0, 0)
    this.warp(ctx, wood, [this.pose.project(a0, 0, back), this.pose.project(a1, 0, back), this.pose.project(a1, 0, front), this.pose.project(a0, 0, front)], 10)
    // Where the two boxes stand, and the shade they throw toward the room.
    const end1 = SHELF.a + SHELF.w
    this.shape(ctx, [this.pose.project(-1, 0, 4), this.pose.project(end1, 0, 4), this.pose.project(end1 + 1, 0, -SHELF.d), this.pose.project(BOX.w, 0, -BOX.d), this.pose.project(-1, 0, -BOX.d)], 'rgba(0, 0, 0, 0.7)', 1.6)

    // The board's edge toward the room catches the window; its near end, the neon.
    const [edge, e] = canvasOf(LID_W, 40)
    e.fillStyle = vertical(e, 0, 40, '#6b5a48', '#2a2119')
    e.fillRect(0, 0, LID_W, 40)
    for (let k = 0; k < 50; k++) {
      e.fillStyle = `rgba(0, 0, 0, ${0.08 + rnd() * 0.22})`
      e.fillRect(rnd() * LID_W, 0, 2 + rnd() * 30, 40)
    }
    e.fillStyle = 'rgba(190, 225, 235, 0.3)'
    e.fillRect(0, 0, LID_W, 5)
    this.warp(ctx, edge, lip, 12)
    this.shape(ctx, [this.pose.project(a1, 0, front), this.pose.project(a1, 0, back), this.pose.project(a1, -t, back), this.pose.project(a1, -t, front)], '#4a3420')
    this.shape(ctx, [this.pose.project(a1, 0, front), this.pose.project(a1, 0, back), this.pose.project(a1, -0.8, back), this.pose.project(a1, -0.8, front)], 'rgba(255, 200, 140, 0.22)')
  }

  /** The radio's front with nothing live on it: steel, panels, bezels, legends, wear. Drawn once. */
  private buildPlate(): void {
    const ctx = this.plateCtx
    ctx.setTransform(FRES, 0, 0, FRES, 0, 0)
    ctx.clearRect(0, 0, FW, FH)
    const wear = grunge(FW, FH, 11, FRES)

    // The chassis, then three bolted panels standing proud of it.
    rr(ctx, 0, 0, FW, FH, 16)
    ctx.fillStyle = vertical(ctx, 0, FH, '#303332', '#191b1b')
    ctx.fill()
    raised(ctx, 9, 9, FW - 18, 170, 11, '#3c403e', '#292c2b')
    raised(ctx, 9, 186, FW - 18, 270, 11, '#383c3a', '#252827')
    raised(ctx, 9, 463, FW - 18, 184, 11, '#353937', '#202222')
    // Lugs for a strap, either side.
    raised(ctx, -4, 250, 12, 60, 4, '#55585a', '#2a2c2b')
    raised(ctx, FW - 8, 250, 12, 60, 4, '#55585a', '#2a2c2b')

    // Top panel: the toggle's well, the display's bezel, the band switch.
    recess(ctx, 60, 60, 48, 92, 24, '#0a0b0b')
    const collar = ctx.createRadialGradient(80, 101, 1, 84, 106, 17)
    collar.addColorStop(0, '#8d8c82')
    collar.addColorStop(1, '#2a2a27')
    ctx.fillStyle = collar
    ctx.beginPath()
    ctx.arc(84, 106, 16, 0, Math.PI * 2)
    ctx.fill()
    raised(ctx, 131, 33, 368, 144, 10, '#2c2f2e', '#151716')
    recess(ctx, LCD.x - 4, LCD.y - 4, LCD.w + 8, LCD.h + 8, 5, '#020606')
    recess(ctx, 522, 82, 30, 62, 6, '#070808')
    engrave(ctx, 'FM/AM', 537, 70, 13)
    engrave(ctx, 'AM', 560, 100, 12, 'left')
    engrave(ctx, 'OFF', 560, 132, 12, 'left')
    engrave(ctx, 'TAPE', 537, 164, 13)
    ctx.strokeStyle = 'rgba(214, 208, 190, 0.4)'
    ctx.lineWidth = 1.2
    for (const y of [96, 128]) {
      ctx.beginPath()
      ctx.moveTo(553, y)
      ctx.lineTo(558, y)
      ctx.stroke()
    }

    // Middle panel: two meter housings, the door, the knobs' wells.
    for (const y of VU.ys) {
      raised(ctx, VU.x - 7, y - 7, VU.w + 14, VU.h + 38, 9, '#262928', '#111212')
      recess(ctx, VU.x - 2, y - 2, VU.w + 4, VU.h + 4, 4, '#1a1408')
      engrave(ctx, 'VU', VU.x + VU.w / 2, y + VU.h + 23, 13)
    }
    raised(ctx, DOOR.x, DOOR.y, DOOR.w, DOOR.h, 14, '#4b4f4d', '#2d302f')
    rr(ctx, DOOR.x + 8, DOOR.y + 8, DOOR.w - 16, DOOR.h - 16, 9)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.lineWidth = 2
    ctx.stroke()
    recess(ctx, WIN.x - 6, WIN.y - 6, WIN.w + 12, WIN.h + 12, 8, '#050403')
    // The door's pull, pressed into the steel under the window.
    for (const [dy, color] of [[1.5, 'rgba(255, 250, 232, 0.2)'], [0, 'rgba(8, 8, 8, 0.85)']] as const) {
      ctx.strokeStyle = color
      ctx.lineWidth = 2.6
      ctx.lineJoin = 'round'
      const cx = DOOR.x + DOOR.w / 2
      const y = DOOR.y + DOOR.h - 22 + dy
      ctx.beginPath()
      ctx.moveTo(cx - 34, y)
      ctx.lineTo(cx - 10, y)
      ctx.lineTo(cx + 6, y - 11)
      ctx.lineTo(cx + 16, y)
      ctx.lineTo(cx + 34, y)
      ctx.moveTo(cx - 34, y + 7)
      ctx.lineTo(cx + 34, y + 7)
      ctx.stroke()
    }
    for (const [knob, label] of [[VOLUME, 'VOLUME'], [TUNING, 'TUNING']] as const) {
      engrave(ctx, label, knob[0], knob[1] - KNOB_R - 20, 14)
      engrave(ctx, '−', knob[0] - KNOB_R - 4, knob[1] + KNOB_R + 14, 16)
      engrave(ctx, '+', knob[0] + KNOB_R + 4, knob[1] + KNOB_R + 14, 16)
      ctx.beginPath()
      ctx.arc(knob[0], knob[1], KNOB_R + 11, 0, Math.PI * 2)
      ctx.fillStyle = '#0c0d0d'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = vertical(ctx, knob[1] - KNOB_R - 11, knob[1] + KNOB_R + 11, 'rgba(0, 0, 0, 0.8)', 'rgba(255, 250, 232, 0.22)')
      ctx.stroke()
    }

    // Bottom panel: the tone slide, the transport's trough.
    recess(ctx, 24, 472, 572, 166, 9, 'rgba(18, 19, 19, 0.55)')
    recess(ctx, 66, 496, 24, 68, 6, '#060707')
    engrave(ctx, 'FM/', 58, 514, 11, 'right')
    engrave(ctx, 'AM', 58, 533, 11, 'right')
    engrave(ctx, 'SUT', 58, 552, 11, 'right')
    ctx.fillStyle = LEGEND
    for (const [x, y, up] of [[78, 482, 1], [78, 580, -1], [103, 510, 1], [103, 550, -1]] as const) {
      const s = x === 78 ? 7 : 4.5
      ctx.beginPath()
      ctx.moveTo(x - s, y + (up * s) / 2)
      ctx.lineTo(x + s, y + (up * s) / 2)
      ctx.lineTo(x, y - (up * s) / 2)
      ctx.closePath()
      ctx.fill()
    }
    const row = KEYS.length * KEY.w + (KEYS.length - 1) * KEY.gap
    recess(ctx, KEY.x - 8, KEY.y - 6, row + 16, KEY.h + 20, 6, '#050505')
    engrave(ctx, 'STEREO CASSETTE RECEIVER', KEY.x + row, 624, 11, 'right', 'rgba(214, 208, 190, 0.42)')
    engrave(ctx, 'RGB-60', KEY.x, 624, 11, 'left', 'rgba(214, 208, 190, 0.42)')

    for (const [x, y] of [
      [28, 28], [FW - 28, 28], [28, 160], [FW - 28, 160],
      [28, 204], [FW - 28, 204], [28, 438], [FW - 28, 438],
      [40, 487], [FW - 40, 487], [40, 622], [FW - 40, 622],
    ] as const) {
      screw(ctx, x, y, 8.5, x * 0.37 + y * 0.11)
    }

    // The years, over all of it; then how the room lights it: cool from the window, warm off the neon, dark underneath.
    ctx.save()
    rr(ctx, 0, 0, FW, FH, 16)
    ctx.clip()
    ctx.drawImage(wear, 0, 0, FW, FH)
    const cast = ctx.createLinearGradient(0, 0, FW, 0)
    cast.addColorStop(0, 'rgba(110, 180, 205, 0.1)')
    cast.addColorStop(0.6, 'rgba(0, 0, 0, 0)')
    cast.addColorStop(1, 'rgba(255, 150, 70, 0.14)')
    ctx.fillStyle = cast
    ctx.fillRect(0, 0, FW, FH)
    ctx.fillStyle = vertical(ctx, 0, FH, 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0.05)', 'rgba(0, 0, 0, 0.34)')
    ctx.fillRect(0, 0, FW, FH)
    ctx.restore()
    // The chassis' own edge: a worn bright line above, shadow below.
    rr(ctx, 1.5, 1.5, FW - 3, FH - 3, 15)
    ctx.lineWidth = 3
    ctx.strokeStyle = vertical(ctx, 0, FH, 'rgba(240, 236, 220, 0.5)', 'rgba(240, 236, 220, 0.1)', 'rgba(0, 0, 0, 0.7)')
    ctx.stroke()
  }

  /** The front as it is right now: the kept plate, plus everything on it that moves or glows. */
  private drawFace(): void {
    const ctx = this.faceCtx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.face.width, this.face.height)
    ctx.drawImage(this.plate, 0, 0)
    ctx.setTransform(FRES, 0, 0, FRES, 0, 0)
    this.capsCtx.setTransform(1, 0, 0, 1, 0, 0)
    this.capsCtx.clearRect(0, 0, this.caps.width, this.caps.height)
    this.capsCtx.setTransform(FRES, 0, 0, FRES, 0, 0)
    const { loaded } = this.view
    /** How far the loaded cassette has settled behind the door's window. */
    const seated = loaded === null ? 0 : clamp01((this.travel[loaded]! - 0.85) / 0.15)
    this.seated = seated
    this.drawReadout(ctx, seated >= 1)
    this.drawBand(ctx, seated >= 1)
    this.drawMeters(ctx)
    this.drawWindow(ctx, seated)
    this.drawKnob(ctx, VOLUME, this.view.volume, this.hover?.kind === 'volume')
    // Each tape has its own spot on the dial.
    this.drawKnob(ctx, TUNING, loaded === null ? 0.35 : (loaded + 1) / (this.view.tapes.length + 1), false)
    this.drawSlide(ctx)
    this.drawKeys(ctx)
  }

  /**
   * Everything that stands off the front, nearest last: each a little box with a
   * top and an end toward us, its face lifted from the flat drawing.
   */
  private drawRelief(ctx: Ctx): void {
    const steel = ['#3a3d3b', '#141615', '#6d716e'] as const
    const things: { near: number; draw: () => void }[] = []
    const box = (x: number, y: number, w: number, h: number, out: number, tones: readonly [string, string, string]) =>
      things.push({ near: x + w, draw: () => this.box(ctx, x, y, w, h, out, tones) })
    box(131, 33, 368, 144, BEZEL_OUT, steel)
    for (const y of VU.ys) box(VU.x - 7, y - 7, VU.w + 14, VU.h + 38, HOUSING_OUT, steel)
    box(DOOR.x, DOOR.y, DOOR.w, DOOR.h, HOUSING_OUT, ['#454846', '#1a1c1b', '#7f8380'])
    const chrome = ['#8a887e', '#3a3934', '#e4e1d4'] as const
    box(525, this.seated >= 1 ? 116 : 86, 24, 26, NUB_OUT, chrome)
    box(64, 516, 28, 26, NUB_OUT, chrome)
    KEYS.forEach((k, i) => {
      const on = (k === 'play' && this.view.playing) || (k === 'pause' && this.view.paused)
      const out = mix(KEY_OUT, KEY_DOWN, this.press.get(k) ?? 0)
      box(KEY.x + i * (KEY.w + KEY.gap), KEY.y, KEY.w, KEY.h, out, on ? ['#c9761a', '#6b3a0c', '#ffe3a1'] : ['#6f6e66', '#2b2b28', '#c9c7ba'])
    })
    for (const knob of [VOLUME, TUNING]) things.push({ near: knob[0] + KNOB_R, draw: () => this.knob(ctx, knob) })
    things.push({ near: 108, draw: () => this.lever(ctx, this.seated >= 1) })
    things.sort((p, q) => p.near - q.near)
    for (const thing of things) thing.draw()
  }

  /** A point on the front, in its logical pixels, `out` units off it. */
  private off(x: number, y: number, out: number): P {
    return this.pose.project((x / FW) * BOX.w, BOX.h * (1 - y / FH), out)
  }

  /** One raised part: its top, its end toward us, then its face, copied from the flat front. */
  private box(ctx: Ctx, x: number, y: number, w: number, h: number, out: number, [end, endLow, top]: readonly [string, string, string]): void {
    const far = this.off(x, y, out)
    const near = this.off(x + w, y, out)
    const foot = this.off(x + w, y + h, 0)
    // The end toward us: lit warm by the neon at the top, lost in shadow lower down.
    const g = ctx.createLinearGradient(0, near[1], 0, foot[1])
    g.addColorStop(0, end)
    g.addColorStop(1, endLow)
    this.shape(ctx, [near, this.off(x + w, y, 0), foot, this.off(x + w, y + h, out)], g)
    this.shape(ctx, [near, this.off(x + w, y, 0), foot, this.off(x + w, y + h, out)], 'rgba(255, 150, 60, 0.12)')
    this.shape(ctx, [this.off(x, y, 0), this.off(x + w, y, 0), near, far], top)
    this.warp(ctx, this.face, [far, near, this.off(x + w, y + h, out), this.off(x, y + h, out)], 5, 1, [x * FRES, y * FRES, w * FRES, h * FRES])
    // A line of light where the face meets its top and its end.
    ctx.save()
    ctx.setTransform(RES, 0, 0, RES, -DECK_RECT[0] * RES, -DECK_RECT[1] * RES)
    ctx.strokeStyle = 'rgba(255, 248, 226, 0.4)'
    ctx.lineWidth = 0.14
    ctx.beginPath()
    ctx.moveTo(far[0], far[1])
    ctx.lineTo(near[0], near[1])
    ctx.lineTo(this.off(x + w, y + h, out)[0], this.off(x + w, y + h, out)[1])
    ctx.stroke()
    ctx.restore()
  }

  /** A knob: a knurled drum standing off the front, its cap lifted from the caps' own canvas. */
  private knob(ctx: Ctx, [x, y]: P): void {
    const r = KNOB_R - 1
    const n = 40
    const ring = (out: number) => Array.from({ length: n }, (_v, k) => this.off(x + Math.cos((k / n) * Math.PI * 2) * r, y + Math.sin((k / n) * Math.PI * 2) * r, out))
    const foot = ring(0)
    const head = ring(KNOB_OUT)
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * Math.PI * 2
      // Round the drum: light where it turns up toward the ceiling and toward us, knurled all the way.
      const lit = clamp01(0.25 + 0.5 * Math.cos(a) - 0.45 * Math.sin(a))
      const v = Math.round((k % 2 ? 26 : 44) + lit * 70)
      this.shape(ctx, [foot[k]!, foot[(k + 1) % n]!, head[(k + 1) % n]!, head[k]!], `rgb(${v + 8}, ${v + 3}, ${v - 4})`)
    }
    const s = r + 1
    this.warp(ctx, this.caps, [this.off(x - s, y - s, KNOB_OUT), this.off(x + s, y - s, KNOB_OUT), this.off(x + s, y + s, KNOB_OUT), this.off(x - s, y + s, KNOB_OUT)], 6, 1, [
      (x - s) * FRES,
      (y - s) * FRES,
      s * 2 * FRES,
      s * 2 * FRES,
    ])
  }

  /** The power toggle, top left: a chromed bat standing out of its collar, up while a tape is in. */
  private lever(ctx: Ctx, on: boolean): void {
    const root = this.off(84, 106, 0.4)
    const tip = this.off(84, 106 + (on ? -26 : 26), 3.2)
    ctx.save()
    ctx.setTransform(RES, 0, 0, RES, -DECK_RECT[0] * RES, -DECK_RECT[1] * RES)
    ctx.lineCap = 'round'
    for (const [width, color, dx] of [[1.5, 'rgba(0, 0, 0, 0.55)', 0.4], [1.2, '#55544e', 0], [0.7, '#c9c6b8', -0.1], [0.25, '#fbf9ee', -0.2]] as const) {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(root[0] + dx, root[1] + (dx > 0 ? 0.6 : 0))
      ctx.lineTo(tip[0] + dx, tip[1] + (dx > 0 ? 0.6 : 0))
      ctx.stroke()
    }
    ctx.fillStyle = '#e9e6d9'
    ctx.beginPath()
    ctx.arc(tip[0], tip[1], 0.9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.beginPath()
    ctx.arc(tip[0] - 0.25, tip[1] - 0.3, 0.3, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /** The LCD: TRACK, the title, then the tape's name and the time, in lit dots. */
  private drawReadout(ctx: Ctx, has: boolean): void {
    const { playing, paused, title, trackLabel, at, loaded, tapes } = this.view
    const { x, y, w, h } = LCD
    ctx.save()
    rr(ctx, x, y, w, h, 3)
    ctx.clip()
    const glass = ctx.createRadialGradient(x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, w * 0.7)
    glass.addColorStop(0, '#0a2a2c')
    glass.addColorStop(1, '#031112')
    ctx.fillStyle = glass
    ctx.fillRect(x, y, w, h)

    ctx.fillStyle = INK
    ctx.shadowColor = 'rgba(143, 240, 234, 0.75)'
    ctx.shadowBlur = 12
    ctx.textBaseline = 'alphabetic'
    ctx.font = `600 31px ${MONO}`
    const left = x + 16
    const room = w - 32

    ctx.textAlign = 'left'
    ctx.fillText(has ? `TRACK: ${trackLabel}` : 'TRACK:', left, y + 36)
    if (has && (playing || paused)) {
      ctx.textAlign = 'right'
      ctx.globalAlpha = paused && Math.floor(this.time * 2) % 2 ? 0.2 : 0.85
      ctx.fillText(playing ? '▶' : 'Ⅱ', x + w - 16, y + 36)
      ctx.globalAlpha = 1
      ctx.textAlign = 'left'
    }
    // The title scrolls when it is too long for the glass.
    const text = (has ? title : 'INSERT TAPE').toUpperCase()
    const width = ctx.measureText(text).width
    if (width <= room) ctx.fillText(text, left, y + 69)
    else {
      const span = width + 80
      const dx = (playing ? this.time * 38 : 0) % span
      ctx.fillText(text, left - dx, y + 69)
      ctx.fillText(text, left - dx + span, y + 69)
    }
    const time = has ? clock(at) : '--:--'
    ctx.textAlign = 'right'
    ctx.fillText(time, x + w - 16, y + 102)
    ctx.textAlign = 'left'
    const name = has && loaded !== null ? (tapes[loaded] ?? '').toUpperCase() : ''
    ctx.fillText(name, left, y + 102, room - ctx.measureText(time).width - 20)
    ctx.shadowBlur = 0

    // The dots the characters are made of, then the glass over them.
    ctx.fillStyle = ctx.createPattern(dots(), 'repeat')!
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = 'rgba(190, 255, 250, 0.05)'
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + w * 0.62, y)
    ctx.lineTo(x + w * 0.5, y + h * 0.48)
    ctx.lineTo(x, y + h * 0.48)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  /** The band slide, top right: it drops to TAPE when a cassette is in. */
  private drawBand(ctx: Ctx, tape: boolean): void {
    const y = tape ? 116 : 86
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(526, y + 3, 24, 26)
    ctx.fillStyle = vertical(ctx, y, y + 26, '#d2cfc1', '#84827a', '#4c4b45')
    rr(ctx, 525, y, 24, 26, 3)
    ctx.fill()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    for (let k = 0; k < 4; k++) ctx.fillRect(528, y + 5 + k * 5, 18, 1.8)
  }

  /** Two VU meters, one above the other: lamp-lit cream faces, a red zone, needles that ride the music. */
  private drawMeters(ctx: Ctx): void {
    const live = this.view.playing && this.view.loaded !== null && this.travel[this.view.loaded]! >= 1
    const { x, w, h } = VU
    VU.ys.forEach((y, ch) => {
      ctx.save()
      // The lamp spills a little past the glass.
      ctx.shadowColor = `rgba(255, 190, 90, ${live ? 0.85 : 0.5})`
      ctx.shadowBlur = live ? 22 : 12
      const lamp = ctx.createRadialGradient(x + w / 2, y + h * 0.95, 4, x + w / 2, y + h * 0.7, w * 0.8)
      lamp.addColorStop(0, live ? '#fff0b8' : '#f1d894')
      lamp.addColorStop(0.6, live ? '#f0c366' : '#c9a452')
      lamp.addColorStop(1, live ? '#b07a2a' : '#7c5f2a')
      rr(ctx, x, y, w, h, 3)
      ctx.fillStyle = lamp
      ctx.fill()
      ctx.restore()

      ctx.save()
      rr(ctx, x, y, w, h, 3)
      ctx.clip()
      const px = x + w / 2
      const py = y + h + 24
      const reach = h + 8
      const angleOf = (level: number) => -Math.PI / 2 + (-0.78 + 1.56 * level)
      ctx.strokeStyle = '#241a0e'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(px, py, reach - 22, angleOf(0), angleOf(0.7))
      ctx.stroke()
      ctx.strokeStyle = '#b0281b'
      ctx.lineWidth = 4.5
      ctx.beginPath()
      ctx.arc(px, py, reach - 23.5, angleOf(0.7), angleOf(1))
      ctx.stroke()
      ctx.font = `600 8px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const marks = [['20', 0], ['10', 0.2], ['7', 0.34], ['5', 0.46], ['3', 0.58], ['0', 0.7], ['3', 0.9]] as const
      for (let k = 0; k <= 20; k++) {
        const a = angleOf(k / 20)
        const long = k % 2 === 0
        ctx.strokeStyle = k / 20 > 0.7 ? '#b0281b' : '#241a0e'
        ctx.lineWidth = long ? 1.4 : 0.8
        ctx.beginPath()
        ctx.moveTo(px + Math.cos(a) * (reach - 22), py + Math.sin(a) * (reach - 22))
        ctx.lineTo(px + Math.cos(a) * (reach - (long ? 15 : 18)), py + Math.sin(a) * (reach - (long ? 15 : 18)))
        ctx.stroke()
      }
      for (const [text, level] of marks) {
        const a = angleOf(level)
        ctx.fillStyle = level >= 0.7 ? '#b0281b' : '#241a0e'
        ctx.fillText(text, px + Math.cos(a) * (reach - 8), py + Math.sin(a) * (reach - 8))
      }
      ctx.fillStyle = '#241a0e'
      ctx.font = `700 12px ${MONO}`
      ctx.fillText('VU', px, y + h - 13)

      const t = this.time
      const level = live ? clamp01(0.5 + 0.22 * Math.sin(t * 5.3 + ch * 1.9) + 0.16 * Math.sin(t * 11.7 + ch) + 0.08 * Math.sin(t * 23 + ch * 4)) : 0.04
      const a = angleOf(level)
      for (const [dx, color, width] of [[2.5, 'rgba(60, 30, 0, 0.3)', 2.6], [0, '#140d06', 1.8]] as const) {
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.moveTo(px + dx, py)
        ctx.lineTo(px + dx + Math.cos(a) * (reach - 12), py + Math.sin(a) * (reach - 12))
        ctx.stroke()
      }
      // The glass.
      ctx.fillStyle = vertical(ctx, y, y + h, 'rgba(255, 255, 255, 0.2)', 'rgba(255, 255, 255, 0)', 'rgba(60, 30, 0, 0.18)')
      ctx.fillRect(x, y, w, h)
      ctx.restore()
    })
  }

  /** Behind the door's window: the lamp, and the cassette turning in front of it. */
  private drawWindow(ctx: Ctx, seated: number): void {
    const { loaded, playing, tapes } = this.view
    const { x, y, w, h } = WIN
    // The lamp: low without a tape, warm with one, brighter while it runs.
    const warmth = 0.2 + seated * (playing ? 0.8 : 0.5)
    ctx.save()
    if (seated > 0) {
      ctx.shadowColor = `rgba(255, 150, 50, ${0.75 * seated * (playing ? 1 : 0.6)})`
      ctx.shadowBlur = 26
    }
    rr(ctx, x, y, w, h, 4)
    ctx.fillStyle = '#0a0604'
    ctx.fill()
    ctx.restore()
    ctx.save()
    rr(ctx, x, y, w, h, 4)
    ctx.clip()
    const lamp = ctx.createRadialGradient(x + w / 2, y + h * 0.55, 6, x + w / 2, y + h * 0.55, w * 0.62)
    lamp.addColorStop(0, `rgba(255, 196, 96, ${warmth})`)
    lamp.addColorStop(0.5, `rgba(226, 124, 36, ${warmth * 0.7})`)
    lamp.addColorStop(1, 'rgba(70, 28, 6, 0.25)')
    ctx.fillStyle = lamp
    ctx.fillRect(x, y, w, h)

    const cx = x + w / 2
    const cy = y + h * 0.6
    const reels: readonly number[] = [cx - 50, cx + 50]
    const spin = playing && seated >= 1 ? this.time * 3 : 0
    const progress = this.view.of > 0 ? clamp01(this.view.at / this.view.of) : 0
    if (seated > 0 && loaded !== null) {
      const name = tapes[loaded] ?? ''
      const hue = hueFor(name)
      ctx.globalAlpha = seated
      // A clear shell: you see the lamp through it, darker where the plastic is thick.
      rr(ctx, x + 7, y + 7, w - 14, h - 14, 7)
      ctx.fillStyle = 'rgba(40, 22, 10, 0.5)'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(255, 214, 150, 0.4)'
      ctx.stroke()
      // The label strip, with the tape's name.
      ctx.fillStyle = vertical(ctx, y + 13, y + 41, '#d9cba6', '#b3a47f')
      ctx.fillRect(x + 20, y + 13, w - 40, 28)
      ctx.fillStyle = `hsl(${hue} 52% 34%)`
      ctx.fillRect(x + 20, y + 13, w - 40, 6)
      ctx.fillStyle = '#17110a'
      ctx.font = `600 15px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(name.toUpperCase(), cx, y + 36, w - 60)
      // The tape packs, one emptying into the other.
      reels.forEach((rx, side) => {
        const pack = 17 + 17 * (side === 0 ? 1 - progress : progress)
        const g = ctx.createRadialGradient(rx, cy, 10, rx, cy, pack)
        g.addColorStop(0, '#3a2416')
        g.addColorStop(1, '#170d07')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(rx, cy, pack, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 190, 110, 0.14)'
        ctx.lineWidth = 0.8
        for (let r = 15; r < pack; r += 4) {
          ctx.beginPath()
          ctx.arc(rx, cy, r, 0, Math.PI * 2)
          ctx.stroke()
        }
      })
      // The window in the shell between them, lit straight through.
      rr(ctx, cx - 17, cy - 17, 34, 34, 3)
      ctx.fillStyle = `rgba(255, 176, 64, ${playing ? 0.95 : 0.6})`
      ctx.shadowColor = 'rgba(255, 160, 50, 0.9)'
      ctx.shadowBlur = playing ? 18 : 8
      ctx.fill()
      ctx.shadowBlur = 0
      // Shell screws, and the gap for the heads along the bottom.
      ctx.fillStyle = 'rgba(20, 10, 4, 0.8)'
      for (const [sx, sy] of [[x + 15, y + 15], [x + w - 15, y + 15], [x + 15, y + h - 15], [x + w - 15, y + h - 15]] as const) {
        ctx.beginPath()
        ctx.arc(sx, sy, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.beginPath()
      ctx.moveTo(cx - 62, y + h - 7)
      ctx.lineTo(cx - 50, y + h - 21)
      ctx.lineTo(cx + 50, y + h - 21)
      ctx.lineTo(cx + 62, y + h - 7)
      ctx.closePath()
      ctx.fillStyle = 'rgba(30, 16, 8, 0.6)'
      ctx.fill()
    }
    // The spindles are always there; with a cassette in, they carry its hubs.
    reels.forEach((rx, side) => {
      ctx.globalAlpha = 1
      const a0 = spin * (side === 0 ? 1 : 1.3)
      ctx.fillStyle = seated > 0 ? '#ece4cf' : '#5a5247'
      ctx.beginPath()
      ctx.arc(rx, cy, 13, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = seated > 0 ? '#2a1a10' : '#15120f'
      ctx.beginPath()
      ctx.arc(rx, cy, 8.5, 0, Math.PI * 2)
      ctx.fill()
      // Six teeth that grip the hub.
      ctx.fillStyle = seated > 0 ? '#ece4cf' : '#5a5247'
      for (let k = 0; k < 6; k++) {
        const a = a0 + (k * Math.PI) / 3
        ctx.beginPath()
        ctx.arc(rx + Math.cos(a) * 8, cy + Math.sin(a) * 8, 2.3, 0, Math.PI * 2)
        ctx.fill()
      }
    })
    // The window's glass: grime in the corners, one streak of reflection.
    const grime = ctx.createRadialGradient(cx, y + h / 2, w * 0.3, cx, y + h / 2, w * 0.68)
    grime.addColorStop(0, 'rgba(0, 0, 0, 0)')
    grime.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
    ctx.fillStyle = grime
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = 'rgba(255, 240, 215, 0.09)'
    ctx.beginPath()
    ctx.moveTo(x + w * 0.06, y)
    ctx.lineTo(x + w * 0.3, y)
    ctx.lineTo(x + w * 0.12, y + h)
    ctx.lineTo(x - w * 0.12, y + h)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  /** A knurled black knob in a ring of orange light that fills as far as it is turned. */
  private drawKnob(face: Ctx, [x, y]: P, turn: number, lit: boolean): void {
    let ctx = face
    const from = Math.PI * 0.75
    const sweep = Math.PI * 1.5
    const to = from + sweep * clamp01(turn)
    ctx.lineCap = 'round'
    ctx.lineWidth = 4.5
    ctx.strokeStyle = '#3d2410'
    ctx.beginPath()
    ctx.arc(x, y, KNOB_R + 5, from, from + sweep)
    ctx.stroke()
    ctx.save()
    ctx.strokeStyle = lit ? '#ffd08a' : '#f29a34'
    ctx.shadowColor = 'rgba(255, 150, 50, 0.95)'
    ctx.shadowBlur = lit ? 16 : 9
    ctx.beginPath()
    ctx.arc(x, y, KNOB_R + 5, from, Math.max(to, from + 0.01))
    ctx.stroke()
    ctx.restore()
    ctx.lineCap = 'butt'

    // The shade it throws on the front, away from the neon.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.beginPath()
    ctx.arc(x - 8, y + 4, KNOB_R, 0, Math.PI * 2)
    ctx.fill()

    // Its top: the skirt, the knurling round its edge, the cap. Drawn apart, to stand off the front.
    ctx = this.capsCtx
    const skirt = ctx.createRadialGradient(x - 8, y - 10, 2, x, y, KNOB_R)
    skirt.addColorStop(0, lit ? '#77756b' : '#55544d')
    skirt.addColorStop(0.7, '#1f1f1d')
    skirt.addColorStop(1, '#0c0c0b')
    ctx.fillStyle = skirt
    ctx.beginPath()
    ctx.arc(x, y, KNOB_R - 1, 0, Math.PI * 2)
    ctx.fill()
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2
      ctx.strokeStyle = k % 2 ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 250, 232, 0.13)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(a) * (KNOB_R - 7), y + Math.sin(a) * (KNOB_R - 7))
      ctx.lineTo(x + Math.cos(a) * (KNOB_R - 1.5), y + Math.sin(a) * (KNOB_R - 1.5))
      ctx.stroke()
    }
    const cap = ctx.createLinearGradient(x - KNOB_R, y - KNOB_R, x + KNOB_R, y + KNOB_R)
    cap.addColorStop(0, '#5f5e57')
    cap.addColorStop(0.5, '#262624')
    cap.addColorStop(1, '#101010')
    ctx.fillStyle = cap
    ctx.beginPath()
    ctx.arc(x, y, KNOB_R - 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 250, 232, 0.18)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.save()
    ctx.strokeStyle = AMBER
    ctx.shadowColor = 'rgba(255, 150, 50, 0.9)'
    ctx.shadowBlur = 6
    ctx.lineWidth = 3.6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(to) * 9, y + Math.sin(to) * 9)
    ctx.lineTo(x + Math.cos(to) * (KNOB_R - 9), y + Math.sin(to) * (KNOB_R - 9))
    ctx.stroke()
    ctx.restore()
  }

  /** The tone slide beside the keys. It is only ever where it was left. */
  private drawSlide(ctx: Ctx): void {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(66, 521, 28, 26)
    rr(ctx, 64, 516, 28, 26, 3)
    ctx.fillStyle = vertical(ctx, 516, 542, '#d2cfc1', '#84827a', '#4c4b45')
    ctx.fill()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    for (let k = 0; k < 4; k++) ctx.fillRect(68, 521 + k * 5, 20, 1.8)
  }

  /** The transport: six chunky keys in their trough, each named above. The one in use glows. */
  private drawKeys(ctx: Ctx): void {
    KEYS.forEach((k, i) => {
      const down = this.press.get(k) ?? 0
      const lit = this.hover?.kind === 'key' && this.hover.key === k
      const on = (k === 'play' && this.view.playing) || (k === 'pause' && this.view.paused)
      const x = KEY.x + i * (KEY.w + KEY.gap)
      const y = KEY.y
      engrave(ctx, KEY_LABELS[k], x + KEY.w / 2, KEY.y - 17, 14, 'center', on ? AMBER : LEGEND)

      ctx.save()
      if (on) {
        ctx.shadowColor = 'rgba(255, 160, 50, 0.95)'
        ctx.shadowBlur = 26
      }
      const shade = (lit ? 1.28 : 1) * (1 - down * 0.18)
      const tone = (v: number) => Math.min(255, Math.round(v * shade))
      rr(ctx, x, y, KEY.w, KEY.h, 5)
      ctx.fillStyle = on
        ? vertical(ctx, y, y + KEY.h, '#ffe09a', '#f6a53a', '#b9640f')
        : vertical(ctx, y, y + KEY.h, `rgb(${tone(168)}, ${tone(166)}, ${tone(155)})`, `rgb(${tone(112)}, ${tone(111)}, ${tone(103)})`, `rgb(${tone(66)}, ${tone(66)}, ${tone(61)})`)
      ctx.fill()
      ctx.restore()
      // The dished top where a finger lands.
      rr(ctx, x + 6, y + 7, KEY.w - 12, KEY.h - 16, 4)
      ctx.fillStyle = on
        ? vertical(ctx, y + 7, y + KEY.h - 9, '#f3a743', '#ffc869')
        : vertical(ctx, y + 7, y + KEY.h - 9, `rgb(${tone(84)}, ${tone(84)}, ${tone(78)})`, `rgb(${tone(118)}, ${tone(117)}, ${tone(109)})`)
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.stroke()
      // Worn by the same thumb for years.
      ctx.save()
      rr(ctx, x, y, KEY.w, KEY.h, 5)
      ctx.clip()
      ctx.globalAlpha = on ? 0.2 : 0.4
      ctx.drawImage(this.keyWear(), i * 70, 0, KEY.w * FRES, KEY.h * FRES, x, y, KEY.w, KEY.h)
      ctx.restore()
      ctx.fillStyle = 'rgba(255, 250, 232, 0.28)'
      keyGlyph(ctx, k, x + KEY.w / 2, y + KEY.h / 2 + 1.2)
      ctx.fillStyle = on ? '#5a2c06' : '#161616'
      keyGlyph(ctx, k, x + KEY.w / 2, y + KEY.h / 2)
    })
  }

  private wear: HTMLCanvasElement | null = null

  private keyWear(): HTMLCanvasElement {
    return (this.wear ??= grunge(FW, KEY.h + 8, 97, FRES))
  }
}

/** The rack's frame alone, flat and see-through between its boards: four sides, two shelves, the shade under each. */
function rackFrame(): HTMLCanvasElement {
  const [c, ctx] = canvasOf(RW * RRES, RH * RRES)
  ctx.scale(RRES, RRES)
  const rnd = seeded(19)
  // The shade each board throws on what stands under it.
  for (const y of [16, 220, 426]) {
    ctx.fillStyle = vertical(ctx, y, y + 26, 'rgba(0, 0, 0, 0.75)', 'rgba(0, 0, 0, 0)')
    ctx.fillRect(16, y, RW - 32, 26)
  }
  const board = (x: number, y: number, w: number, h: number) => {
    const tall = h > w
    const g = tall ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h)
    g.addColorStop(0, '#86694e')
    g.addColorStop(0.5, '#5c4735')
    g.addColorStop(1, '#30241a')
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
    for (let k = 0; k < (tall ? h : w) / 9; k++) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.06 + rnd() * 0.2})`
      if (tall) ctx.fillRect(x + rnd() * w, y, 1 + rnd() * 1.6, h)
      else ctx.fillRect(x, y + rnd() * h, w, 1 + rnd() * 1.4)
    }
    for (let k = 0; k < (w * h) / 500; k++) {
      ctx.fillStyle = `rgba(140, 66, 24, ${0.1 + rnd() * 0.3})`
      ctx.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 4, 1 + rnd() * 3)
    }
  }
  board(0, 206, RW, 14)
  board(0, 412, RW, 14)
  board(0, 0, RW, 16)
  board(0, RH - 16, RW, 16)
  board(0, 0, 16, RH)
  board(RW - 16, 0, 16, RH)
  ctx.fillStyle = 'rgba(255, 228, 190, 0.36)'
  for (const y of [0, 206, 412]) ctx.fillRect(0, y, RW, 2.5)
  ctx.fillRect(0, 0, 2.5, RH)
  for (const [x, y] of [[8, 8], [RW - 8, 8], [8, RH - 8], [RW - 8, RH - 8], [8, 213], [RW - 8, 213], [8, 419], [RW - 8, 419]] as const) screw(ctx, x, y, 4.5, x + y)
  return c
}

let dotCanvas: HTMLCanvasElement | null = null

function dots(): HTMLCanvasElement {
  return (dotCanvas ??= dotTile())
}

function keyGlyph(ctx: Ctx, name: DeckKeyName, cx: number, cy: number): void {
  const tri = (x: number, dir: 1 | -1) => {
    ctx.beginPath()
    ctx.moveTo(x - dir * 7, cy - 11)
    ctx.lineTo(x + dir * 8, cy)
    ctx.lineTo(x - dir * 7, cy + 11)
    ctx.closePath()
    ctx.fill()
  }
  if (name === 'play') tri(cx + 1, 1)
  else if (name === 'pause') {
    ctx.fillRect(cx - 9, cy - 10, 6, 20)
    ctx.fillRect(cx + 3, cy - 10, 6, 20)
  } else if (name === 'stop') ctx.fillRect(cx - 9, cy - 9, 18, 18)
  else if (name === 'rewind') {
    tri(cx - 7, -1)
    tri(cx + 8, -1)
  } else if (name === 'forward') {
    tri(cx - 8, 1)
    tri(cx + 7, 1)
  } else {
    ctx.beginPath()
    ctx.moveTo(cx, cy - 12)
    ctx.lineTo(cx + 12, cy + 2)
    ctx.lineTo(cx - 12, cy + 2)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(cx - 12, cy + 6, 24, 5)
  }
}
