import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  type IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Matrix3,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three'
import { DepthField } from './depthField'
import { quadToUnitSquare, type Point } from './homography'
import { pickPixel } from './pick'
import type { Polygon } from './polygon'
import { roomFragment, roomVertex } from './shaders'
import { IMAGE_H, IMAGE_W, pixelToWorld, type Vec2 } from './space'
import { easeInOutCubic, frustum, lerpView, overviewView, projectToScreen, withParallax, type View } from './view'

type Quad = readonly [Point, Point, Point, Point]
const inverse = (q: Quad) => new Matrix3().set(...(quadToUnitSquare(q) as Parameters<Matrix3['set']>))

export interface Shot {
  view: View
  /** 0..1 depth-of-field strength. */
  dof: number
  focusDepth: number
  vignette: number
}

/** A shot is recomputed for every viewport size, so targets are functions of aspect. */
export type ShotFn = (aspect: number) => Shot

export interface FrameInfo {
  view: View
  width: number
  height: number
  /** True while the camera is moving between shots. */
  moving: boolean
}

interface Uniforms {
  [key: string]: IUniform
}

const NEAR = 0.05
/** Plate extends past the image so camera moves never reveal an edge. */
const MARGIN = 0.08
const SEG_X = 420
const SEG_Y = 315
const MASK_W = 362
const MASK_H = 272
/** The hover outline is a thin line, so its mask is finer than the soft ones. */
const OUTLINE_W = 724
const OUTLINE_H = 543
const MAX_DPR = 1.5

export class RoomRenderer {
  readonly depth: DepthField
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera()
  private readonly uniforms: Uniforms
  private readonly material: ShaderMaterial
  private readonly mesh: Mesh
  private readonly hoverCanvas: HTMLCanvasElement
  private readonly hoverTexture: CanvasTexture
  private readonly outlineCanvas: HTMLCanvasElement
  private readonly outlineTexture: CanvasTexture
  private readonly infoTexture: CanvasTexture
  private readonly deckTexture: CanvasTexture
  private readonly textures: Texture[] = []
  private readonly listeners = new Set<(f: FrameInfo) => void>()

  private width = 1
  private height = 1
  private target: ShotFn
  private from: Shot
  private current: Shot
  private tweenStart = 0
  private tweenDuration = 0
  private moving = false

  private pointer: [number, number] = [0, 0]
  private pointerSmoothed: [number, number] = [0, 0]
  private parallaxScale = 1
  private hoverGoal = 0
  private lampGoal = 1
  private rainGoal = 0
  private exposureGoal = 1
  private reducedMotion = false
  private dirty = true
  private time = 0
  private lastFrame = 0
  private raf = 0
  private disposed = false

