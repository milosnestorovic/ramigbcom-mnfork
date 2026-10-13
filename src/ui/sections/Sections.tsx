import { areaById, type Area } from '../../areas'
import { experiments } from '../../content/experiments'
import { hobbies } from '../../content/hobbies'
import { about } from '../../content/profile'
import { useRoom } from '../../state/store'
import { Music } from '../Music'
import { Contact } from './Contact'
import { Now } from './Now'
import { Panel } from './Panel'
import { Terminal } from './terminal/Terminal'

export function SectionLayer() {
  const area = useRoom((s) => s.area)
  if (!area) return null
  const a = areaById(area)
  return (
    <div className="sections" key={area}>
      {area === 'now' && <Now />}
      {area === 'projects' && <Terminal />}
      {area === 'about' && <About area={a} />}
      {area === 'hobbies' && <Hobbies area={a} />}
      {area === 'music' && <Music />}
      {area === 'contact' && <Contact />}
      {area === 'experiments' && <Experiments area={a} />}
    </div>
  )
}

function About({ area }: { area: Area }) {
  return (
    <Panel area={area} kicker="The armchair" title="About me" className="panel--about">
      <p className="panel__lead">{about.lead}</p>
      {about.blocks.map((b) => (
        <div className="panel__block" key={b.title}>
          <h3>{b.title}</h3>
          <p>{b.body}</p>
        </div>
      ))}
    </Panel>
  )
}

function Hobbies({ area }: { area: Area }) {
  return (
    <Panel area={area} kicker="Off the clock" title="Spare time" className="panel--hobbies">
      {hobbies.map((h) => (
        <div className="panel__block" key={h.title}>
          <h3>{h.title}</h3>
          <p>{h.body}</p>
        </div>
      ))}
    </Panel>
  )
}

function Experiments({ area }: { area: Area }) {
  return (
    <Panel area={area} kicker="Left on the floor" title="Experiments" className="panel--experiments">
      <p className="panel__lead">Things I tried to find out, not to ship. Both ended somewhere interesting.</p>
      {experiments.map((x) => (
        <article className="note" key={x.name}>
          <p className="note__stamp">{x.stamp}</p>
          <h3>{x.name}</h3>
          <p>{x.about}</p>
          {x.detail && <p className="note__detail">{x.detail}</p>}
          <a href={x.link} target="_blank" rel="noreferrer">
            Open on GitHub <span aria-hidden="true">&#8599;</span>
          </a>
        </article>
      ))}
    </Panel>
  )
}
