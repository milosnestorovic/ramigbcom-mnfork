import type { Polygon } from './scene/polygon'
import type { Vec2 } from './scene/space'
import type { Framing } from './scene/view'

/**
 * The room map: which object leads where, and how the camera frames it.
 * All coordinates are pixels of docs/room-background.png (1448 x 1086).
 */

export type AreaId = 'now' | 'projects' | 'about' | 'hobbies' | 'music' | 'contact' | 'experiments'

export type PanelPlacement = 'left' | 'right' | 'over' | 'screen'

export interface Area {
  id: AreaId
  route: `/${string}`
  label: string
  /** Short secondary line shown under the label. */
  hint: string
  /** Clickable region around the object: generous, so it is easy to hit. */
  hotspot: Polygon
  /** The object's own silhouette, traced tightly: what lights up on hover. */
  outline: readonly Polygon[]
  /** Where the label's leader line and the section's tether attach. */
  anchor: Vec2
  /** Camera framing for wide (landscape) and narrow (portrait) viewports. */
  wide: Framing
  narrow: Framing
  /** How the section's content is laid out once the camera arrives. */
  panel: PanelPlacement
  /** Depth-of-field strength when focused (0 = none). */
  dof: number
  /** Light tint used for the hover lift. */
  tint: readonly [number, number, number]
}

/** The CRT's glass, clockwise from top-left. */
export const MONITOR_SCREEN: readonly [Vec2, Vec2, Vec2, Vec2] = [
  [123, 388],
  [212, 371],
  [221, 456],
  [134, 484],
]

/** The small CRT's glass, same order. */
export const TOP_SCREEN: readonly [Vec2, Vec2, Vec2, Vec2] = [
  [125, 286],
  [175, 283],
  [177, 338],
  [126, 340],
]

