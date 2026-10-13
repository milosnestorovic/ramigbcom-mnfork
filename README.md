# ramigb.com: the room

My personal site, as a single interactive room. The brief is in [`docs/spec.md`](docs/spec.md).

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # typecheck + production build into dist/
pnpm test         # unit tests (camera math, picking, routes, terminal)
pnpm lint
pnpm qa           # screenshots of every route x viewport into qa-screens/ (needs pnpm dev running)
node scripts/qa-flow.mjs   # click-through checks: hover, click, Esc, Back/Forward, keyboard, deep links
```

## Where things live

| Change this…                         | …here                                         |
| ------------------------------------ | --------------------------------------------- |
| Bio, projects, skills, hobbies, links | `src/content/*.ts`                            |
| Which object opens what, camera framing, hotspot outlines | `src/areas.ts` (image-pixel coordinates) |
| Terminal commands                    | `src/ui/sections/terminal/commands.ts`        |
| Section layouts                      | `src/ui/sections/`                            |
| Look of the UI                       | `src/styles/room.css`                         |
| Rendering, shaders, camera           | `src/scene/` (plain TypeScript + three, no React) |

## How the 3D works

There is one picture. `scripts/make_depth.py` estimates its depth with Depth Anything V2,
and the room image is draped over a mesh whose vertices are pushed along the
overview camera's rays to that depth. From the overview spot the mesh projects exactly to
the original picture; move the camera and real perspective appears. The camera
never rotates. Views are off-axis windows (`src/scene/view.ts`), which keeps framing
exact and makes mouse parallax a simple sideways shift.

Regenerating the scene assets (source art in `docs/` is never modified):

```sh
python3 -I scripts/make_depth.py docs/room-background.png scripts/out/depth-raw.png   # needs torch + transformers, GPU recommended
python3 -I scripts/make_assets.py docs/room-background.png scripts/out/depth-raw.png public/scene
```

If you replace the room image, redo the hotspot outlines and `MONITOR_SCREEN` in
`src/areas.ts` too.

## Music

Drop MP3s into `public/audio/` and list them in `public/audio/tracks.json`:

```json
[{ "title": "Night shift", "src": "night-shift.mp3", "genre": "Lo-fi" }]
```

Each genre becomes one cassette case in the stack on the painted player (right-hand
shelves). Nothing replaces the artwork: `src/scene/deckArt.ts` draws the stack and an old
cassette deck's face (door, keys, VU meters, readout, counter) onto that patch of the picture, and `public/scene/player.webp` is a
sharper copy of the patch for the close-up. Click the player to come close, click a spine
to load it. The Music button in the corner goes there too. It never autoplays.
The rain/hum ambience is generated in the browser and is also opt-in.

## Deploy

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on
push to `main`. `public/CNAME` is `ramigb.com`. GitHub Pages has no SPA rewrites,
so `public/404.html` bounces deep links like `/projects` to `/?p=/projects` and
the app restores the real path. The old `/pages/cv.html` and the CV PDF are
carried over unchanged.
