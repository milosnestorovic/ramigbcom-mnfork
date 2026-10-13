import { quadToUnitSquare } from './homography'
import { easeInOutCubic } from './view'

/**
 * The tape deck is the player already painted on the right-hand shelves. Nothing
 * replaces it: this dresses its front face as an old cassette deck (a windowed door,
 * small transport keys, two VU meters, a fluorescent readout, a tape counter, knobs)
 * and stands a stack of cassette cases on its lid, all drawn into a transparent
 * canvas the room shader lays over that patch of the picture. In image pixels.
 */

export type DeckKeyName = 'rewind' | 'play' | 'stop' | 'forward' | 'eject'
export type DeckTarget = { kind: 'key'; key: DeckKeyName } | { kind: 'tape'; index: number }

export interface DeckView {
  /** One cassette per name, top of the stack first. */
  tapes: readonly string[]
  loaded: number | null
  title: string
  /** e.g. "2/5", shown next to the tape's name. */
  trackLabel: string
  playing: boolean
  at: number
  of: number
}

type P = readonly [number, number]

/** The patch of the picture this canvas covers: [x0, y0, x1, y1]. */
export const DECK_RECT = [1272, 468, 1408, 604] as const
/** Canvas pixels per image pixel. */
const RES = 8

/**
 * The player's front face as painted, clockwise from top-left. It is not a
 * rectangle on the picture: its edges run slightly downhill to the right and it
 * widens toward the bottom, so everything drawn on it is warped to these corners.
 */
const FACE: readonly [P, P, P, P] = [
  [1315.4, 536.4],
  [1377.9, 538.1],
  [1381.3, 573.9],
  [1312.1, 571],
]
const FACE_W = 592
const FACE_H = 310
/** The face is drawn flat at this many pixels per logical pixel, then warped in strips. */
const FACE_RES = 1.5
const STRIPS = 28
/** The stack stands on the lid: front-left corner of its base, a spine along the lid's front edge, a case's thickness. */
const STACK_O: P = [1326.8, 526.4]
const SPINE_U: P = [35.5, 2.2]
const CASE_T = 5.8
/** How the lid recedes, for the stack's side and top. */
const BACK: P = [-10.5, -7.6]
const SPINE_W = 444
const SPINE_H = 69
/** The parts of the face, in logical face pixels. */
const DOOR = { x: 20, y: 24, w: 300, h: 196 }
const KEYS: readonly DeckKeyName[] = ['rewind', 'play', 'stop', 'forward', 'eject']
const KEY = { x: 30, y: 240, w: 42, h: 44, gap: 17 }
const VU = { x: 340, y: 24, w: 110, h: 92, gap: 12 }
const READOUT = { x: 340, y: 130, w: 232, h: 50 }
const COUNTER = { x: 340, y: 206, w: 80, h: 42 }
const KNOBS: readonly P[] = [
  [474, 248],
  [538, 248],
]
/** A cassette is narrower than its case: how much the flying case shrinks into the door. */
const DOOR_FIT = 0.74

const FLIGHT_S = 0.9
const INK = '#79e8cf'
const LEGEND = 'rgba(205, 198, 180, 0.5)'
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

/** A point on the painted face: s across, t down, both 0..1. */
function onFace(s: number, t: number): P {
  return mix(mix(FACE[0], FACE[1], s), mix(FACE[3], FACE[2], s), t)
}

const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k]
const mix = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)

/** Where (px, py) falls inside the parallelogram o + s*u + t*v, as [s, t]. */
function inside(o: P, u: P, v: P, px: number, py: number): P {
  const det = u[0] * v[1] - u[1] * v[0]
  const dx = px - o[0]
  const dy = py - o[1]
  return [(dx * v[1] - dy * v[0]) / det, (u[0] * dy - u[1] * dx) / det]
}

