import { useEffect, useState } from 'react'
import { useRoom } from './state/store'
import { Chrome } from './ui/Chrome'
import { HotspotNav, HoverLabel, TouchMarkers } from './ui/Hotspots'
import { RoomStage, type RoomAssets } from './ui/RoomStage'
import { SectionLayer } from './ui/sections/Sections'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load ${src}`))
    img.src = src
  })
}

export function App() {
  const [assets, setAssets] = useState<RoomAssets | null>(null)
  const [failed, setFailed] = useState(false)
  const [slow, setSlow] = useState(false)
  const ready = useRoom((s) => s.ready)

  useEffect(() => {
    let alive = true
    const slowTimer = window.setTimeout(() => alive && setSlow(true), 600)
    Promise.all(['/scene/room.webp', '/scene/depth.png', '/scene/blur1.webp', '/scene/blur2.webp', '/scene/player.webp'].map(loadImage))
      .then(
        ([room, depth, blur1, blur2, player]) =>
          alive && room && depth && blur1 && blur2 && player && setAssets({ room, depth, blur1, blur2, player }),
      )
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      window.clearTimeout(slowTimer)
    }
  }, [])

  return (
    <main className="app" data-ready={ready}>
      {assets && !failed && <RoomStage assets={assets} />}
      {!ready && slow && !failed && (
        <p className="loading" role="status">
          connecting<span aria-hidden="true">...</span>
        </p>
      )}
      {failed && (
        <p className="loading" role="alert">
          The room didn&apos;t load. <a href="/pages/cv.html">Read the CV instead</a>.
        </p>
      )}
      {ready && (
        <>
          <HoverLabel />
          <TouchMarkers />
          <SectionLayer />
          <HotspotNav />
        </>
      )}
      <Chrome />
    </main>
  )
}
