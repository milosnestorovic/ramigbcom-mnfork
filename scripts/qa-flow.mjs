// Interaction QA: click objects, Escape, browser Back, deep links, rapid clicking.
//   node scripts/qa-flow.mjs
import { chromium } from 'playwright'

const base = process.env.QA_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const path = () => new URL(page.url()).pathname
const check = (label, ok) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)

// Image pixel -> screen point at the overview (1440x900 crops vertically).
const at = (px, py) => {
  const scale = 1440 / 1448
  const visibleH = 900 / scale
  const top = (1086 - visibleH) * 0.15
  return [px * scale, (py - top) * scale]
}

await page.goto(base + '/', { waitUntil: 'networkidle' })
await page.waitForSelector('.chrome[data-ready="true"]')
await page.waitForTimeout(1500)

await page.mouse.move(...at(170, 425))
await page.waitForTimeout(500)
check('hovering the monitor shows its label', (await page.locator('.hover-label').textContent())?.includes('Projects'))

await page.mouse.click(...at(170, 425))
await page.waitForTimeout(1800)
check('clicking the monitor goes to /projects', path() === '/projects')
check('terminal input has focus', await page.evaluate(() => document.activeElement?.id === 'crt-input'))

await page.keyboard.type('open outpost')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
check('typing "open outpost" shows the project', (await page.locator('.t-project h3').last().textContent()) === 'Outpost')

await page.keyboard.press('Escape')
await page.waitForTimeout(1600)
check('Escape returns to the room', path() === '/')

await page.mouse.click(...at(900, 700))
await page.waitForTimeout(1600)
check('clicking the bed goes to /hobbies', path() === '/hobbies')
await page.goBack()
await page.waitForTimeout(1600)
check('browser Back returns to the room', path() === '/' && !(await page.locator('.panel').count()))
await page.goForward()
await page.waitForTimeout(1600)
check('browser Forward reopens hobbies', path() === '/hobbies' && (await page.locator('.panel').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(1600)

// Rapid clicking mid-transition must not corrupt state.
await page.mouse.click(...at(200, 850))
await page.waitForTimeout(150)
await page.keyboard.press('Escape')
await page.waitForTimeout(100)
await page.mouse.click(...at(800, 300))
await page.waitForTimeout(1800)
check('rapid open/close/open settles on /contact', path() === '/contact' && (await page.locator('.skyline').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(1600)

// Keyboard: tab to the first place, Enter.
await page.keyboard.press('Tab')
await page.keyboard.press('Tab')
const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-area'))
check(`Tab reaches a room object (${focused})`, Boolean(focused))
await page.keyboard.press('Enter')
await page.waitForTimeout(1600)
check('Enter opens it', path() !== '/')
await page.keyboard.press('Escape')
await page.waitForTimeout(1600)

// Lamp easter egg.
await page.mouse.click(...at(884, 62))
await page.waitForTimeout(400)
check('clicking the lamp shows its toast', (await page.locator('.toast').count()) === 1)

// Deep link + Escape.
await page.goto(base + '/music', { waitUntil: 'networkidle' })
await page.waitForSelector('.chrome[data-ready="true"]')
await page.waitForTimeout(1200)
check('deep link /music opens the tape deck', (await page.locator('#music-title').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(1600)
check('Escape from a deep link goes to /', path() === '/')

// GitHub Pages redirect.
await page.goto(base + '/?p=%2Fabout', { waitUntil: 'networkidle' })
await page.waitForSelector('.chrome[data-ready="true"]')
await page.waitForTimeout(1200)
check('?p=/about restores /about', path() === '/about' && (await page.locator('.panel').count()) === 1)

check(`no page errors (${errors.join('; ')})`, errors.length === 0)
await browser.close()
