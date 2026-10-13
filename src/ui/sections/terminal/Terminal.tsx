import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { MONITOR_SCREEN } from '../../../areas'
import { projects } from '../../../content/projects'
import { quadToMatrix3d, type Point } from '../../../scene/homography'
import type { RoomRenderer } from '../../../scene/RoomRenderer'
import { closeArea, getRenderer, openArea, shotForArea } from '../../../state/controller'
import { toggleLamp, toggleRain } from '../../../state/eggs'
import { useRoom } from '../../../state/store'
import { useFrame } from '../../useScene'
import { CONTACT_LINKS, run, type Line } from './commands'

interface Entry {
  id: number
  prompt?: string
  lines: Line[]
}

const PROMPT = 'rami@room:~/projects$'
const MIN_LOGICAL_W = 360
const BOOTED_KEY = 'room.booted'

type Quad = [Point, Point, Point, Point]

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** The CRT glass on screen. Each corner uses its own depth so it lines up with the plate. */
function screenQuad(r: RoomRenderer, project: (px: number, py: number, d: number) => [number, number]): Quad {
  return MONITOR_SCREEN.map((p) => project(p[0], p[1], r.depth.depth(p[0], p[1]))) as unknown as Quad
}

function quadSize([tl, tr, br, bl]: Quad): { w: number; h: number } {
  const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
  return { w: (dist(tl, tr) + dist(bl, br)) / 2, h: (dist(tl, bl) + dist(tr, br)) / 2 }
}

/**
 * Pull a quad toward the upright rectangle with the same center and size. Only
 * phones use it: everywhere else the terminal sits exactly in the CRT's glass.
 */
function flatten(q: Quad, t: number): Quad {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4
  const { w, h } = quadSize(q)
  const rect: Quad = [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ]
  return q.map((p, i) => [p[0] + (rect[i]![0] - p[0]) * t, p[1] + (rect[i]![1] - p[1]) * t]) as unknown as Quad
}

/** The terminal's own pixel size: whatever the screen measures once the camera arrives. */
function restSize(): { w: number; h: number } {
  const r = getRenderer()
  if (!r) return { w: 640, h: 480 }
  const shot = shotForArea('projects')(r.aspect)
  const { w, h } = quadSize(screenQuad(r, (x, y, d) => r.projectFor(shot, x, y, d)))
  const k = w < MIN_LOGICAL_W ? MIN_LOGICAL_W / w : 1
  return { w: Math.round(w * k), h: Math.round(h * k) }
}

function hasBooted(): boolean {
  try {
    return sessionStorage.getItem(BOOTED_KEY) === '1'
  } catch {
    return true
  }
}

function markBooted(): void {
  try {
    sessionStorage.setItem(BOOTED_KEY, '1')
  } catch {
    // Private mode or blocked storage: the boot lines just show again next time.
  }
}

let nextId = 1

function initialLog(): Entry[] {
  const boot: Entry[] =
    !hasBooted() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? [
          {
            id: nextId++,
            lines: [
              { kind: 'text', text: 'RGB-OS 2.6  tty1', tone: 'dim' },
              { kind: 'text', text: 'mounting /home/rami ........ ok', tone: 'dim' },
              { kind: 'text', text: `indexing projects ......... ${projects.length} found`, tone: 'dim' },
            ],
          },
        ]
      : []
  return [...boot, { id: nextId++, prompt: 'ls', lines: [{ kind: 'list' }] }]
}