  constructor(
    private readonly container: HTMLElement,
    room: HTMLImageElement,
    depthImage: HTMLImageElement,
    blurs: readonly [HTMLImageElement, HTMLImageElement],
    fx: {
      screens: readonly Polygon[]
      lamp: Polygon
      /** The glass that runs the screensaver. */
      saver: Quad
      /** The glass that shows `board`, a canvas drawn by someone else. */
      info: Quad
      board: HTMLCanvasElement
      /** The painted tape deck: a sharper `patch` of the picture over `rect`, and `art` drawn on top of it. */
      deck: { rect: readonly [number, number, number, number]; patch: HTMLImageElement; art: HTMLCanvasElement }
    },
  ) {
    this.depth = DepthField.fromImage(depthImage)
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = LinearSRGBColorSpace
    this.renderer.setClearColor(0x05080a, 1)
    this.renderer.domElement.setAttribute('aria-hidden', 'true')
    container.appendChild(this.renderer.domElement)

    const map = this.texture(new Texture(room))
    map.generateMipmaps = true
    map.minFilter = LinearMipmapLinearFilter
    map.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    const depthTex = this.texture(new Texture(depthImage))
    const blur1 = this.texture(new Texture(blurs[0]))
    const blur2 = this.texture(new Texture(blurs[1]))
    const fxTex = this.texture(new CanvasTexture(drawFxMask(fx.screens, fx.lamp)))
    this.hoverCanvas = makeCanvas(MASK_W, MASK_H)
    this.hoverTexture = this.texture(new CanvasTexture(this.hoverCanvas)) as CanvasTexture
    this.outlineCanvas = makeCanvas(OUTLINE_W, OUTLINE_H)
    this.outlineTexture = this.texture(new CanvasTexture(this.outlineCanvas)) as CanvasTexture
    // Seen tiny from across the room and large up close, so it needs mipmaps.
    this.infoTexture = this.texture(new CanvasTexture(fx.board)) as CanvasTexture
    this.infoTexture.generateMipmaps = true
    this.infoTexture.minFilter = LinearMipmapLinearFilter
    this.infoTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    const patch = this.texture(new Texture(fx.deck.patch))
    this.deckTexture = this.texture(new CanvasTexture(fx.deck.art)) as CanvasTexture
    this.deckTexture.premultiplyAlpha = true
    for (const t of [patch, this.deckTexture]) {
      t.generateMipmaps = true
      t.minFilter = LinearMipmapLinearFilter
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    }
    const [dx0, dy0, dx1, dy1] = fx.deck.rect

    this.uniforms = {
      uMap: { value: map },
      uDepth: { value: depthTex },
      uFx: { value: fxTex },
      uHover: { value: this.hoverTexture },
      uOutline: { value: this.outlineTexture },
      uSaver: { value: inverse(fx.saver) },
      uInfo: { value: inverse(fx.info) },
      uInfoMap: { value: this.infoTexture },
      uPatch: { value: patch },
      uDeck: { value: this.deckTexture },
      uDeckRect: { value: new Vector4(dx0 / IMAGE_W, dy0 / IMAGE_H, dx1 / IMAGE_W, dy1 / IMAGE_H) },
      uImageSize: { value: new Vector2(IMAGE_W, IMAGE_H) },
      uBlur1: { value: blur1 },
      uBlur2: { value: blur2 },
      uStretch: { value: 0 },
      uResolution: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uMotion: { value: 1 },
      uExposure: { value: 0 },
      uDof: { value: 0 },
      uFocusDepth: { value: 3.4 },
      uHoverAmt: { value: 0 },
      uHoverTint: { value: new Vector3(1, 1, 1) },
      uLamp: { value: 1 },
      uRain: { value: 0 },
      uVignette: { value: 0.35 },
    }
    this.material = new ShaderMaterial({
      vertexShader: roomVertex,
      fragmentShader: roomFragment,
      uniforms: this.uniforms,
      depthWrite: true,
    })
    this.mesh = new Mesh(this.buildPlate(), this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)

    this.target = (aspect) => overviewShot(aspect)
    this.resize()
    this.current = this.target(this.aspect)
    this.from = this.current

    this.raf = requestAnimationFrame(this.loop)
  }

  get aspect(): number {
    return this.width / this.height
  }

  get transitioning(): boolean {
    return this.moving
  }

  get view(): View {
    return this.current.view
  }

  /** Move to a new shot. Safe to call mid-transition: it continues from where the camera is. */
  setTarget(target: ShotFn, durationMs: number): void {
    this.target = target
    this.from = this.current
    this.tweenStart = performance.now()
    this.tweenDuration = durationMs
    this.moving = durationMs > 0
    if (!this.moving) this.current = target(this.aspect)
    this.dirty = true
  }

  setPointer(nx: number, ny: number): void {
    this.pointer = [nx, ny]
  }

  setParallaxScale(scale: number): void {
    this.parallaxScale = scale
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced
    this.uniforms.uMotion!.value = reduced ? 0 : 1
    this.dirty = true
  }