export const AREAS: readonly Area[] = [
  {
    id: 'now',
    route: '/now',
    label: 'Right now',
    hint: 'Time and weather where you are',
    hotspot: [[98, 268], [188, 264], [190, 346], [106, 352]],
    outline: [[[103, 277], [182, 273], [184, 338], [112, 344]]],
    anchor: [184, 290],
    wide: { box: [103, 273, 184, 344], dolly: 0.5, fill: 0.94, anchor: [0, 0] },
    narrow: { box: [125, 284, 176, 338], dolly: 0.5, fill: 1, anchor: [0, -0.08] },
    panel: 'screen',
    dof: 0.85,
    tint: [0.55, 0.9, 1.0],
  },
  {
    id: 'projects',
    route: '/projects',
    label: 'Projects',
    hint: 'Things I have built',
    hotspot: [
      [92, 276], [180, 268], [238, 345], [300, 420], [350, 440], [352, 560],
      [300, 600], [200, 575], [105, 530], [95, 400],
    ],
    outline: [[[103, 378], [228, 359], [237, 470], [115, 497]]],
    anchor: [214, 380],
    wide: { box: [118, 366, 225, 487], dolly: 0.5, fill: 0.94, anchor: [0, 0] },
    narrow: { box: [123, 371, 221, 484], dolly: 0.5, fill: 1, anchor: [0, -0.08] },
    panel: 'screen',
    dof: 0.85,
    tint: [0.55, 0.9, 1.0],
  },
  {
    id: 'about',
    route: '/about',
    label: 'About me',
    hint: 'The human behind the code',
    hotspot: [
      [12, 700], [60, 672], [150, 665], [240, 760], [345, 800], [410, 830], [432, 880],
      [410, 960], [360, 1020], [240, 1045], [120, 985], [30, 905], [8, 800],
    ],
    outline: [[
      [20, 720], [45, 690], [100, 670], [145, 671], [167, 690], [200, 722], [227, 735], [280, 757],
      [345, 800], [380, 822], [415, 835], [431, 865], [425, 905], [400, 960], [385, 985], [320, 1035],
      [280, 1040], [260, 1022], [200, 988], [140, 958], [75, 918], [50, 860], [25, 770], [15, 735],
    ]],
    anchor: [300, 790],
    wide: { box: [10, 662, 436, 1046], dolly: 0.28, fill: 0.88, anchor: [-0.48, 0.02] },
    narrow: { box: [10, 662, 436, 1046], dolly: 0.28, fill: 0.95, anchor: [0, -0.55] },
    panel: 'right',
    dof: 0.6,
    tint: [1.0, 0.72, 0.55],
  },
  {
    id: 'hobbies',
    route: '/hobbies',
    label: 'Spare time',
    hint: 'Music, games, the rest',
    hotspot: [
      [700, 588], [1060, 590], [1180, 565], [1215, 578], [1250, 640], [1245, 720], [1105, 742],
      [1098, 830], [1000, 832], [800, 815], [640, 792], [595, 760], [620, 700], [660, 645],
    ],
    outline: [[
      [682, 590], [760, 596], [830, 610], [920, 610], [985, 610], [1070, 612], [1090, 604], [1140, 582],
      [1172, 562], [1192, 565], [1203, 590], [1222, 625], [1246, 660], [1250, 690], [1226, 715],
      [1180, 737], [1108, 738], [1106, 800], [1110, 840], [1070, 840], [950, 830], [820, 810],
      [690, 790], [588, 758], [615, 695], [650, 640],
    ]],
    anchor: [930, 640],
    wide: { box: [595, 560, 1252, 835], dolly: 0.3, fill: 0.72, anchor: [0.3, 0.22], lift: [0, 0.12, 0] },
    narrow: { box: [595, 560, 1252, 835], dolly: 0.3, fill: 0.98, anchor: [0, -0.5], lift: [0, 0.12, 0] },
    panel: 'left',
    dof: 0.55,
    tint: [1.0, 0.6, 0.5],
  },
  {
    id: 'music',
    route: '/music',
    label: 'Tape deck',
    hint: 'Pick a cassette, press play',
    // The painted player with the stack of cassettes on its lid.
    hotspot: [[1286, 518], [1292, 505], [1314, 496], [1354, 498], [1368, 510], [1382, 530], [1386, 578], [1308, 576], [1310, 540]],
    outline: [[[1291, 516], [1295, 510], [1316, 511], [1316, 501], [1352, 504], [1362, 511], [1362, 529], [1376, 532], [1378, 538], [1381, 574], [1312, 571], [1315, 536]]],
    anchor: [1300, 512],
    wide: { box: [1286, 492, 1390, 580], dolly: 0.35, fill: 0.86, anchor: [0, 0] },
    narrow: { box: [1286, 492, 1390, 580], dolly: 0.35, fill: 0.98, anchor: [0, -0.2] },
    panel: 'screen',
    dof: 0.5,
    tint: [1.0, 0.8, 0.5],
  },
  {
    id: 'contact',
    route: '/contact',
    label: 'Contact',
    hint: 'Out there, somewhere',
    hotspot: [
      [332, 100], [420, 68], [590, 62], [1385, 8], [1383, 240], [1290, 300], [1235, 380],
      [1195, 505], [1090, 545], [1060, 585], [700, 545], [545, 520], [440, 470], [385, 420], [345, 300],
    ],
    outline: [[
      [324, 114], [381, 107], [417, 66], [1390, 21], [1382, 135], [1378, 200], [1345, 250], [1340, 268],
      [1322, 272], [1320, 300], [1305, 310], [1302, 350], [1287, 362], [1280, 380], [1240, 380],
      [1232, 420], [1205, 422], [1195, 470], [1131, 500], [1088, 528], [1062, 560], [1060, 585],
      [989, 571], [881, 564], [810, 557], [700, 550], [650, 545], [600, 540], [560, 522], [546, 495],
      [503, 486], [456, 450], [396, 468], [381, 443], [376, 405], [353, 343], [324, 243],
    ]],
    anchor: [760, 300],
    wide: { box: [420, 90, 1300, 520], dolly: 0.22, fill: 0.98, anchor: [0, 0] },
    narrow: { box: [560, 120, 1060, 520], dolly: 0.22, fill: 0.98, anchor: [0, 0] },
    panel: 'over',
    dof: 0.9,
    tint: [0.6, 0.85, 1.0],
  },
  {
    id: 'experiments',
    route: '/experiments',
    label: 'Experiments',
    hint: 'Odd ideas, honest results',
    hotspot: [
      [515, 545], [560, 528], [640, 535], [700, 540], [700, 588], [660, 645], [560, 652], [510, 615],
    ],
    outline: [[
      [532, 522], [552, 520], [553, 537], [600, 534], [615, 542], [655, 545], [690, 552], [700, 575],
      [686, 590], [675, 610], [655, 618], [620, 618], [580, 621], [537, 618], [500, 608], [517, 587],
      [538, 575], [530, 550],
    ]],
    anchor: [600, 560],
    wide: { box: [505, 525, 705, 655], dolly: 0.25, fill: 0.4, anchor: [-0.42, 0.08] },
    narrow: { box: [505, 525, 705, 655], dolly: 0.25, fill: 0.9, anchor: [0, -0.5] },
    panel: 'right',
    dof: 0.7,
    tint: [0.7, 0.75, 1.0],
  },
]

/** Hit-testing order: small things first, the window last since it surrounds the lamp. */
export const HIT_ORDER: readonly AreaId[] = ['now', 'projects', 'about', 'experiments', 'hobbies', 'music', 'contact']

export function areaById(id: AreaId): Area {
  const area = AREAS.find((a) => a.id === id)
  if (!area) throw new Error(`Unknown area ${id}`)
  return area
}

/** Easter-egg objects: clickable, but not sections. */
export const LAMP: Polygon = [[842, 22], [905, 5], [940, 40], [925, 95], [880, 102], [848, 80]]
export const LAMP_ANCHOR: Vec2 = [884, 62]
export const TABLET: Polygon = [[1118, 770], [1182, 766], [1194, 802], [1128, 810]]
export const TABLET_ANCHOR: Vec2 = [1155, 785]
export const LAMP_OUTLINE: readonly Polygon[] = [[
  [868, 30], [887, 10], [910, 18], [913, 33], [920, 50], [921, 67], [915, 83], [900, 98], [887, 102],
  [873, 97], [858, 85], [850, 68], [853, 47],
]]
export const TABLET_OUTLINE: readonly Polygon[] = [[[1156, 776], [1184, 793], [1152, 811], [1122, 794]]]

/** Screens that get a gentle glow pulse. */
export const SCREENS: readonly Polygon[] = [
  MONITOR_SCREEN,
  TOP_SCREEN,
  TABLET,
]
