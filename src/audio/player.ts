import { groupByGenre, loadTapes, type Genre, type Tape } from './tapes'

/**
 * The tape deck's state and transport, shared by the 3D deck in the room and the
 * controls around it. One audio element, one cassette (a genre) loaded at a time.
 */
export interface PlayerState {
  genres: readonly Genre[]
  /** Index of the genre whose cassette is in the deck. */
  loaded: number | null
  track: number
  playing: boolean
  /** Held mid-track by the pause key, as opposed to stopped. */
  paused: boolean
  /** 0..1. */
  volume: number
  /** Seconds into the track, and its length (NaN until known). */
  at: number
  of: number
}

export type DeckKey = 'play' | 'pause' | 'stop' | 'rewind' | 'forward' | 'eject'

/** Rewind goes to the start of the track; pressed again this early, to the one before. */
const REWIND_RESTART_S = 3
const VOLUME = 0.8

let state: PlayerState = { genres: [], loaded: null, track: 0, playing: false, paused: false, volume: VOLUME, at: 0, of: NaN }
const listeners = new Set<() => void>()
let audio: HTMLAudioElement | null = null

function set(patch: Partial<PlayerState>): void {
  state = { ...state, ...patch }
  listeners.forEach((cb) => cb())
}

function currentTape(): Tape | undefined {
  return state.loaded === null ? undefined : state.genres[state.loaded]?.tapes[state.track]
}

function element(): HTMLAudioElement {
  if (audio) return audio
  const a = new Audio()
  a.preload = 'none'
  a.volume = state.volume
  a.addEventListener('play', () => set({ playing: true, paused: false }))
  a.addEventListener('pause', () => set({ playing: false }))
  a.addEventListener('timeupdate', () => set({ at: a.currentTime, of: a.duration }))
  a.addEventListener('ended', () => forward(true))
  audio = a
  return a
}

/** Point the element at a track. Synchronous, so a following play() keeps the click's user gesture. */
function cue(loaded: number | null, track: number): void {
  set({ loaded, track, paused: false, at: 0, of: NaN })
  const a = element()
  const tape = currentTape()
  if (tape) a.src = tape.src
  else a.removeAttribute('src')
}

function play(): void {
  if (!currentTape()) return
  void element()
    .play()
    .catch(() => set({ playing: false }))
}

/** Hold the tape where it is; pressed again, let it run. */
function pause(): void {
  if (!currentTape()) return
  if (state.playing) {
    element().pause()
    set({ paused: true })
  } else if (state.paused) play()
}

/** Stop and wind back to the start of the track. */
function stop(): void {
  const a = element()
  a.pause()
  if (currentTape() && a.currentTime > 0) a.currentTime = 0
  set({ paused: false, at: 0 })
}

function forward(keepPlaying = state.playing): void {
  const genre = state.loaded === null ? undefined : state.genres[state.loaded]
  if (!genre) return
  cue(state.loaded, (state.track + 1) % genre.tapes.length)
  if (keepPlaying) play()
}

function rewind(): void {
  if (!currentTape()) return
  const a = element()
  const wasPlaying = state.playing
  if (a.currentTime > REWIND_RESTART_S || state.track === 0) {
    a.currentTime = 0
    set({ at: 0 })
  } else {
    cue(state.loaded, state.track - 1)
    if (wasPlaying) play()
  }
}

export const player = {
  get: (): PlayerState => state,
  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  /** Read the manifest once. With no tracks the deck stays empty. */
  async init(): Promise<void> {
    if (state.genres.length) return
    set({ genres: groupByGenre(await loadTapes()) })
  },
  /** Put a genre's cassette in the deck and start it. */
  load(index: number): void {
    if (index === state.loaded || !state.genres[index]) return
    stop()
    cue(index, 0)
    play()
  },
  eject(): void {
    stop()
    cue(null, 0)
  },
  press(key: DeckKey): void {
    if (key === 'play') play()
    else if (key === 'pause') pause()
    else if (key === 'stop') stop()
    else if (key === 'rewind') rewind()
    else if (key === 'forward') forward()
    else player.eject()
  },
  /** Turn the volume knob by a step: negative is quieter. */
  turn(by: number): void {
    const volume = Math.min(1, Math.max(0, Math.round((state.volume + by) * 10) / 10))
    element().volume = volume
    set({ volume })
  },
  /** Set the volume outright, 0..1: the knob being dragged. */
  volume(to: number): void {
    const volume = Math.min(1, Math.max(0, to))
    if (volume === state.volume) return
    element().volume = volume
    set({ volume })
  },
  tape: currentTape,
}

export function clockText(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--:--'
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