export class DeckArt {
  readonly canvas: HTMLCanvasElement
  /** Whichever surface is being drawn on: the patch, or the flat face before it is warped. */
  private ctx: CanvasRenderingContext2D
  private readonly faceCanvas: HTMLCanvasElement
  private readonly faceCtx: CanvasRenderingContext2D
  private readonly faceInverse = quadToUnitSquare(FACE)
  private view: DeckView = { tapes: [], loaded: null, title: '', trackLabel: '', playing: false, at: 0, of: NaN }
  /** Per cassette: 0 in the stack, 1 inside the player. */
  private travel: number[] = []
  private readonly press = new Map<DeckKeyName, number>()
  private readonly tapped = new Map<DeckKeyName, number>()
  private hover: DeckTarget | null = null
  private time = 0
  private age = 0
  private stale = true

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = (DECK_RECT[2] - DECK_RECT[0]) * RES
    this.canvas.height = (DECK_RECT[3] - DECK_RECT[1]) * RES
    this.ctx = this.canvas.getContext('2d')!
    this.faceCanvas = document.createElement('canvas')
    this.faceCanvas.width = FACE_W * FACE_RES
    this.faceCanvas.height = FACE_H * FACE_RES
    this.faceCtx = this.faceCanvas.getContext('2d')!
  }

  setView(view: DeckView): void {
    if (view.tapes.length !== this.travel.length) this.travel = view.tapes.map((_n, i) => (i === view.loaded ? 1 : 0))
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

  /** Force a repaint, e.g. once the fonts have arrived. */
  redraw(): void {
    this.stale = true
  }

  /** What is under an image pixel: a key on the face, or a spine in the stack. */
  targetAt(px: number, py: number): DeckTarget | null {
    const m = this.faceInverse
    const w = m[6]! * px + m[7]! * py + m[8]!
    const fx = ((m[0]! * px + m[1]! * py + m[2]!) / w) * FACE_W
    const fy = ((m[3]! * px + m[4]! * py + m[5]!) / w) * FACE_H
    if (fy >= KEY.y && fy <= KEY.y + KEY.h) {
      const i = Math.floor((fx - KEY.x) / (KEY.w + KEY.gap))
      if (i >= 0 && i < KEYS.length && fx - KEY.x - i * (KEY.w + KEY.gap) <= KEY.w) return { kind: 'key', key: KEYS[i]! }
    }
    for (let i = 0; i < this.travel.length; i++) {
      if (this.travel[i]! > 0) continue
      const [a, b] = inside(this.spineOrigin(i), SPINE_U, [0, CASE_T], px, py)
      if (a >= 0 && a <= 1 && b >= 0 && b <= 1) return { kind: 'tape', index: i }
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
    for (const k of KEYS) {
      const left = Math.max(0, (this.tapped.get(k) ?? 0) - dt)
      this.tapped.set(k, left)
      const down = left > 0 || (k === 'play' && this.view.playing)
      this.press.set(k, toward(this.press.get(k) ?? 0, down ? 1 : 0, 14))
    }
    // The display scrolls and dances while a tape runs, but only up close is that worth a repaint.
    this.age += dt
    if (!moving && !(lively && this.view.playing && this.age > 0.06)) return false
    this.age = 0
    this.paint()
    return true
  }

  /** How much of cassette i is still in the stack (1 = there, 0 = gone). */
  private presence(i: number): number {
    return 1 - easeInOutCubic(clamp01(this.travel[i]! / 0.3))
  }

  /** Top-left corner of spine i, wherever the stack has settled it. */
  private spineOrigin(i: number): P {
    let below = 0
    for (let j = i + 1; j < this.travel.length; j++) below += this.presence(j)
    return [STACK_O[0], STACK_O[1] - (below + 1) * CASE_T]
  }

  private paint(): void {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.drawStack()
    this.drawFace()
    this.travel.forEach((t, i) => {
      if (t > 0 && t < 1) this.drawFlight(i, t)
    })
  }

  /** Draw in a w x h box laid onto the parallelogram o, u, v. */
  private onPlane(o: P, u: P, v: P, w: number, h: number, draw: () => void): void {
    const ctx = this.ctx
    ctx.save()
    ctx.setTransform(RES, 0, 0, RES, -DECK_RECT[0] * RES, -DECK_RECT[1] * RES)
    ctx.transform(u[0] / w, u[1] / w, v[0] / h, v[1] / h, o[0], o[1])
    draw()
    ctx.restore()
  }

  private drawStack(): void {
    const ctx = this.ctx
    const n = this.travel.length
    let height = 0
    for (let i = 0; i < n; i++) height += this.presence(i)
    if (height < 0.02) return
    const tall = height * CASE_T
    const top: P = [STACK_O[0], STACK_O[1] - tall]

    // A soft shadow where the stack meets the lid.
    this.onPlane(add(STACK_O, [2.5, 1.5]), SPINE_U, BACK, 100, 100, () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
      ctx.fillRect(-4, -6, 108, 112)
    })
    // The side that faces the window, in shadow.
    this.onPlane(top, BACK, [0, tall], 100, 100, () => {
      ctx.fillStyle = '#14110f'
      ctx.fillRect(0, 0, 100, 100)
      ctx.fillStyle = 'rgba(120, 170, 180, 0.1)'
      ctx.fillRect(0, 0, 100, 100)
    })
    // The top case, seen from above: clear lid, the inlay card under it.
    this.onPlane(top, SPINE_U, BACK, SPINE_W, 280, () => {
      ctx.fillStyle = '#15120f'
      ctx.fillRect(0, 0, SPINE_W, 280)
      ctx.fillStyle = 'rgba(120, 110, 92, 0.42)'
      ctx.fillRect(22, 26, SPINE_W - 44, 228)
      ctx.fillStyle = 'rgba(20, 16, 12, 0.6)'
      ctx.fillRect(120, 110, 204, 70)
      ctx.fillStyle = 'rgba(255, 150, 70, 0.1)'
      ctx.fillRect(SPINE_W * 0.6, 0, SPINE_W * 0.4, 280)
    })

    for (let i = 0; i < n; i++) {
      const here = this.presence(i)
      if (here < 0.02) continue
      const hovered = this.hover?.kind === 'tape' && this.hover.index === i
      // A hovered case eases out toward you by a hair.
      const o = add(this.spineOrigin(i), BACK, hovered ? -0.09 : 0)
      this.drawSpine(o, this.view.tapes[i] ?? '', here, hovered)
    }
  }

  /** One case, edge-on: the inlay card's spine behind clear plastic. */
  private drawSpine(o: P, name: string, alpha: number, lit: boolean, size = 1): void {
    const ctx = this.ctx
    const hue = hueFor(name)
    this.onPlane(o, [SPINE_U[0] * size, SPINE_U[1] * size], [0, CASE_T * size], SPINE_W, SPINE_H, () => {
      ctx.globalAlpha = alpha
      ctx.fillStyle = '#1b1815'
      ctx.fillRect(0, 0, SPINE_W, SPINE_H)
      // Dimmed for the room: this is cream paper in a dark corner.
      ctx.fillStyle = lit ? '#958a72' : '#6f6654'
      ctx.fillRect(9, 5, SPINE_W - 18, SPINE_H - 12)
      ctx.fillStyle = `hsl(${hue} 42% ${lit ? 32 : 24}%)`
      ctx.fillRect(9, 5, 50, SPINE_H - 12)
      ctx.fillStyle = '#120d08'
      ctx.font = `600 38px ${MONO}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(name.toUpperCase(), 74, SPINE_H / 2 + 1, SPINE_W - 150)
      ctx.font = `500 22px ${MONO}`
      ctx.textAlign = 'right'
      ctx.globalAlpha = alpha * 0.55
      ctx.fillText('C60', SPINE_W - 22, SPINE_H / 2 + 1)
      ctx.globalAlpha = alpha
      // Plastic catching the neon on the right, and the seam between cases.
      const glow = ctx.createLinearGradient(SPINE_W * 0.55, 0, SPINE_W, 0)
      glow.addColorStop(0, 'rgba(255, 150, 60, 0)')
      glow.addColorStop(1, 'rgba(255, 140, 50, 0.22)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, SPINE_W, SPINE_H)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.fillRect(0, 0, SPINE_W, 3)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.fillRect(0, SPINE_H - 5, SPINE_W, 5)
    })
  }

  /** A case on its way between the stack and the door (or back). */
  private drawFlight(i: number, travel: number): void {
    const e = easeInOutCubic(travel)
    const start = this.spineOrigin(i)
    const door = onFace((DOOR.x + 18) / FACE_W, (DOOR.y + DOOR.h * 0.42) / FACE_H)
    const out: P = [-BACK[0] * 0.7, -BACK[1] * 0.7]
    const pulled = add(start, out)
    const before = add(door, out, 0.5)
    // Out toward you, down in front of the player, then into the door.
    let at: P
    if (e < 0.3) at = mix(start, pulled, easeInOutCubic(e / 0.3))
    else if (e < 0.75) at = mix(pulled, before, easeInOutCubic((e - 0.3) / 0.45))
    else at = mix(before, door, easeInOutCubic((e - 0.75) / 0.25))
    const going = clamp01((e - 0.75) / 0.25)
    this.drawSpine(at, this.view.tapes[i] ?? '', 1 - going, false, 1 - (1 - DOOR_FIT) * clamp01((e - 0.3) / 0.45))
  }

  private drawFace(): void {
    const patch = this.ctx
    const ctx = this.faceCtx
    this.ctx = ctx
    ctx.setTransform(FACE_RES, 0, 0, FACE_RES, 0, 0)
    ctx.clearRect(0, 0, FACE_W, FACE_H)
    const { loaded, playing } = this.view
    /** How far the loaded cassette has settled behind the door's window. */
    const seated = loaded === null ? 0 : clamp01((this.travel[loaded]! - 0.85) / 0.15)
    {
      // An anthracite faceplate with a bright trim line, as on a deck from around 1980.
      ctx.fillStyle = 'rgba(21, 20, 19, 0.92)'
      ctx.fillRect(0, 0, FACE_W, FACE_H)
      ctx.drawImage(brushed(), 0, 0, FACE_W, FACE_H)
      ctx.fillStyle = 'rgba(214, 208, 190, 0.3)'
      ctx.fillRect(0, 0, FACE_W, 2)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      ctx.fillRect(0, FACE_H - 5, FACE_W, 5)

      this.drawDoor(seated)
      this.drawKeys()
      this.drawMeters()
      this.drawReadout(seated >= 1)
      this.drawCounter()

      // Two level knobs, knurled, each with its pointer.
      KNOBS.forEach(([x, y], i) => {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
        ctx.beginPath()
        ctx.arc(x + 2, y + 3, 26, 0, Math.PI * 2)
        ctx.fill()
        const g = ctx.createRadialGradient(x - 7, y - 8, 2, x, y, 25)
        g.addColorStop(0, '#8c887c')
        g.addColorStop(0.6, '#4d4a44')
        g.addColorStop(1, '#262422')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, 24, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
        ctx.lineWidth = 2
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * Math.PI * 2
          ctx.beginPath()
          ctx.moveTo(x + Math.cos(a) * 19, y + Math.sin(a) * 19)
          ctx.lineTo(x + Math.cos(a) * 24, y + Math.sin(a) * 24)
          ctx.stroke()
        }
        const a = i === 0 ? -2.2 : -1.2
        ctx.strokeStyle = '#e4dcc6'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6)
        ctx.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18)
        ctx.stroke()
      })

      // Engraved legends and the running light.
      ctx.fillStyle = LEGEND
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'center'
      ctx.font = `500 11px ${MONO}`
      ctx.fillText('LEFT', KNOBS[0]![0], 292)
      ctx.fillText('RIGHT', KNOBS[1]![0], 292)
      ctx.fillText('COUNTER', COUNTER.x + COUNTER.w / 2, 264)
      ctx.textAlign = 'left'
      ctx.fillText('STEREO CASSETTE DECK', READOUT.x, 198)
      ctx.fillStyle = playing ? '#ff5a3c' : '#3a1410'
      ctx.shadowColor = playing ? 'rgba(255, 90, 60, 0.9)' : 'transparent'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(562, 193, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
    }
    this.ctx = patch
    this.warpFace()
  }

  /** Lay the flat face onto the painted one, a thin strip at a time so its edges follow the picture's. */
  private warpFace(): void {
    const ctx = this.ctx
    const sw = this.faceCanvas.width
    const sh = this.faceCanvas.height / STRIPS
    ctx.save()
    for (let i = 0; i < STRIPS; i++) {
      const l0 = onFace(0, i / STRIPS)
      const r0 = onFace(1, i / STRIPS)
      const l1 = onFace(0, (i + 1) / STRIPS)
      ctx.setTransform(RES, 0, 0, RES, -DECK_RECT[0] * RES, -DECK_RECT[1] * RES)
      ctx.transform((r0[0] - l0[0]) / sw, (r0[1] - l0[1]) / sw, (l1[0] - l0[0]) / sh, (l1[1] - l0[1]) / sh, l0[0], l0[1])
      // A hair of overlap hides the seams between strips.
      ctx.drawImage(this.faceCanvas, 0, i * sh, sw, sh + 1, 0, 0, sw, sh + 1)
    }
    ctx.restore()
  }

  /** The cassette door: chrome frame, smoked window, and the cassette turning behind it. */
  private drawDoor(seated: number): void {
    const ctx = this.ctx
    const { loaded, playing, tapes } = this.view
    const { x, y, w, h } = DOOR
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(x - 3, y - 2, w + 8, h + 8)
    ctx.fillStyle = '#0b0b0b'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = 'rgba(196, 190, 172, 0.5)'
    ctx.lineWidth = 3
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3)
    const wx = x + 16
    const wy = y + 16
    const ww = w - 32
    const wh = h - 44
    ctx.fillStyle = '#040404'
    ctx.fillRect(wx, wy, ww, wh)

    ctx.save()
    ctx.beginPath()
    ctx.rect(wx, wy, ww, wh)
    ctx.clip()
    const spin = playing && seated >= 1 ? this.time * 3 : 0
    if (seated > 0 && loaded !== null) {
      // The cassette itself: shell, paper label with the tape's name, window onto the reels.
      const name = tapes[loaded] ?? ''
      const hue = hueFor(name)
      ctx.globalAlpha = seated
      ctx.fillStyle = `hsl(${hue} 18% 11%)`
      ctx.fillRect(wx + 4, wy + 4, ww - 8, wh - 8)
      ctx.fillStyle = '#7a705c'
      ctx.fillRect(wx + 14, wy + 12, ww - 28, wh * 0.62)
      ctx.fillStyle = `hsl(${hue} 42% 27%)`
      ctx.fillRect(wx + 14, wy + 12, ww - 28, 14)
      ctx.fillStyle = '#15100a'
      ctx.font = `600 19px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(name.toUpperCase(), wx + ww / 2, wy + 47, ww - 44)
      ctx.fillStyle = '#0c0a09'
      ctx.fillRect(wx + ww * 0.24, wy + wh * 0.4, ww * 0.52, wh * 0.3)
    }
    // The spindles are always there; with a cassette in, they carry its reels.
    const progress = this.view.of > 0 ? clamp01(this.view.at / this.view.of) : 0
    ;[0.36, 0.64].forEach((fx, side) => {
      const cx = wx + ww * fx
      const cy = wy + wh * 0.55
      if (seated > 0) {
        ctx.fillStyle = '#2f221b'
        ctx.beginPath()
        ctx.arc(cx, cy, 13 + 11 * (side === 0 ? 1 - progress : progress), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = seated > 0 ? '#b4ad9c' : '#3a3833'
      ctx.beginPath()
      ctx.arc(cx, cy, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#0c0a09'
      ctx.lineWidth = 2.5
      for (let k = 0; k < 3; k++) {
        const a = spin * (side === 0 ? 1 : 1.3) + (k * Math.PI) / 3
        ctx.beginPath()
        ctx.moveTo(cx - Math.cos(a) * 8, cy - Math.sin(a) * 8)
        ctx.lineTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8)
        ctx.stroke()
      }
      ctx.globalAlpha = seated
    })
    ctx.globalAlpha = 1
    // The window's glass: smoked, with one streak of reflection.
    ctx.fillStyle = 'rgba(8, 12, 12, 0.3)'
    ctx.fillRect(wx, wy, ww, wh)
    ctx.fillStyle = 'rgba(255, 230, 200, 0.06)'
    ctx.beginPath()
    ctx.moveTo(wx + ww * 0.08, wy)
    ctx.lineTo(wx + ww * 0.3, wy)
    ctx.lineTo(wx + ww * 0.14, wy + wh)
    ctx.lineTo(wx - ww * 0.08, wy + wh)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    ctx.fillStyle = LEGEND
    ctx.font = `500 11px ${MONO}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('NORMAL  ·  CrO2  ·  METAL', x + w / 2, y + h - 10)
  }

  /** Small square transport keys in a recessed row, like the mechanical ones. */
  private drawKeys(): void {
    const ctx = this.ctx
    const row = KEYS.length * KEY.w + (KEYS.length - 1) * KEY.gap
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(KEY.x - 8, KEY.y - 5, row + 16, KEY.h + 14)
    KEYS.forEach((k, i) => {
      const down = this.press.get(k) ?? 0
      const lit = this.hover?.kind === 'key' && this.hover.key === k
      const x = KEY.x + i * (KEY.w + KEY.gap)
      const y = KEY.y + down * 5
      // Brushed caps gone dull, lighter along the top edge where fingers land.
      const shade = (lit ? 1.3 : 1) * (1 - down * 0.25)
      const g = ctx.createLinearGradient(0, y, 0, y + KEY.h)
      const tone = (v: number) => Math.min(255, Math.round(v * shade))
      g.addColorStop(0, `rgb(${tone(134)}, ${tone(130)}, ${tone(118)})`)
      g.addColorStop(0.2, `rgb(${tone(92)}, ${tone(89)}, ${tone(81)})`)
      g.addColorStop(1, `rgb(${tone(56)}, ${tone(54)}, ${tone(50)})`)
      ctx.fillStyle = g
      ctx.fillRect(x, y, KEY.w, KEY.h)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.fillRect(x, y + KEY.h, KEY.w, 5 - down * 5)
      ctx.fillStyle = k === 'play' && this.view.playing ? '#d8b56a' : '#0d0d0e'
      keyGlyph(ctx, k, x + KEY.w / 2, y + KEY.h / 2 + 1)
    })
  }

  /** Two VU meters: lamp-lit cream faces, a red zone, needles that ride the music. */
  private drawMeters(): void {
    const ctx = this.ctx
    const live = this.view.playing && this.view.loaded !== null && this.travel[this.view.loaded]! >= 1
    for (let ch = 0; ch < 2; ch++) {
      const x = VU.x + ch * (VU.w + VU.gap)
      const { y, w, h } = VU
      ctx.fillStyle = '#080808'
      ctx.fillRect(x - 4, y - 4, w + 8, h + 8)
      const lamp = ctx.createRadialGradient(x + w / 2, y + h, 6, x + w / 2, y + h, w * 0.85)
      lamp.addColorStop(0, live ? '#d7b672' : '#8e7a50')
      lamp.addColorStop(1, live ? '#84693a' : '#4c4130')
      ctx.fillStyle = lamp
      ctx.fillRect(x, y, w, h)

      const px = x + w / 2
      const py = y + h + 22
      const reach = h + 4
      const angleOf = (level: number) => -Math.PI / 2 + (-0.72 + 1.44 * level)
      ctx.lineWidth = 2
      ctx.strokeStyle = '#1b1610'
      ctx.beginPath()
      ctx.arc(px, py, reach - 24, angleOf(0), angleOf(0.72))
      ctx.stroke()
      ctx.strokeStyle = '#8a1f14'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(px, py, reach - 24, angleOf(0.72), angleOf(1))
      ctx.stroke()
      ctx.strokeStyle = '#1b1610'
      ctx.lineWidth = 1.5
      for (let k = 0; k <= 8; k++) {
        const a = angleOf(k / 8)
        ctx.beginPath()
        ctx.moveTo(px + Math.cos(a) * (reach - 24), py + Math.sin(a) * (reach - 24))
        ctx.lineTo(px + Math.cos(a) * (reach - 16), py + Math.sin(a) * (reach - 16))
        ctx.stroke()
      }
      ctx.fillStyle = '#1b1610'
      ctx.font = `600 13px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText('VU', px, y + h - 12)

      const t = this.time
      const level = live ? clamp01(0.5 + 0.22 * Math.sin(t * 5.3 + ch * 1.9) + 0.16 * Math.sin(t * 11.7 + ch) + 0.08 * Math.sin(t * 23 + ch * 4)) : 0.03
      const a = angleOf(level)
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
      ctx.strokeStyle = '#120d08'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px + Math.cos(a) * (reach - 10), py + Math.sin(a) * (reach - 10))
      ctx.stroke()
      ctx.restore()
    }
  }

  /** A fluorescent strip: what is playing, and for how long. Small, as they were. */
  private drawReadout(has: boolean): void {
    const ctx = this.ctx
    const { playing, title, trackLabel, at } = this.view
    const { x, y, w, h } = READOUT
    ctx.fillStyle = '#080808'
    ctx.fillRect(x - 4, y - 4, w + 8, h + 8)
    ctx.fillStyle = '#04100e'
    ctx.fillRect(x, y, w, h)
    ctx.save()
    ctx.beginPath()
    ctx.rect(x + 6, y, w - 12, h)
    ctx.clip()
    ctx.fillStyle = INK
    ctx.shadowColor = 'rgba(121, 232, 207, 0.5)'
    ctx.shadowBlur = 6
    ctx.textBaseline = 'alphabetic'

    ctx.font = `500 13px ${MONO}`
    ctx.textAlign = 'left'
    ctx.globalAlpha = 0.75
    ctx.fillText(!has ? 'NO TAPE' : `${playing ? 'PLAY' : 'STOP'}  ${trackLabel}`, x + 10, y + 16)
    ctx.textAlign = 'right'
    ctx.fillText(has ? clock(at) : '--:--', x + w - 10, y + 16)
    ctx.globalAlpha = 1

    // The title scrolls when it is too long for the glass.
    ctx.font = `600 22px ${MONO}`
    ctx.textAlign = 'left'
    const text = has ? title : 'INSERT CASSETTE'
    const width = ctx.measureText(text).width
    const room = w - 20
    if (width <= room) ctx.fillText(text, x + 10, y + 41)
    else {
      const span = width + 60
      const dx = (playing ? this.time * 30 : 0) % span
      ctx.fillText(text, x + 10 - dx, y + 41)
      ctx.fillText(text, x + 10 - dx + span, y + 41)
    }
    ctx.restore()
  }

  /** A three-drum tape counter: seconds run, since that is what this tape has. */
  private drawCounter(): void {
    const ctx = this.ctx
    const { x, y, w, h } = COUNTER
    ctx.fillStyle = '#060606'
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6)
    const digits = String(Math.floor(this.view.loaded === null ? 0 : this.view.at) % 1000).padStart(3, '0')
    const cell = w / 3
    for (let i = 0; i < 3; i++) {
      const g = ctx.createLinearGradient(0, y, 0, y + h)
      g.addColorStop(0, '#050505')
      g.addColorStop(0.5, '#26241f')
      g.addColorStop(1, '#050505')
      ctx.fillStyle = g
      ctx.fillRect(x + i * cell + 1, y, cell - 2, h)
      ctx.fillStyle = '#cfc8b4'
      ctx.font = `600 26px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(digits[i]!, x + i * cell + cell / 2, y + h / 2 + 2)
    }
  }
}

let brushedCanvas: HTMLCanvasElement | null = null

/** Faint horizontal brushing and a few scuffs, the same every time. */
function brushed(): HTMLCanvasElement {
  if (brushedCanvas) return brushedCanvas
  const c = document.createElement('canvas')
  c.width = 584
  c.height = 300
  const ctx = c.getContext('2d')!
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let y = 0; y < 300; y += 2) {
    ctx.fillStyle = `rgba(255, 245, 225, ${rnd() * 0.035})`
    ctx.fillRect(0, y, 584, 1)
  }
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = rnd() > 0.5 ? `rgba(0, 0, 0, ${0.1 + rnd() * 0.2})` : `rgba(255, 190, 120, ${0.03 + rnd() * 0.07})`
    ctx.fillRect(rnd() * 584, rnd() * 300, 3 + rnd() * 30, 1 + rnd() * 2)
  }
  brushedCanvas = c
  return c
}

function keyGlyph(ctx: CanvasRenderingContext2D, name: DeckKeyName, cx: number, cy: number): void {
  const tri = (x: number, dir: 1 | -1) => {
    ctx.beginPath()
    ctx.moveTo(x - dir * 5, cy - 8)
    ctx.lineTo(x + dir * 6, cy)
    ctx.lineTo(x - dir * 5, cy + 8)
    ctx.closePath()
    ctx.fill()
  }
  if (name === 'play') tri(cx + 1, 1)
  else if (name === 'stop') ctx.fillRect(cx - 7, cy - 7, 14, 14)
  else if (name === 'rewind') {
    tri(cx - 5, -1)
    tri(cx + 6, -1)
  } else if (name === 'forward') {
    tri(cx - 6, 1)
    tri(cx + 5, 1)
  } else {
    ctx.beginPath()
    ctx.moveTo(cx, cy - 9)
    ctx.lineTo(cx + 9, cy + 2)
    ctx.lineTo(cx - 9, cy + 2)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(cx - 9, cy + 5, 18, 4)
  }
}
