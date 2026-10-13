import { clockText, dateText, describeWeather, type IconKind, type NowState } from './now'

/** The small CRT's picture, drawn to a canvas the room shader maps onto its glass. */
export const BOARD_W = 660
export const BOARD_H = 750

const INK = '#a8f1f3'
const DIM = 'rgba(168, 241, 243, 0.55)'
const MONO = "'Geist Mono Variable', ui-monospace, monospace"
const PAD = 46

export function drawBoard(canvas: HTMLCanvasElement, s: NowState, now: Date): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const bg = ctx.createRadialGradient(BOARD_W / 2, BOARD_H * 0.42, 0, BOARD_W / 2, BOARD_H * 0.42, BOARD_H * 0.75)
  bg.addColorStop(0, '#0d2c31')
  bg.addColorStop(0.6, '#07181b')
  bg.addColorStop(1, '#030b0d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, BOARD_W, BOARD_H)
  ctx.textBaseline = 'alphabetic'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const text = (t: string, x: number, y: number, size: number, color = INK, align: CanvasTextAlign = 'left', weight = 500) => {
    ctx.font = `${weight} ${size}px ${MONO}`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(t, x, y, BOARD_W - 2 * PAD)
  }
  const rule = (y: number) => {
    ctx.strokeStyle = 'rgba(168, 241, 243, 0.22)'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 8])
    ctx.beginPath()
    ctx.moveTo(PAD, y)
    ctx.lineTo(BOARD_W - PAD, y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  text(dateText(now).toUpperCase(), PAD, 92, 38, DIM)
  // The clock is sized to stay readable from across the room.
  text(clockText(now), BOARD_W / 2, 262, 184, INK, 'center', 600)
  text(s.place?.name ?? (s.offline ? 'Somewhere' : 'Locating...'), PAD, 334, 40, DIM)
  rule(366)

  const f = s.forecast
  if (!f) {
    text(s.offline ? 'weather offline' : 'reading the sky...', PAD, 470, 36, DIM)
    return
  }
  const current = describeWeather(f.code, f.isDay)
  drawIcon(ctx, current.icon, PAD + 70, 452, 70)
  text(`${Math.round(f.temp)}°`, BOARD_W - PAD, 492, 128, INK, 'right', 600)
  text(current.label, PAD, 566, 36)
  rule(592)

  const col = (BOARD_W - 2 * PAD) / 3
  f.days.forEach((day, i) => {
    const cx = PAD + col * (i + 0.5)
    const name = new Date(`${day.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })
    text(name.toUpperCase(), cx, 634, 28, DIM, 'center')
    drawIcon(ctx, describeWeather(day.code).icon, cx, 668, 26)
    text(`${Math.round(day.hi)}° ${Math.round(day.lo)}°`, cx, 724, 26, INK, 'center')
  })
}

/** Line icons, centered on (cx, cy) and roughly r in every direction. */
function drawIcon(ctx: CanvasRenderingContext2D, kind: IconKind, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = Math.max(2.5, r * 0.11)

  const sun = (x: number, y: number, q: number) => {
    ctx.beginPath()
    ctx.arc(x, y, q * 0.42, 0, Math.PI * 2)
    ctx.stroke()
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(a) * q * 0.66, y + Math.sin(a) * q * 0.66)
      ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q)
      ctx.stroke()
    }
  }
  const cloud = (x: number, y: number, q: number) => {
    ctx.beginPath()
    ctx.arc(x - q * 0.5, y + q * 0.12, q * 0.34, Math.PI * 0.5, Math.PI * 1.5)
    ctx.arc(x - q * 0.08, y - q * 0.22, q * 0.44, Math.PI * 1.08, Math.PI * 1.88)
    ctx.arc(x + q * 0.52, y + q * 0.12, q * 0.34, Math.PI * 1.5, Math.PI * 0.5)
    ctx.closePath()
    // Filled with the screen's own dark first, so it sits in front of a sun.
    ctx.save()
    ctx.fillStyle = '#081d21'
    ctx.fill()
    ctx.restore()
    ctx.stroke()
  }
  const below = (draw: (x: number) => void) => [-0.4, 0, 0.4].forEach((k) => draw(cx + k * r))

  switch (kind) {
    case 'sun':
      sun(cx, cy, r * 0.95)
      break
    case 'moon':
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.7, Math.PI * 0.3, Math.PI * 1.55)
      ctx.arc(cx + r * 0.42, cy - r * 0.3, r * 0.62, Math.PI * 1.2, Math.PI * 0.62, true)
      ctx.closePath()
      ctx.stroke()
      break
    case 'partly':
      sun(cx + r * 0.38, cy - r * 0.36, r * 0.58)
      cloud(cx - r * 0.1, cy + r * 0.22, r * 0.82)
      break
    case 'cloud':
      cloud(cx, cy, r)
      break
    case 'fog':
      for (const k of [-0.5, 0, 0.5]) {
        ctx.beginPath()
        ctx.moveTo(cx - r * (k === 0 ? 0.9 : 0.6), cy + k * r)
        ctx.lineTo(cx + r * (k === 0 ? 0.9 : 0.6), cy + k * r)
        ctx.stroke()
      }
      break
    case 'rain':
      cloud(cx, cy - r * 0.28, r * 0.9)
      below((x) => {
        ctx.beginPath()
        ctx.moveTo(x + r * 0.08, cy + r * 0.38)
        ctx.lineTo(x - r * 0.1, cy + r * 0.88)
        ctx.stroke()
      })
      break
    case 'snow':
      cloud(cx, cy - r * 0.28, r * 0.9)
      below((x) => {
        ctx.beginPath()
        ctx.arc(x, cy + r * 0.64, r * 0.09, 0, Math.PI * 2)
        ctx.fill()
      })
      break
    case 'storm':
      cloud(cx, cy - r * 0.28, r * 0.9)
      ctx.beginPath()
      ctx.moveTo(cx + r * 0.12, cy + r * 0.2)
      ctx.lineTo(cx - r * 0.2, cy + r * 0.62)
      ctx.lineTo(cx + r * 0.1, cy + r * 0.62)
      ctx.lineTo(cx - r * 0.12, cy + r * 1.0)
      ctx.stroke()
      break
  }
}
