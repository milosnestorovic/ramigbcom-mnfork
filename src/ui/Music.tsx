import { useEffect, useRef, useSyncExternalStore } from 'react'
import { clockText, player, type DeckKey } from '../audio/player'
import { closeArea, openArea } from '../state/controller'
import { useRoom } from '../state/store'

const KEYS: readonly [DeckKey, string][] = [
  ['rewind', 'Rewind'],
  ['play', 'Play'],
  ['stop', 'Stop'],
  ['forward', 'Next track'],
  ['eject', 'Eject'],
]

/** The corner control: says what is playing and walks over to the tape deck. */
export function TapeButton() {
  const s = useSyncExternalStore(player.subscribe, player.get)
  const area = useRoom((r) => r.area)
  if (!s.genres.length) return null
  const tape = player.tape()
  return (
    <button
      type="button"
      className="control"
      aria-pressed={s.playing}
      onClick={() => (area === 'music' ? closeArea() : openArea('music'))}
    >
      <span className="control__bars" data-on={s.playing} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="music__now">{s.playing && tape ? tape.title : 'Music'}</span>
    </button>
  )
}

/**
 * The deck and its tray of cassettes are a model in the scene, worked with the
 * pointer. These are the same controls as real buttons, for keyboards and screen readers.
 */
export function Music() {
  const s = useSyncExternalStore(player.subscribe, player.get)
  const moving = useRoom((r) => r.moving)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const genre = s.loaded === null ? undefined : s.genres[s.loaded]
  const tape = player.tape()

  useEffect(() => {
    if (!moving) headingRef.current?.focus({ preventScroll: true })
  }, [moving])

  return (
    <section className="sr-only" aria-labelledby="music-title">
      <h2 id="music-title" ref={headingRef} tabIndex={-1}>
        Tape deck
      </h2>
      <p aria-live="polite">
        {tape && genre
          ? `${s.playing ? 'Playing' : 'Stopped'}: ${tape.title}, track ${s.track + 1} of ${genre.tapes.length} on the ${genre.name} tape, ${clockText(s.at)} of ${clockText(s.of)}.`
          : 'No tape in the deck.'}
      </p>
      <ul>
        {s.genres.map((g, i) => (
          <li key={g.name}>
            <button type="button" onClick={() => player.load(i)} aria-pressed={i === s.loaded}>
              {g.name} tape, {g.tapes.length} {g.tapes.length === 1 ? 'track' : 'tracks'}
            </button>
          </li>
        ))}
      </ul>
      {KEYS.map(([key, label]) => (
        <button type="button" key={key} onClick={() => player.press(key)} disabled={!tape}>
          {label}
        </button>
      ))}
    </section>
  )
}
