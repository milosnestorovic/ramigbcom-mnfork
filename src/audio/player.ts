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
  /** Seconds into the track, and its length (NaN until known). */
  at: number
  of: number
}

export type DeckKey = 'rewind' | 'play' | 'stop' | 'forward' | 'eject'

/** Rewind goes to the start of the track; pressed again this early, to the one before. */
const REWIND_RESTART_S = 3

let state: PlayerState = { genres: [], loaded: null, track: 0, playing: false, at: 0, of: NaN }
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
  a.addEventListener('play', () => set({ playing: true }))
  a.addEventListener('pause', () => set({ playing: false }))
  a.addEventListener('timeupdate', () => set({ at: a.currentTime, of: a.duration }))
  a.addEventListener('ended', () => forward(true))
  audio = a
  return a
}

/** Point the element at a track. Synchronous, so a following play() keeps the click's user gesture. */
function cue(loaded: number | null, track: number): void {
  set({ loaded, track, at: 0, of: NaN })
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

function stop(): void {
  element().pause()
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
    else if (key === 'stop') stop()
    else if (key === 'rewind') rewind()
    else if (key === 'forward') forward()
    else player.eject()
  },
  tape: currentTape,
}

export function clockText(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--:--'
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
