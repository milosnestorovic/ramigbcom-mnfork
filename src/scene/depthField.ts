import { disparityToDepth, IMAGE_H, IMAGE_W, type Vec2 } from './space'

/** CPU-side copy of the depth map, sampled in image pixel coordinates. */
export class DepthField {
  readonly width: number
  readonly height: number
  private readonly data: Float32Array

  constructor(width: number, height: number, data: Float32Array) {
    this.width = width
    this.height = height
    this.data = data
  }

  static fromImage(image: HTMLImageElement | ImageBitmap): DepthField {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D canvas unavailable')
    ctx.drawImage(image, 0, 0)
    const rgba = ctx.getImageData(0, 0, image.width, image.height).data
    const data = new Float32Array(image.width * image.height)
    for (let i = 0; i < data.length; i++) data[i] = (rgba[i * 4] ?? 0) / 255
    return new DepthField(image.width, image.height, data)
  }

  /** Bilinear disparity at an image pixel, clamped to the image. */
  disparity(px: number, py: number): number {
    const x = Math.min(Math.max((px / IMAGE_W) * this.width - 0.5, 0), this.width - 1)
    const y = Math.min(Math.max((py / IMAGE_H) * this.height - 0.5, 0), this.height - 1)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(x0 + 1, this.width - 1)
    const y1 = Math.min(y0 + 1, this.height - 1)
    const fx = x - x0
    const fy = y - y0
    const at = (xx: number, yy: number) => this.data[yy * this.width + xx] ?? 0
    const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx
    const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx
    return top * (1 - fy) + bottom * fy
  }

  /**
   * Stand a flat card in the scene: everything inside the image-pixel box [x0, y0, x1, y1]
   * takes the depth found at `at`, easing back to the real depth over `feather` pixels
   * outside it. For things drawn onto the picture that are not in its depth map.
   */
  level(box: readonly [number, number, number, number], at: Vec2, feather: number): void {
    const value = this.disparity(at[0], at[1])
    const sx = this.width / IMAGE_W
    const sy = this.height / IMAGE_H
    const j0 = Math.max(0, Math.floor((box[1] - feather) * sy))
    const j1 = Math.min(this.height - 1, Math.ceil((box[3] + feather) * sy))
    const i0 = Math.max(0, Math.floor((box[0] - feather) * sx))
    const i1 = Math.min(this.width - 1, Math.ceil((box[2] + feather) * sx))
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) / sx
        const py = (j + 0.5) / sy
        const out = Math.max(box[0] - px, px - box[2], box[1] - py, py - box[3], 0)
        const t = Math.min(out / feather, 1)
        const k = j * this.width + i
        this.data[k] = value + ((this.data[k] ?? value) - value) * (t * t * (3 - 2 * t))
      }
    }
  }

  depth(px: number, py: number): number {
    return disparityToDepth(this.disparity(px, py))
  }
}
