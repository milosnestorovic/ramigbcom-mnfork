import { useRef } from 'react'
import { AREAS, areaById, type AreaId } from '../areas'
import { getRenderer, openArea } from '../state/controller'
import { room, useRoom } from '../state/store'
import { useFrame } from './useScene'

/**
 * The room's navigation for keyboards and screen readers: real buttons, visually
 * hidden. Focusing one highlights its object exactly like hovering does.
 */
export function HotspotNav() {
  const area = useRoom((s) => s.area)
  const highlight = (id: AreaId | null) => {
    const a = id ? areaById(id) : null
    getRenderer()?.setHover(a?.outline ?? null, a?.tint)
    room.set({ hovered: id })
  }
  return (
    <nav className="room-nav" aria-label="Places in the room" inert={area !== null}>
      <ul>
        {AREAS.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              data-area={a.id}
              onFocus={() => highlight(a.id)}
              onBlur={() => highlight(null)}
              onClick={() => openArea(a.id)}
            >
              {a.label}
              <span className="sr-only">: {a.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** One quiet label, pinned to whatever is hovered or focused. */
export function HoverLabel() {
  const hovered = useRoom((s) => (s.area ? null : s.hovered))
  const ref = useRef<HTMLDivElement>(null)
  const area = hovered ? areaById(hovered) : null

  useFrame((f, r) => {
    const el = ref.current
    if (!el || !area) return
    const [x, y] = r.project(area.anchor[0], area.anchor[1])
    const flip = x > f.width * 0.72
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`
    el.dataset.flip = flip ? 'true' : 'false'
  })

  if (!area) return null
  return (
    <div ref={ref} className="hover-label" aria-hidden="true" key={area.id}>
      <span className="hover-label__dot" />
      <span className="hover-label__leader" />
      <span className="hover-label__text">
        <strong>{area.label}</strong>
        <em>{area.hint}</em>
      </span>
    </div>
  )
}

/** Touch screens have no hover, so every object gets a small, always-on marker. */
export function TouchMarkers() {
  const visible = useRoom((s) => s.ready && !s.area && !s.moving)
  const refs = useRef(new Map<AreaId, HTMLButtonElement>())

  useFrame((f, r) => {
    for (const a of AREAS) {
      const el = refs.current.get(a.id)
      if (!el) continue
      const [x, y] = r.project(a.anchor[0], a.anchor[1])
      const off = x < -20 || x > f.width + 20
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      el.style.visibility = off ? 'hidden' : 'visible'
      el.dataset.flip = x > f.width * 0.66 ? 'true' : 'false'
    }
  })

  return (
    <div className="markers" data-visible={visible} aria-hidden="true">
      {AREAS.map((a) => (
        <button
          key={a.id}
          type="button"
          tabIndex={-1}
          className="marker"
          ref={(el) => {
            if (el) refs.current.set(a.id, el)
            else refs.current.delete(a.id)
          }}
          onClick={() => openArea(a.id)}
        >
          <span className="marker__dot" />
          <span className="marker__label">{a.label}</span>
        </button>
      ))}
    </div>
  )
}
