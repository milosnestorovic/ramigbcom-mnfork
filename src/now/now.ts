/**
 * What the small CRT shows: the visitor's own time, place and weather.
 * The place comes from a coarse IP lookup (no permission prompt), falling back to
 * the browser's time zone city; the forecast comes from Open-Meteo. Neither needs a key.
 */

export interface Place {
  name: string
  lat: number
  lon: number
}

export interface Forecast {
  temp: number
  code: number
  isDay: boolean
  days: { date: string; code: number; hi: number; lo: number }[]
}

export interface NowState {
  place: Place | null
  forecast: Forecast | null
  /** True once a lookup has failed, so the screen can say so. */
  offline: boolean
}

export type IconKind = 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

const TIMEOUT_MS = 8000
const REFRESH_MS = 30 * 60 * 1000

let state: NowState = { place: null, forecast: null, offline: false }
const listeners = new Set<() => void>()

export function getNow(): NowState {
  return state
}

export function subscribeNow(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function set(patch: Partial<NowState>): void {
  state = { ...state, ...patch }
  listeners.forEach((cb) => cb())
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

async function placeFromIp(): Promise<Place> {
  const d = (await getJson('https://get.geojs.io/v1/ip/geo.json')) as Record<string, string | undefined>
  const lat = Number(d.latitude)
  const lon = Number(d.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('no coordinates')
  return { name: d.city || d.region || d.country || 'Here', lat, lon }
}

async function placeFromTimeZone(): Promise<Place> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const city = (zone.split('/').pop() ?? '').replace(/_/g, ' ')
  if (!city) throw new Error('no time zone city')
  const d = (await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`,
  )) as { results?: { name: string; latitude: number; longitude: number }[] }
  const hit = d.results?.[0]
  if (!hit) throw new Error('unknown city')
  return { name: hit.name, lat: hit.latitude, lon: hit.longitude }
}

async function forecastFor(place: Place): Promise<Forecast> {
  const d = (await getJson(
    'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${place.lat}&longitude=${place.lon}` +
      '&current=temperature_2m,weather_code,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&timezone=auto&forecast_days=4',
  )) as {
    current: { temperature_2m: number; weather_code: number; is_day: number }
    daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] }
  }
  return {
    temp: d.current.temperature_2m,
    code: d.current.weather_code,
    isDay: d.current.is_day === 1,
    // Today is already on screen as "now"; the row below shows what comes next.
    days: d.daily.time.slice(1, 4).map((date, i) => ({
      date,
      code: d.daily.weather_code[i + 1] ?? 0,
      hi: d.daily.temperature_2m_max[i + 1] ?? 0,
      lo: d.daily.temperature_2m_min[i + 1] ?? 0,
    })),
  }
}

/** Look the visitor up once, then keep the forecast fresh. Returns a stop function. */
export function startNow(): () => void {
  let alive = true
  const refresh = async () => {
    try {
      const place = state.place ?? (await placeFromIp().catch(placeFromTimeZone))
      if (!alive) return
      set({ place })
      const forecast = await forecastFor(place)
      if (alive) set({ forecast, offline: false })
    } catch {
      // Blocked, offline or rate-limited: the clock still works, the weather says so.
      if (alive) set({ offline: true })
    }
  }
  void refresh()
  const timer = window.setInterval(() => void refresh(), REFRESH_MS)
  return () => {
    alive = false
    window.clearInterval(timer)
  }
}

/** WMO weather interpretation codes, as Open-Meteo reports them. */
export function describeWeather(code: number, isDay = true): { icon: IconKind; label: string } {
  if (code === 0) return { icon: isDay ? 'sun' : 'moon', label: 'Clear' }
  if (code === 1) return { icon: isDay ? 'sun' : 'moon', label: 'Mostly clear' }
  if (code === 2) return { icon: 'partly', label: 'Partly cloudy' }
  if (code === 3) return { icon: 'cloud', label: 'Overcast' }
  if (code === 45 || code === 48) return { icon: 'fog', label: 'Fog' }
  if (code >= 51 && code <= 57) return { icon: 'rain', label: 'Drizzle' }
  if (code >= 61 && code <= 67) return { icon: 'rain', label: 'Rain' }
  if (code >= 71 && code <= 77) return { icon: 'snow', label: 'Snow' }
  if (code >= 80 && code <= 82) return { icon: 'rain', label: 'Showers' }
  if (code === 85 || code === 86) return { icon: 'snow', label: 'Snow showers' }
  if (code >= 95) return { icon: 'storm', label: 'Thunderstorm' }
  return { icon: 'cloud', label: 'Cloudy' }
}

export function clockText(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function dateText(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** The whole screen as one sentence, for screen readers. */
export function describeNow(s: NowState, d: Date): string {
  const parts = [`${dateText(d)}, ${clockText(d)}`]
  if (s.place) parts.push(s.place.name)
  if (s.forecast) {
    const sky = describeWeather(s.forecast.code, s.forecast.isDay).label.toLowerCase()
    parts.push(`${Math.round(s.forecast.temp)} degrees Celsius, ${sky}`)
    for (const day of s.forecast.days) {
      const name = new Date(`${day.date}T12:00`).toLocaleDateString(undefined, { weekday: 'long' })
      parts.push(`${name}: ${describeWeather(day.code).label.toLowerCase()}, ${Math.round(day.lo)} to ${Math.round(day.hi)}`)
    }
  } else if (s.offline) {
    parts.push('weather unavailable')
  }
  return `${parts.join('. ')}.`
}