  setHover(shape: readonly Polygon[] | null, tint: readonly [number, number, number] = [1, 1, 1]): void {
    if (shape) {
      const masks = [
        [this.hoverCanvas, this.hoverTexture, 4],
        [this.outlineCanvas, this.outlineTexture, 1],
      ] as const
      for (const [canvas, texture, soften] of masks) {
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        for (const poly of shape) fillPolygon(ctx, poly, '#fff')
        softenCanvas(ctx, soften)
        texture.needsUpdate = true
      }
      ;(this.uniforms.uHoverTint!.value as Vector3).set(tint[0], tint[1], tint[2])
    }
    this.hoverGoal = shape ? 1 : 0
    this.dirty = true
  }

  /** Call after redrawing the deck's canvas. */
  refreshDeck(): void {
    this.deckTexture.needsUpdate = true
    this.dirty = true
  }

  /** Call after redrawing the board canvas. */
  refreshInfo(): void {
    this.infoTexture.needsUpdate = true
    this.dirty = true
  }

  setLamp(on: boolean): void {
    this.lampGoal = on ? 1 : 0
    this.dirty = true
  }

  setRain(amount: number): void {
    this.rainGoal = amount
    this.dirty = true
  }

  fadeIn(): void {
    this.exposureGoal = 1
    this.dirty = true
  }

