import { describe, expect, it } from 'vitest'
import { AREAS } from './areas'
import { projects } from './content/projects'
import { hitTest } from './hit'
import { polygonBounds } from './scene/polygon'
import { areaFromPath, pathForArea } from './state/router'
import { findProject, run } from './ui/sections/terminal/commands'

describe('routes', () => {
  it('round-trips every area', () => {
    for (const a of AREAS) {
      expect(areaFromPath(pathForArea(a.id))).toBe(a.id)
      expect(areaFromPath(`${a.route}/`)).toBe(a.id)
    }
  })

  it('treats the root, index.html and unknown paths as the room', () => {
    expect(areaFromPath('/')).toBeNull()
    expect(areaFromPath('/index.html')).toBeNull()
    expect(areaFromPath('/nope')).toBeNull()
  })
})

describe('hotspots', () => {
  const center = (poly: Parameters<typeof polygonBounds>[0]) => {
    const [x0, y0, x1, y1] = polygonBounds(poly)
    return [(x0 + x1) / 2, (y0 + y1) / 2] as const
  }

  it('resolves each object to its own area', () => {
    expect(hitTest(170, 425)).toEqual({ kind: 'area', id: 'projects' })
    expect(hitTest(200, 850)).toEqual({ kind: 'area', id: 'about' })
    expect(hitTest(900, 700)).toEqual({ kind: 'area', id: 'hobbies' })
    expect(hitTest(1340, 528)).toEqual({ kind: 'area', id: 'music' })
    expect(hitTest(800, 300)).toEqual({ kind: 'area', id: 'contact' })
    expect(hitTest(610, 580)).toEqual({ kind: 'area', id: 'experiments' })
  })

  it('lets the lamp win over the window around it', () => {
    expect(hitTest(884, 62)).toEqual({ kind: 'lamp' })
  })

  it('has label anchors that sit on their own object (or just at its edge)', () => {
    for (const a of AREAS) {
      const [x0, y0, x1, y1] = polygonBounds(a.hotspot)
      expect(a.anchor[0]).toBeGreaterThanOrEqual(x0)
      expect(a.anchor[0]).toBeLessThanOrEqual(x1)
      expect(a.anchor[1]).toBeGreaterThanOrEqual(y0)
      expect(a.anchor[1]).toBeLessThanOrEqual(y1)
      expect(center(a.hotspot)).toBeDefined()
    }
  })

  it('leaves the rug in front of the bed empty', () => {
    expect(hitTest(800, 1000)).toBeNull()
  })
})

describe('terminal', () => {
  it('finds projects by number, slug, name and prefix', () => {
    expect(findProject('1')).toBe(projects[0])
    expect(findProject('outpost')?.slug).toBe('outpost')
    expect(findProject('smolBro')?.slug).toBe('smolbro')
    expect(findProject('sem')?.slug).toBe('semantic_skeletonizer')
    expect(findProject('99')).toBeUndefined()
  })

  it('opens projects and lists them', () => {
    expect(run('ls').lines).toEqual([{ kind: 'list' }])
    expect(run('open epoptes').lines[0]).toMatchObject({ kind: 'project', project: { slug: 'epoptes' } })
    expect(run('open nothing').lines[0]).toMatchObject({ kind: 'text', tone: 'warn' })
  })

  it('maps exit, clear and cd .. to effects', () => {
    expect(run('exit').effect).toEqual({ type: 'close' })
    expect(run('cd ..').effect).toEqual({ type: 'close' })
    expect(run('clear').effect).toEqual({ type: 'clear' })
    expect(run('about').effect).toEqual({ type: 'goto', area: 'about' })
  })

  it('handles unknown commands and empty input gracefully', () => {
    expect(run('').lines).toEqual([])
    expect(run('frobnicate').lines[0]).toMatchObject({ kind: 'text', tone: 'warn' })
  })
})
