// Visual QA: screenshots of every route at the spec's viewport sizes.
//
//   pnpm qa                       all routes, all sizes
//   pnpm qa /projects 1920x1080   filter by route and/or size
//
// Needs the dev server (pnpm dev) or a preview server; set QA_URL to override.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.env.QA_URL ?? 'http://127.0.0.1:5173'
const out = 'qa-screens'
const ALL_SIZES = ['1920x1080', '1440x900', '1366x768', '1024x768', '390x844', '375x667']
const ALL_ROUTES = ['/', '/now', '/projects', '/about', '/hobbies', '/music', '/contact', '/experiments']

const args = process.argv.slice(2)
const routes = args.filter((a) => a.startsWith('/'))
const sizes = args.filter((a) => /^\d+x\d+$/.test(a))
const hover = args.includes('--hover')

mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})

for (const size of sizes.length ? sizes : ALL_SIZES) {
  const [width, height] = size.split('x').map(Number)
  const mobile = width < 700
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
  })
  const page = await context.newPage()
  page.on('console', (m) => m.type() === 'error' && console.log(`[${size}] console:`, m.text()))
  page.on('pageerror', (e) => console.log(`[${size}] pageerror:`, e.message))
  for (const route of routes.length ? routes : ALL_ROUTES) {
    await page.goto(base + route, { waitUntil: 'networkidle' })
    await page.waitForSelector('.chrome[data-ready="true"]', { timeout: 20000 })
    await page.waitForTimeout(3600)
    const name = `${size}${route === '/' ? '-room' : route.replace(/\//g, '-')}`
    await page.screenshot({ path: `${out}/${name}.png` })
    console.log('saved', name)
    if (hover && route === '/' && !mobile) {
      for (const [label, x, y] of [
        ['projects', 0.12, 0.42],
        ['hobbies', 0.62, 0.66],
      ]) {
        await page.mouse.move(width * x, height * y)
        await page.waitForTimeout(700)
        await page.screenshot({ path: `${out}/${size}-hover-${label}.png` })
        console.log('saved hover', label)
      }
    }
  }
  await context.close()
}
await browser.close()
