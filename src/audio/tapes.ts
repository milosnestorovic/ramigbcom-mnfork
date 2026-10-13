/**
 * Real tracks, dropped into public/audio/ and listed in public/audio/tracks.json:
 *
 *   [{ "title": "Night shift", "src": "night-shift.mp3", "genre": "Lo-fi" }]
 *
 * Each genre becomes one cassette on the shelf; tracks without a genre share a
 * mixtape. With no manifest (or an empty one) the player simply doesn't appear.
 */
export interface Tape {
  title: string
  src: string
  genre: string
}

/** One cassette: every track of a genre, in manifest order. */
export interface Genre {
  name: string
  tapes: Tape[]
}

const UNSORTED = 'Mixtape'

export async function loadTapes(): Promise<Tape[]> {
  try {
    const res = await fetch('/audio/tracks.json', { cache: 'no-cache' })
    if (!res.ok) return []
    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []
    return data
      .filter((t): t is { title: string; src: string; genre?: unknown } => typeof t?.title === 'string' && typeof t?.src === 'string')
      .map((t) => ({
        title: t.title,
        src: t.src.startsWith('/') ? t.src : `/audio/${t.src}`,
        genre: typeof t.genre === 'string' && t.genre.trim() ? t.genre.trim() : UNSORTED,
      }))
  } catch {
    return []
  }
}

/** Genres in the order they first appear in the manifest. */
export function groupByGenre(tapes: readonly Tape[]): Genre[] {
  const genres = new Map<string, Tape[]>()
  for (const t of tapes) genres.set(t.genre, [...(genres.get(t.genre) ?? []), t])
  return [...genres].map(([name, list]) => ({ name, tapes: list }))
}
