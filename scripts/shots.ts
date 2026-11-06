// Снимки экранов для отчёта PR (Ш-202 Штаба, #182): npm run shots.
// Собирает сайт (vite build), поднимает vite preview (порт 4173) и ведёт Chrome без окна по экранам:
// «Настройки» → демо-игры, «Игры», «Играть», «Против ботов» (мой ход, панель хода), «Казино» (столы идут),
// «Справка». Сервер комнат не нужен — всё без сети. Демо-игры — выдуманные (src/calc/demo.ts).
// Chrome — по DevTools-протоколу (обычный --screenshot не умеет нажимать кнопки), без сторонних библиотек.
// Размеры: 390 × 844 (телефон), 1366 × 768 (ноутбук), 1920 × 1080 (монитор); у каждого — своё хранилище.
// PNG — в shots/ (не в репо), имя — «ширина-номер-экран.png». Сбой — код выхода 1 и строка, какой экран.
// Chrome — google-chrome, google-chrome-stable или chromium; свой путь — переменная CHROME
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, preview } from 'vite'

const OUT = 'shots'
const PORT = 4173
const SITE = `http://localhost:${PORT}/Magic_Fishki/`
type Size = { name: string; width: number; height: number }
const SIZES: Size[] = [
  { name: '390', width: 390, height: 844 },
  { name: '1366', width: 1366, height: 768 },
  { name: '1920', width: 1920, height: 1080 },
]
const TIMEOUT = 20_000
const BOTS_TIMEOUT = 60_000 // боты ходят через секунду; моя очередь может прийти не в первой раздаче

// ─── DevTools-протокол ───────────────────────────────────────────────────────

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

class Cdp {
  private next = 0
  private pending = new Map<number, Pending>()
  private ws: WebSocket

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } }
      if (message.id === undefined) return
      const p = this.pending.get(message.id)
      if (!p) return
      this.pending.delete(message.id)
      if (message.error) p.reject(new Error(message.error.message))
      else p.resolve(message.result)
    })
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => resolve(new Cdp(ws)))
      ws.addEventListener('error', () => reject(new Error('Нет связи с Chrome: ' + url)))
    })
  }

  send<T = Record<string, unknown>>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.next
    this.ws.send(JSON.stringify({ id, method, params, sessionId }))
    return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: (v) => resolve(v as T), reject }))
  }

  close(): void {
    this.ws.close()
  }
}

// Найти Chrome и поднять без окна; адрес DevTools — из его вывода
async function launchChrome(profile: string): Promise<{ process: ChildProcess; url: string }> {
  const candidates = process.env.CHROME ? [process.env.CHROME] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  for (const binary of candidates) {
    const chrome = spawn(
      binary,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--no-first-run',
        '--lang=ru-RU',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    const url = await new Promise<string | null>((resolve) => {
      let log = ''
      chrome.on('error', () => resolve(null))
      chrome.on('exit', () => resolve(null))
      chrome.stderr?.on('data', (chunk: Buffer) => {
        log += chunk.toString()
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(log)
        if (match) resolve(match[1])
      })
      setTimeout(() => resolve(null), 15_000)
    })
    if (url) return { process: chrome, url }
    chrome.kill('SIGKILL')
  }
  throw new Error(`нет Chrome: не запустился ни один из ${candidates.join(', ')} (свой путь — переменная CHROME)`)
}

// ─── Устройство: своё хранилище, своя страница ───────────────────────────────

class Device {
  private cdp: Cdp
  private session: string
  readonly size: Size

  private constructor(cdp: Cdp, session: string, size: Size) {
    this.cdp = cdp
    this.session = session
    this.size = size
  }

  static async open(cdp: Cdp, size: Size): Promise<Device> {
    const { browserContextId } = await cdp.send<{ browserContextId: string }>('Target.createBrowserContext')
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', browserContextId })
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Page.enable', {}, sessionId)
    const device = new Device(cdp, sessionId, size)
    await device.metrics(size.height)
    return device
  }

  async goto(hash: string): Promise<void> {
    await this.cdp.send('Page.navigate', { url: SITE + hash }, this.session)
  }

  async eval<T>(expression: string): Promise<T> {
    const r = await this.cdp.send<{ result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      this.session,
    )
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }

  // Ждать, пока на экране появится текст
  async waitText(text: string, timeout = TIMEOUT): Promise<void> {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const found = await this.eval<boolean>(`!!document.body && document.body.innerText.includes(${JSON.stringify(text)})`).catch(() => false)
      if (found) return
      await sleep(200)
    }
    const screen = await this.eval<string>('document.body ? document.body.innerText : ""').catch(() => '')
    throw new Error(`не дождался «${text}». На экране:\n${screen.slice(0, 1500)}`)
  }

  // Ждать, пока на экране появится элемент selector
  async waitFor(selector: string, timeout = TIMEOUT): Promise<void> {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      const found = await this.eval<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false)
      if (found) return
      await sleep(200)
    }
    throw new Error(`не дождался ${selector} на экране`)
  }

  // Нажать видимую кнопку или ссылку по тексту: сначала точное совпадение, потом начало
  async click(text: string): Promise<void> {
    const done = await this.eval<boolean>(`(() => {
      const text = ${JSON.stringify(text)}
      const all = [...document.querySelectorAll('button, a, label')].filter((el) => el.offsetParent !== null && !el.disabled)
      const el = all.find((e) => e.innerText.trim() === text) || all.find((e) => e.innerText.trim().startsWith(text))
      if (!el) return false
      el.click()
      return true
    })()`)
    if (!done) throw new Error(`нет кнопки «${text}»`)
  }

  private metrics(height: number): Promise<unknown> {
    const { width } = this.size
    return this.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, this.session)
  }

  // Снимок. whole — страница целиком: длинная вытягивается на время снимка во всю высоту.
  // Стол (боты) — только первый экран: он и так на весь экран, панель хода — внизу
  async shot(file: string, whole = true): Promise<void> {
    await sleep(400) // перерисовка и шрифты
    const height = whole ? await this.eval<number>('Math.max(document.documentElement.scrollHeight, innerHeight)') : this.size.height
    if (height > this.size.height) {
      await this.metrics(height)
      await sleep(300)
    }
    const { data } = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, this.session)
    if (height > this.size.height) await this.metrics(this.size.height)
    const path = join(OUT, `${this.size.name}-${file}.png`)
    await writeFile(path, Buffer.from(data, 'base64'))
    console.log('  снимок', path)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Шаг сценария: сбой — с названием экрана и размером