export function Terminal() {
  const crtRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [size, setSize] = useState(restSize)
  const [log, setLog] = useState<Entry[]>(initialLog)
  const [input, setInput] = useState('')
  const history = useRef<string[]>([])
  const historyPos = useRef(-1)
  const moving = useRoom((s) => s.moving)

  useEffect(markBooted, [])

  useEffect(() => {
    const onResize = () => setSize(restSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (moving) return
    // Typing is the point on desktop; on touch, don't summon the keyboard uninvited.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus({ preventScroll: true })
    else headingRef.current?.focus({ preventScroll: true })
  }, [moving])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const flat = useRef(0)
  useFrame((f, r) => {
    const el = crtRef.current
    if (!el) return
    // Phones get a fully upright screen: there's no spare resolution for perspective.
    const goal = !f.moving && f.width < f.height ? 1 : 0
    flat.current = reducedMotion.matches ? goal : flat.current + (goal - flat.current) * 0.12
    const quad = flatten(screenQuad(r, (x, y, d) => r.project(x, y, d)), flat.current)
    el.style.transform = quadToMatrix3d(size.w, size.h, quad)
    el.dataset.placed = 'true'
  })

  const exec = (cmd: string) => {
    const result = run(cmd)
    if (cmd.trim()) {
      history.current = [cmd, ...history.current.filter((h) => h !== cmd)].slice(0, 30)
      historyPos.current = -1
    }
    const effect = result.effect
    if (effect?.type === 'clear') {
      setLog([])
      return
    }
    setLog((l) => [...l, { id: nextId++, prompt: cmd, lines: result.lines }].slice(-40))
    if (effect?.type === 'close') closeArea()
    else if (effect?.type === 'goto') window.setTimeout(() => openArea(effect.area), 450)
    else if (effect?.type === 'lamp') toggleLamp()
    else if (effect?.type === 'rain') toggleRain()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    exec(input)
    setInput('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const h = history.current
      const pos = Math.min(Math.max(historyPos.current + (e.key === 'ArrowUp' ? 1 : -1), -1), h.length - 1)
      historyPos.current = pos
      setInput(pos < 0 ? '' : (h[pos] ?? ''))
    }
  }

  return (
    <section className="crt-wrap" aria-labelledby="projects-title">
      <div
        ref={crtRef}
        className="crt"
        style={{ width: size.w, height: size.h, ['--crt-w' as string]: `${size.w}px` }}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('crt__log')) inputRef.current?.focus()
        }}
      >
        <div className="crt__screen">
          <header className="crt__bar">
            <h2 id="projects-title" ref={headingRef} tabIndex={-1}>
              ~/projects
            </h2>
            <span>{projects.length} entries</span>
          </header>
          <div ref={scrollRef} className="crt__log" role="log" aria-live="polite">
            {log.map((entry) => (
              <div className="crt__entry" key={entry.id}>
                {entry.prompt !== undefined && (
                  <p className="t t--cmd">
                    <span className="t__ps">{PROMPT}</span> {entry.prompt}
                  </p>
                )}
                {entry.lines.map((line, i) => (
                  <LineView key={i} line={line} exec={exec} />
                ))}
              </div>
            ))}
          </div>
          <form className="crt__prompt" onSubmit={onSubmit}>
            <label htmlFor="crt-input" className="t__ps">
              {PROMPT}
            </label>
            <input
              id="crt-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Terminal command. Type help for a list."
              placeholder="type help"
            />
          </form>
        </div>
        <div className="crt__glass" aria-hidden="true" />
      </div>
    </section>
  )
}

function LineView({ line, exec }: { line: Line; exec: (cmd: string) => void }) {
  switch (line.kind) {
    case 'text':
      return <p className={`t${line.tone ? ` t--${line.tone}` : ''}`}>{line.text}</p>
    case 'list':
      return (
        <ol className="t-list">
          {projects.map((p, i) => (
            <li key={p.slug}>
              <button type="button" onClick={() => exec(`open ${p.slug}`)}>
                <span className="t-list__n">{String(i + 1).padStart(2, '0')}</span>
                <span className="t-list__name">{p.name}</span>
                <span className="t-list__focus">{p.focus}</span>
              </button>
            </li>
          ))}
        </ol>
      )
    case 'project': {
      const p = line.project
      return (
        <article className="t-project">
          <h3>{p.name}</h3>
          <p className="t--dim">{p.stack ?? p.focus}</p>
          <p>{p.about}</p>
          <p className="t-project__actions">
            <a href={p.link} target="_blank" rel="noreferrer">
              {p.link.replace('https://', '')} <span aria-hidden="true">&#8599;</span>
            </a>
            <button type="button" onClick={() => exec('ls')}>
              [ back to list ]
            </button>
          </p>
        </article>
      )
    }
    case 'links':
      return (
        <ul className="t-links">
          {CONTACT_LINKS.map((l) => (
            <li key={l.label}>
              <a href={l.href} {...(l.kind === 'external' ? { target: '_blank', rel: 'noreferrer' } : {})}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )
  }
}
