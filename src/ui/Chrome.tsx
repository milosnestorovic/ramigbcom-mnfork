import { useEffect, useRef, useState } from 'react'
import { Ambience } from '../audio/ambience'
import { profile } from '../content/profile'
import { closeArea } from '../state/controller'
import { room, useRoom } from '../state/store'
import { Help } from './Help'
import { TapeButton } from './Music'
import { useFrame } from './useScene'

const HINT_KEY = 'room.explored'

function explored(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

export function Chrome() {
  const area = useRoom((s) => s.area)
  const ready = useRoom((s) => s.ready)
  const visited = useRoom((s) => s.visited)
  const [firstTime] = useState(() => !explored())
  const showHint = firstTime && !visited

  useEffect(() => {
    if (!visited) return
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      // Storage blocked: the hint will show again next visit, which is fine.
    }
  }, [visited])

  return (
    <div className="chrome" data-ready={ready}>
      <header className="chrome__brand">
        <h1>
          <a href="/" onClick={(e) => (e.preventDefault(), closeArea())}>
            {profile.name}
          </a>
        </h1>
        <span className="chrome__rule" aria-hidden="true" />
        <p>{profile.role}</p>
      </header>

      <div className="chrome__top-right">
        {area ? (
          <button type="button" className="back" onClick={closeArea}>
            <span aria-hidden="true">&#8592;</span> Room <kbd>Esc</kbd>
          </button>
        ) : (
          showHint && (
            <p className="hint">
              <span className="hint__fine">Click an object to explore</span>
              <span className="hint__touch">Drag to look. Tap things.</span>
            </p>
          )
        )}
      </div>

      <div className="chrome__bottom-left">
        <Help />
      </div>

      <div className="chrome__bottom-right">
        <TapeButton />
        <SoundToggle />
      </div>

      <Toast />
    </div>
  )
}

const ambience = new Ambience()

function SoundToggle() {
  const sound = useRoom((s) => s.sound)
  const toggle = () => {
    const next = !sound
    room.set({ sound: next })
    if (next) void ambience.start()
    else ambience.stop()
  }
  return (
    <button type="button" className="control" aria-pressed={sound} onClick={toggle}>
      <span className="control__bars" data-on={sound} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {sound ? 'Rain on' : 'Sound off'}
    </button>
  )
}

function Toast() {
  const toast = useRoom((s) => s.toast)
  const ref = useRef<HTMLParagraphElement>(null)

  useFrame((_f, r) => {
    const el = ref.current
    if (!el || !toast) return
    if (toast.at[0] < 0) {
      el.style.transform = ''
    } else {
      const [x, y] = r.project(toast.at[0], toast.at[1])
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
    el.dataset.placed = 'true'
  })

  if (!toast) return null
  return (
    <p ref={ref} key={toast.key} className="toast" data-center={toast.at[0] < 0} role="status">
      {toast.text}
    </p>
  )
}