async function screen(name: string, size: Size, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    throw new Error(`Экран «${name}», ${size.width} × ${size.height}: ${why}`)
  }
}

// ─── Сценарий ────────────────────────────────────────────────────────────────

async function scenario(cdp: Cdp, size: Size): Promise<void> {
  console.log(`Размер ${size.width} × ${size.height}`)
  const d = await Device.open(cdp, size)

  await screen('Настройки', size, async () => {
    await d.goto('#/settings')
    await d.waitText('Добавить демо-данные')
    await d.shot('05-nastroyki')
    // Демо-игры (Р-04) — для «Игр» и казино
    await d.click('Добавить демо-данные')
    await d.waitText('Добавлено демо-игр')
  })

  await screen('Игры', size, async () => {
    await d.goto('#/')
    await d.waitText('Демо: игра идёт')
    await d.waitText('Демо: пятница')
    await d.shot('01-igry')
  })

  await screen('Играть', size, async () => {
    await d.goto('#/poker')
    await d.waitText('Войти по ссылке')
    await d.waitText('Против ботов')
    await d.shot('02-igrat')
  })

  await screen('Против ботов', size, async () => {
    await d.click('Против ботов')
    await d.waitText('Карты ботов открыты')
    await d.click('Начать')
    await d.waitText('Стол с ботами')
    await myTurn(d)
    await d.shot('03-protiv-botov', false)
  })

  await screen('Казино', size, async () => {
    await d.goto('#/poker')
    await d.waitText('Войти по ссылке')
    await d.click('Казино')
    await d.waitText('Новая игра — только казино')
    await d.click('Демо: игра идёт')
    await d.waitText('карты раздаёт программа, всё в открытую')
    await d.click('Раздать')
    await boardsGoing(d)
    await d.shot('04-kazino')
  })

  await screen('Справка', size, async () => {
    await d.goto('#/help')
    await d.waitFor('details.card.help')
    await d.shot('06-spravka')
  })
}

// Против ботов: ждать моей очереди — панель хода внизу. Между раздачами — «Начать раздачу»,
// если следующая не началась сама; очередь пришла — ещё раз проверить после анимации раздачи
async function myTurn(d: Device): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < BOTS_TIMEOUT) {
    const state = await d.eval<string>(`(() => {
      if (document.querySelector('.dock.actions')) return 'turn'
      const start = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Начать раздачу' && !b.disabled)
      if (start) {
        start.click()
        return 'dealt'
      }
      return 'wait'
    })()`)
    if (state === 'turn') {
      await sleep(1200)
      if (await d.eval<boolean>(`!!document.querySelector('.dock.actions')`)) return
    }
    await sleep(200)
  }
  throw new Error(`за ${BOTS_TIMEOUT / 1000} с не дошла очередь хода — панели хода нет`)
}

// Казино: после раздачи — открыть первый стол (кнопкой или «Открыть сейчас», если столы открываются сами)
// и дождаться, пока он откроется целиком; остальные — ещё рубашкой
async function boardsGoing(d: Device): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < TIMEOUT) {
    const opened = await d.eval<number>(`(() => {
      const n = document.querySelectorAll('.casino-board.open').length
      if (n > 0) return n
      const buttons = [...document.querySelectorAll('.casino-dock button')].filter((b) => !b.disabled)
      const open = buttons.find((b) => b.innerText.trim() === 'Открыть стол 1') || buttons.find((b) => b.innerText.trim() === 'Открыть сейчас')
      if (open) open.click()
      return 0
    })()`)
    if (opened > 0) {
      await sleep(600)
      return
    }
    await sleep(300)
  }
  throw new Error('после «Раздать» не открылся ни один стол')
}

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  console.log('Сборка сайта…')
  await build({ logLevel: 'warn' })

  const site = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' })
  const profile = await mkdtemp(join(tmpdir(), 'fishki-shots-'))
  let chrome: ChildProcess | null = null
  let cdp: Cdp | null = null
  try {
    const launched = await launchChrome(profile)
    chrome = launched.process
    cdp = await Cdp.connect(launched.url)
    for (const size of SIZES) await scenario(cdp, size)
    console.log('Готово: снимки в', OUT)
  } finally {
    if (cdp) {
      await cdp.send('Browser.close').catch(() => undefined)
      cdp.close()
    }
    chrome?.kill('SIGKILL')
    await site.close()
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
