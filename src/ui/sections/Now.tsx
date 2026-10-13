import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { describeNow, getNow, subscribeNow } from '../../now/now'
import { useRoom } from '../../state/store'

/**
 * The small CRT draws itself inside the scene, so there is nothing to lay out
 * here: this is the same information as text, for keyboards and screen readers.
 */
export function Now() {
  const now = useSyncExternalStore(subscribeNow, getNow)
  const moving = useRoom((s) => s.moving)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!moving) headingRef.current?.focus({ preventScroll: true })
  }, [moving])

  return (
    <section className="sr-only" aria-labelledby="now-title">
      <h2 id="now-title" ref={headingRef} tabIndex={-1}>
        Right now
      </h2>
      <p>{describeNow(now, time)}</p>
    </section>
  )
}
