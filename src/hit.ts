import { areaById, HIT_ORDER, LAMP, LAMP_OUTLINE, TABLET, TABLET_OUTLINE, type AreaId } from './areas'
import { pointInPolygon, type Polygon } from './scene/polygon'

export type Hit = { kind: 'area'; id: AreaId } | { kind: 'lamp' } | { kind: 'tablet' }

/** What's under an image pixel. Small objects win over the big window around them. */
export function hitTest(px: number, py: number): Hit | null {
  if (pointInPolygon(px, py, LAMP)) return { kind: 'lamp' }
  if (pointInPolygon(px, py, TABLET)) return { kind: 'tablet' }
  for (const id of HIT_ORDER) {
    if (pointInPolygon(px, py, areaById(id).hotspot)) return { kind: 'area', id }
  }
  return null
}

/** The silhouette to light up for a hit. */
export function hitOutline(hit: Hit): readonly Polygon[] {
  if (hit.kind === 'lamp') return LAMP_OUTLINE
  if (hit.kind === 'tablet') return TABLET_OUTLINE
  return areaById(hit.id).outline
}

export function sameHit(a: Hit | null, b: Hit | null): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  return a.kind !== 'area' || a.id === (b as { id: AreaId }).id
}
