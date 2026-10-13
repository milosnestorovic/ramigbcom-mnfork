import { useEffect, useRef } from 'react'
import { AREAS, areaById, LAMP, MONITOR_SCREEN, SCREENS, TOP_SCREEN, type AreaId } from '../areas'
import { player } from '../audio/player'
import { BOARD_H, BOARD_W, drawBoard } from '../now/board'
import { getNow, startNow, subscribeNow } from '../now/now'
import { hitOutline, hitTest, sameHit, type Hit } from '../hit'
import { DECK_REACH, DECK_RECT, DeckArt, PATCH_RECT, type DeckTarget } from '../scene/deckArt'
import { RoomRenderer } from '../scene/RoomRenderer'
import { maxPan } from '../scene/view'
import { attachRenderer, closeArea, getPan, openArea, setPan, setReducedMotion } from '../state/controller'
import { feedKonami, tapTablet, toggleLamp } from '../state/eggs'
import { room } from '../state/store'
import { publishRenderer } from './useScene'

export interface RoomAssets {
  room: HTMLImageElement
  depth: HTMLImageElement
  blur1: HTMLImageElement
  blur2: HTMLImageElement
  /** A sharper copy of the tape deck's corner of the room. */
  player: HTMLImageElement
}

const DRAG_THRESHOLD = 8
/** The volume knob: pixels of drag from silent to full, and how it behaves when simply held. */
const KNOB_TRAVEL_PX = 180
const KNOB_DRAG_PX = 3
const KNOB_HOLD_MS = 280
const KNOB_HOLD_RATE = 0.45
/** Idle tour: quiet time before it starts, one step per period, highlight time per step. */
const IDLE_MS = 4000
const TOUR_PERIOD_MS = 5000
const TOUR_ON_MS = 2200