  /** Image pixel under a client point, or null if outside the canvas. */
  pixelAt(clientX: number, clientY: number): Vec2 | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2
    if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null
    return pickPixel(this.renderedView(), this.aspect, nx, ny, (x, y) => this.depth.depth(x, y))
  }

  /** CSS-pixel position of an image pixel, as currently rendered. */
  project(px: number, py: number, depthOverride?: number): [number, number] {
    const d = depthOverride ?? this.depth.depth(px, py)
    return projectToScreen(this.renderedView(), pixelToWorld(px, py, d), this.width, this.height)
  }

  /** Same, for an arbitrary shot (e.g. the destination of a transition). */
  projectFor(shot: Shot, px: number, py: number, depthOverride?: number): [number, number] {
    const d = depthOverride ?? this.depth.depth(px, py)
    return projectToScreen(shot.view, pixelToWorld(px, py, d), this.width, this.height)
  }

  onFrame(cb: (f: FrameInfo) => void): () => void {
    this.listeners.add(cb)
    this.dirty = true
    return () => this.listeners.delete(cb)
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.width = w
    this.height = h
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR))
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    const buf = this.renderer.getDrawingBufferSize(new Vector2())
    ;(this.uniforms.uResolution!.value as Vector2).copy(buf)
    // Re-frame for the new aspect; mid-transition, retarget smoothly.
    if (this.current) {
      if (this.moving) this.from = this.current
      else this.current = this.target(this.aspect)
    }
    this.dirty = true
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.mesh.geometry.dispose()
    this.material.dispose()
    for (const t of this.textures) t.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.listeners.clear()
  }

  private texture<T extends Texture>(t: T): T {
    t.flipY = false
    t.wrapS = ClampToEdgeWrapping
    t.wrapT = ClampToEdgeWrapping
    t.minFilter = LinearFilter
    t.generateMipmaps = false
    t.needsUpdate = true
    this.textures.push(t)
    return t
  }

  private buildPlate(): BufferGeometry {
    const cols = SEG_X + 1
    const rows = SEG_Y + 1
    const positions = new Float32Array(cols * rows * 3)
    const uvs = new Float32Array(cols * rows * 2)
    const disparity = new Float32Array(cols * rows)
    for (let j = 0; j < rows; j++) {
      const v = -MARGIN + ((1 + 2 * MARGIN) * j) / SEG_Y
      for (let i = 0; i < cols; i++) {
        const u = -MARGIN + ((1 + 2 * MARGIN) * i) / SEG_X
        const px = u * IMAGE_W
        const py = v * IMAGE_H
        const p = pixelToWorld(px, py, this.depth.depth(px, py))
        const k = j * cols + i
        positions.set(p, k * 3)
        disparity[k] = this.depth.disparity(px, py)
        uvs[k * 2] = u
        uvs[k * 2 + 1] = v
      }
    }
    // How sharply depth changes around each vertex. Triangles spanning a jump get
    // stretched when the camera moves; the shader softens them.
    const edges = new Float32Array(cols * rows)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        const d = disparity[k] ?? 0
        let m = 0
        if (i > 0) m = Math.max(m, Math.abs(d - (disparity[k - 1] ?? d)))
        if (i < cols - 1) m = Math.max(m, Math.abs(d - (disparity[k + 1] ?? d)))
        if (j > 0) m = Math.max(m, Math.abs(d - (disparity[k - cols] ?? d)))
        if (j < rows - 1) m = Math.max(m, Math.abs(d - (disparity[k + cols] ?? d)))
        edges[k] = Math.min(m / 0.03, 1)
      }
    }
    const index: number[] = []
    for (let j = 0; j < SEG_Y; j++) {
      for (let i = 0; i < SEG_X; i++) {
        const a = j * cols + i
        const b = a + 1
        const c = a + cols
        const d = c + 1
        index.push(a, c, b, b, c, d)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setAttribute('uv', new BufferAttribute(uvs, 2))
    g.setAttribute('aEdge', new BufferAttribute(edges, 1))
    g.setIndex(index)
    return g
  }

  /** The base view plus pointer parallax and idle drift. */
  private renderedView(): View {
    const base = this.current.view
    const amp = 0.05 * this.parallaxScale
    const [px, py] = this.pointerSmoothed
    const drift = this.reducedMotion ? 0 : 0.006 * this.parallaxScale
    const t = this.time
    return withParallax(base, px * amp + Math.sin(t * 0.21) * drift, -py * amp * 0.5 + Math.sin(t * 0.13 + 1) * drift * 0.6)
  }

  private loop = (now: number): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min((now - (this.lastFrame || now)) / 1000, 0.1)
    this.lastFrame = now

    let changed = this.dirty
    this.dirty = false

    if (this.moving) {
      const t = Math.min((now - this.tweenStart) / this.tweenDuration, 1)
      const e = easeInOutCubic(t)
      const to = this.target(this.aspect)
      this.current = lerpShot(this.from, to, e)
      if (t >= 1) {
        this.moving = false
        this.current = to
      }
      changed = true
    }

    // Ease toward pointer, hover, lamp and rain goals.
    const k = 1 - Math.exp(-dt * 4)
    const ease = (u: string, goal: number, rate = k) => {
      const cur = this.uniforms[u]!.value as number
      if (Math.abs(goal - cur) < 0.002) {
        if (cur !== goal) {
          this.uniforms[u]!.value = goal
          changed = true
        }
        return
      }
      this.uniforms[u]!.value = cur + (goal - cur) * rate
      changed = true
    }
    if (this.reducedMotion) {
      this.pointerSmoothed = [0, 0]
    } else {
      const [sx, sy] = this.pointerSmoothed
      const [tx, ty] = this.pointer
      if (Math.abs(tx - sx) + Math.abs(ty - sy) > 0.0005) {
        this.pointerSmoothed = [sx + (tx - sx) * k * 0.6, sy + (ty - sy) * k * 0.6]
        changed = true
      }
    }
    ease('uHoverAmt', this.hoverGoal, 1 - Math.exp(-dt * 10))
    ease('uLamp', this.lampGoal, 1 - Math.exp(-dt * 12))
    ease('uRain', this.rainGoal, 1 - Math.exp(-dt * 0.8))
    ease('uExposure', this.exposureGoal, 1 - Math.exp(-dt * 2.2))
    this.uniforms.uDof!.value = this.current.dof
    this.uniforms.uFocusDepth!.value = this.current.focusDepth
    this.uniforms.uVignette!.value = this.current.vignette
    const [ex, ey, ez] = this.current.view.eye
    this.uniforms.uStretch!.value = Math.min(Math.hypot(ex, ey, ez) / 0.2, 1)

    if (!this.reducedMotion) {
      this.time += dt
      this.uniforms.uTime!.value = this.time
      changed = true
    }

    if (!changed) return
    const view = this.renderedView()
    const f = frustum(view, this.aspect, NEAR)
    this.camera.position.set(view.eye[0], view.eye[1], view.eye[2])
    this.camera.updateMatrixWorld()
    this.camera.projectionMatrix.makePerspective(f.left, f.right, f.top, f.bottom, NEAR, 100)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
    this.renderer.render(this.scene, this.camera)
    const info: FrameInfo = { view, width: this.width, height: this.height, moving: this.moving }
    for (const cb of this.listeners) cb(info)
  }
}