export function RoomStage({ assets }: { assets: RoomAssets }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const board = document.createElement('canvas')
    board.width = BOARD_W
    board.height = BOARD_H
    const deck = new DeckArt()
    const r = new RoomRenderer(host, assets.room, assets.depth, [assets.blur1, assets.blur2], {
      screens: SCREENS,
      lamp: LAMP,
      saver: MONITOR_SCREEN,
      info: TOP_SCREEN,
      board,
      deck: {
        rect: PATCH_RECT,
        artRect: DECK_RECT,
        // The potted plant in front of the shelf's near end.
        leaves: [1338, 552, 1430, 620],
        patch: assets.player,
        art: deck.canvas,
        level: [DECK_REACH[0] - 8, DECK_REACH[1] - 8, DECK_REACH[2] + 8, DECK_REACH[3] + 8],
        // The front of the player that was painted here.
        at: [1346, 555],
      },
    })
    const detach = attachRenderer(r)

    // The small CRT: redraw when the minute turns, the weather arrives or the font loads.
    const paintBoard = () => {
      drawBoard(board, getNow(), new Date())
      r.refreshInfo()
    }
    let minuteTimer = 0
    const onMinute = () => {
      paintBoard()
      minuteTimer = window.setTimeout(onMinute, 60_000 - (Date.now() % 60_000) + 50)
    }
    onMinute()
    const syncDeck = () => {
      const s = player.get()
      const genre = s.loaded === null ? undefined : s.genres[s.loaded]
      deck.setView({
        tapes: s.genres.map((g) => g.name),
        loaded: s.loaded,
        title: genre?.tapes[s.track]?.title ?? '',
        trackLabel: genre ? `${s.track + 1}/${genre.tapes.length}` : '',
        playing: s.playing,
        paused: s.paused,
        volume: s.volume,
        at: s.at,
        of: s.of,
      })
    }
    const unsubPlayer = player.subscribe(syncDeck)
    syncDeck()
    void player.init()
    const deckTargetAt = (x: number, y: number): DeckTarget | null => {
      if (room.get().area !== 'music' || room.get().moving) return null
      const px = r.pixelAt(x, y)
      return px ? deck.targetAt(px[0], px[1]) : null
    }
    // The volume knob while it is held: where the pointer went down, and the volume it had then.
    let knob: { id: number; x: number; y: number; from: number; dir: -1 | 1; since: number; dragged: boolean } | null = null
    // The deck is painted into the picture: repaint its canvas while something on it moves.
    let deckFrame = 0
    let deckThen = performance.now()
    const tickDeck = (now: number) => {
      deckFrame = requestAnimationFrame(tickDeck)
      const dt = Math.min((now - deckThen) / 1000, 0.1)
      deckThen = now
      const close = room.get().area === 'music'
      deck.setTurned(close)
      // Held on the knob without dragging: it keeps turning the way it was pushed.
      if (knob && !knob.dragged && now - knob.since > KNOB_HOLD_MS) player.volume(player.get().volume + knob.dir * dt * KNOB_HOLD_RATE)
      if (deck.update(dt, close)) r.refreshDeck()
    }
    deckFrame = requestAnimationFrame(tickDeck)

    void document.fonts.ready.then(() => {
      paintBoard()
      deck.redraw()
    })
    const unsubNow = subscribeNow(paintBoard)
    const stopNow = startNow()
    r.setLamp(room.get().lamp)
    r.setRain(room.get().rain ? 1 : 0)

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const applyMotion = () => setReducedMotion(motion.matches)
    applyMotion()
    motion.addEventListener('change', applyMotion)

    const ro = new ResizeObserver(() => r.resize())
    ro.observe(host)
    publishRenderer(r)
    room.set({ ready: true })
    r.fadeIn()

    let hovered: Hit | null = null
    let drag: { id: number; x: number; y: number; pan: number; moved: boolean } | null = null

    const setHovered = (hit: Hit | null) => {
      if (sameHit(hit, hovered)) return
      hovered = hit
      host.dataset.hot = hit ? 'true' : 'false'
      r.setHover(hit ? hitOutline(hit) : null, hit?.kind === 'area' ? areaById(hit.id).tint : [1, 1, 1])
      room.set({ hovered: hit?.kind === 'area' ? hit.id : null })
    }

    const hitAt = (x: number, y: number): Hit | null => {
      // Locked while inside an area. On the way back out, picking uses the camera
      // mid-flight, so objects are clickable without waiting for it to land.
      if (room.get().area) return null
      const px = r.pixelAt(x, y)
      return px ? hitTest(px[0], px[1]) : null
    }

    const activate = (hit: Hit | null) => {
      if (!hit) return
      if (hit.kind === 'lamp') toggleLamp()
      else if (hit.kind === 'tablet') tapTablet()
      else {
        setHovered(null)
        openArea(hit.id)
      }
    }

    const onMove = (e: PointerEvent) => {
      const cursor = cursorRef.current
      if (cursor && e.pointerType === 'mouse') cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
      if (knob && knob.id === e.pointerId) {
        // Up or to the right is louder, like turning it clockwise.
        const along = e.clientX - knob.x - (e.clientY - knob.y)
        if (!knob.dragged && Math.abs(along) > KNOB_DRAG_PX) knob.dragged = true
        if (knob.dragged) player.volume(knob.from + along / KNOB_TRAVEL_PX)
        return
      }
      if (e.pointerType === 'mouse') {
        const rect = host.getBoundingClientRect()
        r.setPointer(((e.clientX - rect.left) / rect.width) * 2 - 1, ((e.clientY - rect.top) / rect.height) * 2 - 1)
        if (room.get().area === 'music') {
          const target = deckTargetAt(e.clientX, e.clientY)
          deck.setHover(target)
          host.dataset.hot = target ? 'true' : 'false'
          return
        }
        setHovered(hitAt(e.clientX, e.clientY))
        return
      }
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x
        if (!drag.moved && Math.abs(dx) + Math.abs(e.clientY - drag.y) > DRAG_THRESHOLD) drag.moved = true
        if (drag.moved && !room.get().area) {
          const range = maxPan(r.aspect)
          if (range > 0) {
            // Convert screen pixels into pan units so the room tracks the finger 1:1.
            const tangentPerPx = (r.view.halfW * 2) / host.clientWidth
            setPan(drag.pan - (dx * tangentPerPx) / range)
          }
        }
      }
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = deckTargetAt(e.clientX, e.clientY)
      if (target?.kind === 'volume') {
        knob = { id: e.pointerId, x: e.clientX, y: e.clientY, from: player.get().volume, dir: target.dir, since: performance.now(), dragged: false }
        host.setPointerCapture(e.pointerId)
        return
      }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: getPan(), moved: false }
      if (e.pointerType !== 'mouse') host.setPointerCapture(e.pointerId)
    }

    const onUp = (e: PointerEvent) => {
      if (knob && knob.id === e.pointerId) {
        // A plain click still nudges it one step.
        if (!knob.dragged && performance.now() - knob.since <= KNOB_HOLD_MS) player.turn(knob.dir * 0.1)
        knob = null
        return
      }
      if (!drag || drag.id !== e.pointerId) return
      const wasDrag = drag.moved
      drag = null
      if (wasDrag) return
      const target = deckTargetAt(e.clientX, e.clientY)
      if (target?.kind === 'tape') player.load(target.index)
      else if (target?.kind === 'key') {
        deck.tap(target.key)
        player.press(target.key)
      } else activate(hitAt(e.clientX, e.clientY))
    }

    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      r.setPointer(0, 0)
      setHovered(null)
    }

    const unsub = room.subscribe(() => {
      // Leaving the overview clears hover; returning restores it on the next move.
      if (room.get().area && hovered) setHovered(null)
      if (room.get().area !== 'music') deck.setHover(null)
    })

    // Idle tour. On mouse-driven screens, after a few quiet seconds, light up one object
    // at a time exactly as a hover would, so visitors learn the room is clickable.
    // Touch screens already show permanent markers, so they skip this.
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    let idleTimer = 0
    let tourTimer = 0
    let tourIndex = 0
    let tourShown: AreaId | null = null

    const clearTourHighlight = () => {
      if (tourShown && room.get().hovered === tourShown) {
        r.setHover(null)
        room.set({ hovered: null })
      }
      tourShown = null
    }

    const canTour = () => {
      const s = room.get()
      // Never override a real hover or a keyboard-focused object.
      return finePointer.matches && !s.area && !s.moving && !hovered && !document.hidden && s.hovered === null
    }

    const tourStep = () => {
      if (!canTour()) {
        tourTimer = window.setTimeout(tourStep, TOUR_PERIOD_MS)
        return
      }
      const a = AREAS[tourIndex++ % AREAS.length]!
      tourShown = a.id
      r.setHover(a.outline, a.tint)
      room.set({ hovered: a.id })
      tourTimer = window.setTimeout(() => {
        clearTourHighlight()
        tourTimer = window.setTimeout(tourStep, TOUR_PERIOD_MS - TOUR_ON_MS)
      }, TOUR_ON_MS)
    }

    const onActivity = () => {
      window.clearTimeout(idleTimer)
      window.clearTimeout(tourTimer)
      clearTourHighlight()
      idleTimer = window.setTimeout(tourStep, IDLE_MS)
    }
    const activityEvents = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    // Capture phase, so the tour's highlight is gone before a real hover is applied.
    for (const ev of activityEvents) window.addEventListener(ev, onActivity, { capture: true, passive: true })
    onActivity()

    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerdown', onDown)
    host.addEventListener('pointerup', onUp)
    host.addEventListener('pointercancel', onUp)
    host.addEventListener('pointerleave', onLeave)

    return () => {
      window.clearTimeout(minuteTimer)
      unsubPlayer()
      cancelAnimationFrame(deckFrame)
      unsubNow()
      stopNow()
      window.clearTimeout(idleTimer)
      window.clearTimeout(tourTimer)
      for (const ev of activityEvents) window.removeEventListener(ev, onActivity, { capture: true })
      unsub()
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerdown', onDown)
      host.removeEventListener('pointerup', onUp)
      host.removeEventListener('pointercancel', onUp)
      host.removeEventListener('pointerleave', onLeave)
      motion.removeEventListener('change', applyMotion)
      ro.disconnect()
      detach()
      publishRenderer(null)
      r.dispose()
    }
  }, [assets])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A modal (help) handles its own keys, Esc included.
      if (document.querySelector('dialog[open]')) return
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') {
        if (room.get().area) {
          e.preventDefault()
          closeArea()
        }
        return
      }
      if (!typing) feedKonami(e.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div ref={hostRef} className="stage" data-hot="false" />
      <div ref={cursorRef} className="cursor" aria-hidden="true">
        <span className="cursor__dot" />
        <span className="cursor__ring" />
      </div>
    </>
  )
}