export function overviewShot(aspect: number, pan = 0): Shot {
  return { view: overviewView(aspect, pan), dof: 0, focusDepth: 3.4, vignette: 0.35 }
}

function lerpShot(a: Shot, b: Shot, t: number): Shot {
  return {
    view: lerpView(a.view, b.view, t),
    dof: a.dof + (b.dof - a.dof) * t,
    // Pull focus in diopters so it racks smoothly from near to far.
    focusDepth: 1 / (1 / a.focusDepth + (1 / b.focusDepth - 1 / a.focusDepth) * t),
    vignette: a.vignette + (b.vignette - a.vignette) * t,
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function fillPolygon(ctx: CanvasRenderingContext2D, poly: Polygon, color: string): void {
  const sx = ctx.canvas.width / IMAGE_W
  const sy = ctx.canvas.height / IMAGE_H
  ctx.beginPath()
  poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * sx, y * sy) : ctx.lineTo(x * sx, y * sy)))
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

/** G channel: screens that glow. B channel: the ceiling lamp. */
function drawFxMask(screens: readonly Polygon[], lamp: Polygon): HTMLCanvasElement {
  const c = makeCanvas(MASK_W, MASK_H)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, MASK_W, MASK_H)
  ctx.globalCompositeOperation = 'lighter'
  for (const s of screens) fillPolygon(ctx, s, '#00ff00')
  fillPolygon(ctx, lamp, '#0000ff')
  softenCanvas(ctx, 2)
  return c
}

/**
 * Soft edges for the masks: three box-blur passes approximate a gaussian. Done by
 * hand because canvas filter support is uneven (and absent in older Safari).
 */
function softenCanvas(ctx: CanvasRenderingContext2D, radius: number): void {
  const { width: w, height: h } = ctx.canvas
  const img = ctx.getImageData(0, 0, w, h)
  const src = img.data
  const tmp = new Float32Array(w * h)
  const buf = new Float32Array(w * h)
  for (let ch = 0; ch < 3; ch++) {
    for (let i = 0; i < w * h; i++) buf[i] = src[i * 4 + ch] ?? 0
    for (let pass = 0; pass < 3; pass++) {
      boxBlur1D(buf, tmp, w, h, radius, 1, w)
      boxBlur1D(tmp, buf, h, w, radius, w, 1)
    }
    for (let i = 0; i < w * h; i++) src[i * 4 + ch] = buf[i] ?? 0
  }
  for (let i = 0; i < w * h; i++) src[i * 4 + 3] = 255
  ctx.putImageData(img, 0, 0)
}

/** Running-sum box blur along one axis: `len` samples per line, `lines` lines. */
function boxBlur1D(
  input: Float32Array,
  output: Float32Array,
  len: number,
  lines: number,
  r: number,
  step: number,
  lineStep: number,
): void {
  const norm = 1 / (2 * r + 1)
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep
    const at = (i: number) => input[base + Math.min(Math.max(i, 0), len - 1) * step] ?? 0
    let sum = 0
    for (let i = -r; i <= r; i++) sum += at(i)
    for (let i = 0; i < len; i++) {
      output[base + i * step] = sum * norm
      sum += at(i + r + 1) - at(i - r)
    }
  }
}
