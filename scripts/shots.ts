// Снимки экранов для отчёта PR (Ш-202 Штаба, #182): npm run shots.
// Собирает сайт (vite build), поднимает vite preview (порт 4173) и ведёт Chrome без окна по экранам:
// «Настройки» → демо-игры, «Игры», «Игроки», «Вид стола» в «Настройках», «Играть», «Тренажёр» (#213; с «Чартами» —
// #214; только он — npm run shots -- trainer), «Стол на этом телефоне»
// (10 гостей, панель хода), «Против ботов» (мой ход, панель хода; после паса — «История раздач» за столом
// и в «Прошлых вечерах», #239; только она — npm run shots -- history), «Казино» (столы идут; на телефоне — ещё
// на шестерых), «Справка».
// Сервер комнат не нужен — всё без сети; комнаты на снимках нет. Демо-игры и гости — выдуманные (src/calc/demo.ts).
// Chrome — по DevTools-протоколу (обычный --screenshot не умеет нажимать кнопки), без сторонних библиотек.
// Размеры: 390 × 844 (телефон), 1366 × 768 (ноутбук), 1920 × 1080 (монитор); у каждого — своё хранилище.
// PNG — в shots/ (не в репо), имя — «ширина-номер-экран.png». Сбой — код выхода 1 и строка, какой экран.
// Гамма (Р-70): весь сценарий — в «Ночи», а затем «Клуб» и «День» — «Настройки», «Игры», «Играть», стол против ботов
// и «Играть» с полосой «Продолжить» (#209) («ширина-гамма-номер-экран.png»). SHOTS_THEME=club или day — весь сценарий в этой гамме (имена прежние), без остальных;
// «Места и панель» — тоже в ней (#211).
// Гамма выбирается касанием в «Настройках», как у человека.
// Шрифты (#218): снимок — после document.fonts.ready; на первом экране каждого размера оба шрифта должны быть загружены.
// Кнопки выбора (#238): в формах «Новая комната» (снимок 03g) и «Против ботов» и в «Виде стола» — каждая надпись
// внутри своей кнопки, кнопки ряда одной высоты, от 44 px; на телефоне — ещё на 320, 360 и 768 px, иначе сбой.
// npm run shots -- vybor — только эти три экрана на 390 и 1366.
// Запас времени (#223): «Новая комната» (03g) — со временем на ход и запасом; npm run shots -- zapas — только
// «Быстрая комната» в «Настройках» с запасом (05b), «Играть» и «Новая комната» на 390 и 1366.
// Стол на широком окне (#210): на каждом снимке стола на 1366 и 1920 — проверка, что ни одно место (.seat) не под
// панелью хода (.table-dock), иначе сбой; ещё — свой шаг «Места и панель» (2, 6 и 10 мест, «Крупная» при 100 и 70 %).
// npm run shots -- table — только этот шаг.
// Учёт вечера (#211): открытая «Демо: игра идёт» после записи выхода, закрытая «Демо: пятница» с итогом, второе
// касание «Удалить игру» (без удаления), карточка постоянного игрока с открытой заметкой (своё хранилище: постоянный
// и закрытая игра с ним — только там). npm run shots -- uchet — сценарий без столов покера: учёт, «Игроки»,
// «Настройки», казино, справка.
// Контраст (#211): после каждого снимка — замер на странице: текст к своему фону (не ниже 4,5 : 1, крупный —
// 3 : 1) и края кнопок и полей к тому, что под ними (3 : 1); что ниже — строкой «контраст …», по разу на гамму.
// Сбоем не считается: это подсказка для глаз, снимок — главное.
// «⚙ Стол» за столом с ботами (#243): открытая карточка посреди раздачи, на 390 и 1366, в «Ночи» и «Дне» (снимки 13a, 13b);
// npm run shots -- gear — только он.
// Имена у мест казино (#254): четыре гостя с именами 8–12 букв, холдем и омаха, на 360 и 390 px (снимки 04f, 04g),
// имя с многоточием — сбой; npm run shots -- imena — только они.
// Своя рубашка (#220): картинка в поле выбора файла через DevTools — «Вид стола» со «Своей» (08d) и казино до «Раздать»
// (04f-kazino-svoya-rubashka), потом «Удалить свою рубашку»; npm run shots -- rubashka — только она.
// Разделы «Настроек» сворачиваются (#234): «Настройки» — снимок по умолчанию (05) и с одним развёрнутым «Учётом игр»
// (05a); шаги, которым нужны карточки свёрнутого раздела, разворачивают его касанием заголовка (openSettings).
// Страддл (#222): стол на этом телефоне на 4 гостей — форма с галочкой (09c) и первая раздача со страддлом (09d);
// npm run shots -- straddl — только он.
// Chrome — google-chrome, google-chrome-stable или chromium; свой путь — переменная CHROME
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, preview } from 'vite'
import { chipIcon } from './icons.ts'

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
const GUESTS = ['Аня', 'Боря', 'Вика', 'Гоша', 'Даша', 'Егор', 'Женя', 'Зоя', 'Илья', 'Катя'] // выдуманные гости стола
const BOTS_TIMEOUT = 60_000 // боты ходят через секунду; моя очередь может прийти не в первой раздаче
type Theme = 'night' | 'club' | 'day'
const THEME_BUTTONS: Record<Theme, string> = { night: 'Ночь', club: 'Клуб', day: 'День' } // кнопки «Оформления»
const FONTS = ['Golos Text', 'Geologica'] // шрифты приложения (src/fonts, #218): текст и заголовки
let runTheme: Theme = 'night' // гамма всего сценария (SHOTS_THEME)
let ownBackPicture = '' // файл картинки для своей рубашки (#220): пишет main во временную папку
const reported = new Set<string>() // замеры контраста, уже выведенные: гамма, что, цвета

// ─── Замер контраста (#211) ──────────────────────────────────────────────────

// Пара ниже нормы: что (текст, выключено, край), образец, где, цвет и фон, контраст и норма
type Low = { kind: string; text: string; where: string; fg: string; bg: string; ratio: number; need: number }

// Выполняется в странице (через toString — без ссылок наружу). Фон — всё, что под точкой (elementsFromPoint),
// снизу вверх: заливки с прозрачностью и opacity предков; градиент (сукно) — каждый его цвет, берётся худший.
// Фон картинкой — не замеряется. Крупный текст — от 1,2 rem жирным (от 600) или от 24 px
function contrastProbe(): Low[] {
  type Rgba = [number, number, number, number]
  type Rgb = [number, number, number]
  const COLOR = /rgba?\(([^)]*)\)/g
  const parse = (s: string): Rgba | null => {
    const m = /rgba?\(([^)]*)\)/.exec(s)
    if (!m) return null
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
  }
  const over = (top: Rgba, below: Rgb, alpha = 1): Rgb => {
    const a = top[3] * alpha
    return [top[0] * a + below[0] * (1 - a), top[1] * a + below[1] * (1 - a), top[2] * a + below[2] * (1 - a)]
  }
  const lum = (c: Rgb): number => {
    const f = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const contrast = (a: Rgb, b: Rgb): number => {
    const x = lum(a)
    const y = lum(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  const hex = (c: Rgb): string => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const opacityOf = (el: Element): number => {
    let o = 1
    for (let x: Element | null = el; x; x = x.parentElement) o *= parseFloat(getComputedStyle(x).opacity)
    return o
  }
  const where = (el: Element): string => {
    const name = (x: Element) => x.tagName.toLowerCase() + [...x.classList].map((c) => '.' + c).join('')
    const parent = el.parentElement?.closest('[class]')
    return el.classList.length > 0 || !parent ? name(el) : `${name(el)} в ${name(parent)}`
  }
  // Цвета под точкой x, y — снизу вверх до el (self — и его заливка); null — фон картинкой или el не под точкой
  const backdrops = (el: Element, x: number, y: number, self: boolean): Rgb[] | null => {
    const stack = document.elementsFromPoint(x, y)
    const i = stack.findIndex((s) => s === el || s.contains(el))
    if (i < 0) return null
    const layers = stack.slice(i).reverse()
    // Сквозь касания (pointer-events: none — подсказка поверх стола) под точкой нет: el и его предки до найденного
    const missed: Element[] = []
    for (let x: Element | null = el; x && x !== stack[i]; x = x.parentElement) missed.unshift(x)
    layers.push(...missed)
    if (!self && layers[layers.length - 1] === el) layers.pop()
    let all: Rgb[] = [[255, 255, 255]]
    for (const layer of layers) {
      const cs = getComputedStyle(layer)
      const o = opacityOf(layer)
      const fill = parse(cs.backgroundColor)
      if (fill && fill[3] > 0) all = all.map((c) => over(fill, c, o))
      const image = cs.backgroundImage
      if (image && image !== 'none') {
        if (image.includes('url(')) return null
        const stops = [...image.matchAll(COLOR)].map((m) => parse(m[0])).filter((s): s is Rgba => s !== null)
        if (stops.length > 0) all = all.flatMap((c) => stops.map((s) => over(s, c, o))).slice(0, 48)
      }
    }
    return all
  }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const lows: Low[] = []
  const seen = new Set<string>()
  const add = (low: Low) => {
    const key = `${low.kind}|${low.fg}|${low.bg}|${low.need}`
    if (seen.has(key)) return
    seen.add(key)
    lows.push(low)
  }
  // Текст к своему фону: el — где он, rect — где на экране, color — его цвет
  const text = (el: Element, sample: string, rect: DOMRect) => {
    const cs = getComputedStyle(el)
    if (cs.visibility !== 'visible' || rect.width < 1 || rect.height < 1) return
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return
    const color = parse(cs.color)
    const o = opacityOf(el)
    if (!color || color[3] * o < 0.05) return // не видно: анимация, пустая подсказка
    const under = backdrops(el, x, y, true)
    if (!under) return
    const size = parseFloat(cs.fontSize)
    const need = (size >= 1.2 * rem && parseInt(cs.fontWeight, 10) >= 600) || size >= 24 ? 3 : 4.5
    let worst = Infinity
    let fg: Rgb = [0, 0, 0]
    let bg: Rgb = [0, 0, 0]
    for (const b of under) {
      const f = over(color, b, o)
      const k = contrast(f, b)
      if (k < worst) [worst, fg, bg] = [k, f, b]
    }
    if (worst >= need) return
    const off = el.closest(':disabled') !== null
    add({ kind: off ? 'выключено' : 'текст', text: sample.slice(0, 40), where: where(el), fg: hex(fg), bg: hex(bg), ratio: worst, need })
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const sample = (n.textContent ?? '').trim()
    const el = n.parentElement
    if (!sample || !el || el.closest('script, style, option')) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const rect = range.getClientRects()[0]
    if (rect) text(el, sample, rect)
  }
  // Значения полей и выбранное в select
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea',
  )) {
    const value = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.text ?? '') : el.value
    if (value.trim()) text(el, value.trim(), el.getBoundingClientRect())
  }
  // Края: кнопки и поля с рамкой, рамка победителя казино и стола — рамка или заливка к тому, что под ними, от 3 : 1
  for (const el of document.querySelectorAll('button, input, select, textarea, .casino-seat.winner, .casino-board.last, .seat.winner')) {
    const cs = getComputedStyle(el)
    if (parseFloat(cs.borderTopWidth) < 1 || cs.borderTopStyle === 'none' || el.matches(':disabled')) continue
    if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'range'].includes(el.type)) continue
    const line = parse(cs.borderTopColor)
    if (!line || line[3] === 0) continue
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    if (r.width < 1 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue
    const under = backdrops(el, x, y, false)
    if (!under) continue
    const o = opacityOf(el)
    const fill = parse(cs.backgroundColor) ?? [0, 0, 0, 0]
    let worst = Infinity
    let fg: Rgb = [0, 0, 0]
    let bg: Rgb = [0, 0, 0]
    for (const b of under) {
      const edge = over(line, b, o)
      const k = Math.max(contrast(edge, b), contrast(over(fill, b, o), b))
      if (k < worst) [worst, fg, bg] = [k, edge, b]
    }
    if (worst >= 3) continue
    const sample = (el instanceof HTMLElement ? el.innerText : '').trim().split('\n')[0] || el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''
    add({ kind: 'край', text: sample.slice(0, 40), where: where(el), fg: hex(fg), bg: hex(bg), ratio: worst, need: 3 })
  }
  return lows
}

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
  private prefix: string // перед именем снимка: «club-» у снимков другой гаммы, иначе пусто
  private theme: string // гамма снимков этого устройства — для строк замера контраста

  private constructor(cdp: Cdp, session: string, size: Size, prefix: string) {
    this.cdp = cdp
    this.session = session
    this.size = size
    this.prefix = prefix
    this.theme = prefix ? prefix.slice(0, -1) : runTheme
  }

  static async open(cdp: Cdp, size: Size, prefix = ''): Promise<Device> {
    const { browserContextId } = await cdp.send<{ browserContextId: string }>('Target.createBrowserContext')
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', browserContextId })
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Page.enable', {}, sessionId)
    const device = new Device(cdp, sessionId, size, prefix)
    await device.metrics(size.height)
    return device
  }

  async goto(hash: string): Promise<void> {
    await this.cdp.send('Page.navigate', { url: SITE + hash }, this.session)
  }

  // Перезагрузить страницу (смена одного хеша её не перезагружает) и дождаться новой
  async reload(): Promise<void> {
    await this.eval('window.__beforeReload = true')
    await this.cdp.send('Page.reload', {}, this.session)
    const started = Date.now()
    while (Date.now() - started < TIMEOUT) {
      const fresh = await this.eval<boolean>("!window.__beforeReload && document.readyState === 'complete'").catch(() => false)
      if (fresh) return
      await sleep(200)
    }
    throw new Error('страница не перезагрузилась')
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

  // Выбрать файл в поле <input type="file"> (#220) — как человек в окне выбора файла: через DevTools
  async setFile(selector: string, path: string): Promise<void> {
    const { root } = await this.cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', {}, this.session)
    const { nodeId } = await this.cdp.send<{ nodeId: number }>('DOM.querySelector', { nodeId: root.nodeId, selector }, this.session)
    if (!nodeId) throw new Error(`нет поля ${selector}`)
    await this.cdp.send('DOM.setFileInputFiles', { files: [path], nodeId }, this.session)
  }

  // Вписать текст в поле: значение — через свойство поля и событие input, иначе React его не заметит
  async type(selector: string, text: string): Promise<void> {
    const done = await this.eval<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    if (!done) throw new Error(`нет поля ${selector}`)
  }

  private metrics(height: number, width = this.size.width): Promise<unknown> {
    return this.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, this.session)
  }

  // Окно другой ширины — на время замера (#238); без числа — снова своя
  async setWidth(width = this.size.width): Promise<void> {
    await this.metrics(this.size.height, width)
    await sleep(300)
  }

  // Снимок. whole — страница целиком: длинная вытягивается на время снимка во всю высоту.
  // Стол (боты) — только первый экран: он и так на весь экран, панель хода — внизу
  async shot(file: string, whole = true): Promise<void> {
    await this.eval('document.fonts.ready.then(() => true)') // шрифты из src/fonts догрузились (#218)
    await sleep(400) // перерисовка
    const height = whole ? await this.eval<number>('Math.max(document.documentElement.scrollHeight, innerHeight)') : this.size.height
    if (height > this.size.height) {
      await this.metrics(height)
      await sleep(300)
    }
    const { data } = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, this.session)
    const lows = await this.eval<Low[]>(`(${contrastProbe.toString()})()`).catch((error: unknown) => {
      console.log('  контраст не замерен:', error instanceof Error ? error.message.split('\n')[0] : error)
      return [] as Low[]
    })
    if (height > this.size.height) await this.metrics(this.size.height)
    const path = join(OUT, `${this.size.name}-${this.prefix}${file}.png`)
    await writeFile(path, Buffer.from(data, 'base64'))
    console.log('  снимок', path)
    for (const low of lows) {
      const key = `${this.theme}|${low.kind}|${low.fg}|${low.bg}|${low.need}`
      if (reported.has(key)) continue
      reported.add(key)
      const ratio = low.ratio.toFixed(2).replace('.', ',')
      console.log(`  контраст ${this.theme}: ${ratio} : 1 (нужно ${String(low.need).replace('.', ',')}) — ${low.kind} «${low.text}», ${low.where}: ${low.fg} на ${low.bg}`)
    }
  }

  // Снимок стола покера — первый экран; на широком окне (#210) сначала — ни одно место не под панелью хода
  // Без лишней паузы: боты ходят раз в секунду, а следующий шаг может ждать их раздачу (#194)
  async tableShot(file: string): Promise<void> {
    await seatsClearOfDock(this)
    await this.shot(file, false)
  }

  // Оба шрифта приложения (#218) загружены: иначе снимки были бы системным шрифтом
  async fontsLoaded(): Promise<void> {
    const loaded = await this.eval<string[]>(
      "document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/[\"']/g, '')))",
    )
    const missing = FONTS.filter((family) => !loaded.includes(family))
    if (missing.length > 0) throw new Error(`не загрузился шрифт ${missing.join(', ')} (загружены: ${loaded.join(', ') || 'ни одного'})`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Стол на широком и не высоком окне (#210): панель хода — поверх правого нижнего угла стола, и ни одно место
// не под ней — прямоугольники каждого .seat и .table-dock не пересекаются, иначе сбой. Заодно — замер: самое
// крупное место в процентах слоя мест (SEAT_W_WIDE, SEAT_H_WIDE в src/calc/pokerLayout.ts)
async function seatsClearOfDock(d: Device): Promise<void> {
  if (d.size.width < 1024 || d.size.width < d.size.height) return
  const r = await d.eval<{ seats: number; hits: string[]; w: number; h: number; dock: string }>(`(() => {
    const dock = document.querySelector('.table-dock').getBoundingClientRect()
    const layer = document.querySelector('.spots').getBoundingClientRect()
    const seats = [...document.querySelectorAll('.seat')]
    const hits = []
    let w = 0
    let h = 0
    for (const el of seats) {
      const s = el.getBoundingClientRect()
      w = Math.max(w, (s.width * 100) / layer.width)
      h = Math.max(h, (s.height * 100) / layer.height)
      const open = dock.width > 0 && dock.height > 0 // панели нет — пустой блок без высоты
      if (open && s.left < dock.right && dock.left < s.right && s.top < dock.bottom && dock.top < s.bottom) {
        hits.push((el.querySelector('.seat-name') || el).textContent.trim())
      }
    }
    const pct = (n) => Math.round(n * 10) / 10
    return {
      seats: seats.length,
      hits,
      w: pct(w),
      h: pct(h),
      dock: Math.round(dock.width) + ' × ' + Math.round(dock.height) + ' px с ' + pct(((dock.left - layer.left) * 100) / layer.width) + ' % по ширине, ' + pct(((dock.top - layer.top) * 100) / layer.height) + ' % по высоте слоя мест',
    }
  })()`)
  if (r.seats === 0) throw new Error('за столом нет мест')
  console.log(`  мест ${r.seats}: самое крупное — ${r.w} × ${r.h} % слоя мест; панель ${r.dock}`)
  if (r.hits.length > 0) throw new Error(`места под панелью хода: ${r.hits.join(', ')}`)
}

// Ряды кнопок выбора (#238): .amounts и строки (.row, .dock-row) с кнопками выбора (aria-pressed). У каждой видимой
// кнопки надпись внутри (scrollWidth <= clientWidth) и не за краем окна, высота — от 44 px, кнопки ряда — одной
// высоты. На телефоне — ещё на 320, 360 и 768 px (окно на время замера), на широком — на своей ширине.
// Иначе сбой — с текстом кнопки и шириной окна
const CHOICE_WIDTHS = [320, 360, 390, 768]

async function choicesFit(d: Device, where: string): Promise<void> {
  const widths = d.size.width < 600 ? CHOICE_WIDTHS : [d.size.width]
  const bad: string[] = []
  let checked = 0
  for (const width of widths) {
    if (width !== d.size.width) await d.setWidth(width)
    const r = await d.eval<{ buttons: number; bad: string[] }>(`(() => {
      const rows = [...document.querySelectorAll('.amounts, .row, .dock-row')].filter(
        (row) => row.classList.contains('amounts') || row.querySelector(':scope > button[aria-pressed]'),
      )
      const bad = []
      let buttons = 0
      for (const row of rows) {
        const all = [...row.children].filter((b) => b.tagName === 'BUTTON' && b.offsetParent !== null)
        const heights = []
        for (const b of all) {
          buttons++
          const label = b.innerText.trim().replace(/\\s+/g, ' ')
          const box = b.getBoundingClientRect()
          heights.push(Math.round(box.height))
          if (b.scrollWidth > b.clientWidth) bad.push('«' + label + '» вылезает: ' + b.scrollWidth + ' из ' + b.clientWidth + ' px')
          if (box.right > innerWidth + 0.5 || box.left < -0.5) bad.push('«' + label + '» за краем окна')
          if (box.height < 44) bad.push('«' + label + '» ниже 44 px: ' + Math.round(box.height))
        }
        if (heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 1) {
          bad.push('ряд «' + all.map((b) => b.innerText.trim()).join(' / ') + '» разной высоты: ' + heights.join(', ') + ' px')
        }
      }
      return { buttons, bad }
    })()`)
    checked += r.buttons
    bad.push(...r.bad.map((line) => `${width} px: ${line}`))
  }
  if (widths[widths.length - 1] !== d.size.width) await d.setWidth()
  console.log(`  кнопки выбора, ${where}: ${checked} замеров на ${widths.join(', ')} px`)
  if (bad.length > 0) throw new Error(`кнопки выбора не по содержимому (${where}):\n${bad.join('\n')}`)
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

// Раздел «Настроек» (#234): заголовок — кнопка; свёрнут — развернуть касанием (open = false — свернуть), как человек
async function settingsGroup(d: Device, group: string, open = true): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < TIMEOUT) {
    const state = await d.eval<string>(`(() => {
      const b = [...document.querySelectorAll('button.group-toggle')]
        .find((e) => e.textContent.replace(/[▸▾]/g, '').trim() === ${JSON.stringify(group)})
      if (!b) return 'нет'
      if (b.getAttribute('aria-expanded') === ${JSON.stringify(String(open))}) return 'готово'
      b.click()
      return 'нажато'
    })()`).catch(() => 'нет')
    if (state === 'готово') return
    await sleep(200)
  }
  throw new Error(`раздел «${group}» не ${open ? 'развернулся' : 'свернулся'}`)
}

// Открыть «Настройки» и развернуть нужные разделы (#234): в первый раз развёрнуто только «Оформление».
// Уже открыты — перезагрузить: тот же адрес страницу не перезагружает, и раскрытые карточки остались бы раскрытыми,
// а кнопка заголовка прежней страницы ответила бы раньше новой
async function openSettings(d: Device, ...groups: string[]): Promise<void> {
  if ((await d.eval<string>('location.hash')) === '#/settings') await d.reload()
  else await d.goto('#/settings')
  await d.waitFor('button.group-toggle')
  for (const group of groups) await settingsGroup(d, group)
}

// «Настройки»: гамма — касанием в «Оформлении» («Ночь» не выбрана — как у того, кто не выбирал), снимок по умолчанию
// (развёрнуто только «Оформление») и с одним развёрнутым «Учётом игр» (#234), демо-игры
async function settingsStep(d: Device, theme: Theme): Promise<void> {
  await screen('Настройки', d.size, async () => {
    await openSettings(d)
    await d.waitText('Демо-данные')
    await d.fontsLoaded() // первый экран каждого размера
    await pickTheme(d, theme)
    await d.shot('05-nastroyki')
    await settingsGroup(d, 'Оформление', false)
    await settingsGroup(d, 'Учёт игр')
    await d.waitText('Курс новой игры')
    await d.shot('05a-nastroyki-uchet')
    // Демо-игры (Р-04) — для «Игр» и казино
    await settingsGroup(d, 'Демо-данные')
    await d.click('Добавить демо-данные')
    await d.waitText('Добавлено демо-игр')
  })
}

// Учёт вечера (#211): открытая игра после записи выхода, закрытая с итогом и переводами, второе касание «Удалить игру»
async function accountingStep(d: Device): Promise<void> {
  await screen('Игра идёт', d.size, async () => {
    await d.goto('#/')
    await d.waitText('Демо: игра идёт')
    await d.click('Демо: игра идёт')
    await d.waitText('Закрыть игру')
    await recordExit(d, 'Вера', 1000) // у Веры выхода не было; 1 000 из 1 500 — игра не сходится на 500 фишек
    await d.waitText('Не хватает 500 фишек')
    await d.shot('10-igra')
  })
  await screen('Итог', d.size, async () => {
    await d.goto('#/')
    await d.waitText('Демо: пятница')
    await d.click('Демо: пятница')
    await d.waitText('Открыть снова')
    await d.shot('11-itog')
  })
  await screen('Удалить игру', d.size, async () => {
    await d.click('Удалить игру')
    await d.waitText('Точно удалить')
    await d.shot('13-udalit')
    await d.click('Отмена') // игру не удалять
    await d.waitText('Удалить игру')
  })
}

// Карточка постоянного игрока — своё хранилище: постоянные «Аня» и «Боря», закрытая игра с ними (закуп по умолчанию,
// выходы 1 500 и 500); в карточке Ани — открытая заметка с выбранным цветом. Постоянные — только здесь:
// у остальных шагов (столы, казино) участников они бы поменяли
async function playerStep(cdp: Cdp, size: Size, theme: Theme): Promise<void> {
  await screen('Карточка игрока', size, async () => {
    const d = await Device.open(cdp, size)
    await openSettings(d, 'Игроки')
    await d.waitText('Постоянные игроки')
    await pickTheme(d, theme)
    for (const name of ['Аня', 'Боря']) {
      await d.type('input[placeholder="Имя игрока"]', name)
      await submit(d, 'input[placeholder="Имя игрока"]')
      await d.waitText(name)
    }
    await d.goto('#/')
    await d.click('Записать игру')
    await d.click('Вручную')
    await d.waitText('Новая игра')
    await d.waitText('Участники: 2 из 2')
    await d.click('Создать')
    await d.waitText('Записать всем закуп')
    await d.click('Да')
    await d.waitText('Закрыть игру')
    await recordExit(d, 'Аня', 1500)
    await recordExit(d, 'Боря', 500)
    await d.click('Закрыть игру')
    await d.waitText('Открыть снова')
    await d.goto('#/players')
    await d.waitText('Аня')
    await d.click('Аня')
    await d.waitText('За всё время')
    await d.click('Написать заметку')
    await d.waitFor('button.note-color')
    await d.eval("(document.querySelector('button.note-color').click(), true)")
    await d.waitFor('button.note-color.on')
    await d.shot('12-igrok')
  })
}

// Гамма — касанием в «Оформлении» на открытых «Настройках»; «Ночь» — как у того, кто не выбирал
async function pickTheme(d: Device, theme: Theme): Promise<void> {
  if (theme === 'night') return
  await settingsGroup(d, 'Оформление')
  await d.click(THEME_BUTTONS[theme])
  await d.waitFor(`html[data-theme="${theme}"]`)
}

// Свежее хранилище — гамма сценария (SHOTS_THEME) касанием в «Настройках», без снимка (#211)
async function themeOnly(d: Device): Promise<void> {
  if (runTheme === 'night') return
  await openSettings(d)
  await pickTheme(d, runTheme)
}

// Отправить форму поля selector — как Enter в поле
async function submit(d: Device, selector: string): Promise<void> {
  const done = await d.eval<boolean>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el || !el.form) return false
    el.form.requestSubmit()
    return true
  })()`)
  if (!done) throw new Error(`нет формы у поля ${selector}`)
}

// Записать выход участнику игры: «Выход» в его карточке → число → «Выход»
async function recordExit(d: Device, name: string, chips: number): Promise<void> {
  const field = 'input[aria-label="Выход, фишек"]'
  const done = await d.eval<boolean>(`(() => {
    const card = [...document.querySelectorAll('li.card.player')].find((li) => li.querySelector('.player-head strong')?.textContent.trim() === ${JSON.stringify(name)})
    const button = card && [...card.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Выход')
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!done) throw new Error(`нет кнопки «Выход» у «${name}»`)
  await d.waitFor(field)
  await d.type(field, String(chips))
  await sleep(100)
  await submit(d, field)
  const started = Date.now()
  while (await d.eval<boolean>(`!!document.querySelector(${JSON.stringify(field)})`)) {
    if (Date.now() - started > TIMEOUT) throw new Error(`выход «${name}» не записался`)
    await sleep(200)
  }
}

async function gamesStep(d: Device): Promise<void> {
  await screen('Игры', d.size, async () => {
    await d.goto('#/')
    await d.waitText('Демо: игра идёт')
    await d.waitText('Демо: пятница')
    await d.shot('01-igry')
  })
}

async function playStep(d: Device): Promise<void> {
  await screen('Играть', d.size, async () => {
    await d.goto('#/poker')
    await d.waitText('Войти по ссылке')
    await d.waitText('Сесть за стол')
    await d.shot('02-igrat')
  })
}

// «Тренажёр» (#213): с «Играть» — диапазон текстом против руки на флопе, итог посчитан
async function trainerStep(d: Device): Promise<void> {
  await screen('Тренажёр', d.size, async () => {
    await d.goto('#/poker')
    await d.waitText('Открыть тренажёр')
    await d.click('Открыть тренажёр')
    await d.waitText('Добавить сторону')
    await d.click('Диапазон') // первая — у стороны 1
    await d.waitFor('.range-text')
    await d.type('.range-text', '77+, A9s+, KQs, AJo+, AKs:0.5, JTs:0.75, 65s:0.25')
    await d.waitText('% рук')
    await d.click('Выбрать карты') // сторона 2 — рука
    await pickCards(d, ['Jd', 'Td'])
    await d.click('Выбрать борд')
    await pickCards(d, ['Qs', '9h', '2c'])
    await d.eval("document.querySelector('.trainer-board .card-slots').click()") // закрыть колоду борда
    await d.waitText('победа')
    await waitGone(d, 'Считаем…')
    await d.shot('02c-trenazher')
    // Колода руки стороны 2: её карты отмечены, карты борда приглушены
    await d.eval("document.querySelectorAll('.trainer-side .card-slots')[0].click()")
    await d.waitFor('.deck')
    await d.shot('02d-trenazher-koloda')
    // «Чарты» (#214): BTN против 3-бета BB, касание AKs — доли руки строкой
    await d.click('Чарты')
    await d.waitText('Моя позиция')
    await d.click('BTN')
    await d.click('Я открылся, 3-бет от BB')
    await d.waitText('Доходит до ситуации')
    await d.eval(`document.querySelector('.chart-cell[aria-label^="AKs:"]').click()`)
    await d.waitText('AKs: ')
    await d.shot('02e-trenazher-charty')
    // Свои чарты (#215): «Изменить» — правка клетки AKs и диапазон текстом на колл, затем «Сохранить как свой»
    await d.click('Изменить')
    await d.waitText('Загрузить текстом')
    await d.eval(`document.querySelector('.chart-edit .chart-cell[aria-label^="AKs:"]').click()`)
    await d.waitFor('.chart-share-row')
    await d.eval(`document.querySelectorAll('.chart-share-row button[aria-label$="больше на 25 %"]')[1].click()`)
    await d.eval(`(() => {
      const el = document.querySelector('textarea.chart-paste')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'QQ, JJ, AQs:0.5, KQs')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await d.click('Применить')
    await d.waitText('Диапазон лёг')
    await d.shot('02f-trenazher-pravka')
    await d.type('.chart-edit .field input', 'Мой BTN против 3-бета')
    await d.click('Сохранить как свой')
    await d.waitText('Переименовать')
    await d.waitText('Выгрузить')
    await d.shot('02g-trenazher-moi-charty')
    await d.goto('#/poker') // дальше сценарий идёт с «Играть»
    await d.waitText('Сесть за стол')
  })
}

// npm run shots -- trainer: только «Играть» и «Тренажёр», на телефоне и ноутбуке; «Тренажёр» — ещё в «Клубе» и «Дне»
async function trainerOnly(cdp: Cdp): Promise<void> {
  for (const size of SIZES.slice(0, 2)) {
    console.log(`Тренажёр, ${size.width} × ${size.height}`)
    const d = await Device.open(cdp, size)
    await playStep(d)
    await trainerStep(d)
    for (const other of ['club', 'day'] as const) {
      const t = await Device.open(cdp, size, `${other}-`)
      await openSettings(t)
      await pickTheme(t, other)
      await trainerStep(t)
    }
  }
}

// Касания карт открытой колоды тренажёра
async function pickCards(d: Device, cards: string[]): Promise<void> {
  for (const card of cards) {
    await d.waitFor(`.deck [data-card="${card}"]`)
    await d.eval(`document.querySelector('.deck [data-card="${card}"]').click()`)
    await sleep(100)
  }
}

// «Играть» с полосой «Продолжить» (#209): после стола против ботов он — последняя игра
async function playContinueStep(d: Device): Promise<void> {
  await screen('Играть: продолжить', d.size, async () => {
    await d.goto('#/poker')
    await d.waitText('Войти по ссылке')
    await d.waitText('Последняя игра')
    await d.shot('02b-igrat-prodolzhit')
  })
}

// Гамма, кроме основной: «Настройки», «Игры», «Играть» и стол против ботов в мой ход — своё хранилище, имена с гаммой
async function themeScenario(cdp: Cdp, size: Size, theme: Theme): Promise<void> {
  console.log(`Гамма ${theme}, ${size.width} × ${size.height}`)
  const d = await Device.open(cdp, size, `${theme}-`)
  await settingsStep(d, theme)
  await gamesStep(d)
  await playStep(d)
  await screen('Против ботов', size, async () => {
    await d.click('Сесть за стол')
    await d.waitText('Карты ботов открыты')
    await d.click('Начать')
    await d.waitText('Стол с ботами')
    await myTurn(d)
    await d.tableShot('03-protiv-botov')
  })
  await playContinueStep(d)
}

// uchet — без столов покера (npm run shots -- uchet): учёт, «Игроки», «Настройки», казино, справка
async function scenario(cdp: Cdp, size: Size, theme: Theme, uchet: boolean): Promise<void> {
  console.log(`Размер ${size.width} × ${size.height}`)
  const d = await Device.open(cdp, size)

  await settingsStep(d, theme)
  await gamesStep(d)
  await accountingStep(d)
  await playerStep(cdp, size, theme)

  await screen('Игроки', size, async () => {
    await d.goto('#/players')
    await d.waitFor('main h1')
    await d.shot('07-igroki')
  })

  // «Вид стола» в «Настройках»: на широком окне — ещё размер стола и панели ставок (Р-63)
  await screen('Вид стола', size, async () => {
    await openSettings(d, 'Покер онлайн и стол')
    await d.waitText('Выбрать вид стола')
    await d.click('Выбрать вид стола')
    await d.waitText('Колода')
    if (size.width >= 1024) await d.waitText('Размер стола')
    await choicesFit(d, 'Вид стола')
    await d.shot('08-vid-stola')
  })

  if (!uchet) await pokerSteps(d)
  await casinoAndHelpSteps(d)
}

// «Играть», против ботов, «Продолжить», стол на этом телефоне — после «Вида стола», до казино
async function pokerSteps(d: Device): Promise<void> {
  const size = d.size
  await playStep(d)
  await trainerStep(d)

  await roomFormStep(d)

  await screen('Против ботов', size, async () => {
    await botsFormStep(d)
    await d.click('Начать')
    await d.waitText('Стол с ботами')
    await myTurn(d)
    await d.tableShot('03-protiv-botov')
    // Касание своего имени (Р-64) — суммы в ББ, с подсказкой; снова — обратно в фишки
    await tapMyName(d)
    await d.waitText('Суммы в ББ')
    await d.waitText(' ББ')
    await d.tableShot('03b-protiv-botov-bb')
    await tapMyName(d)
    await d.waitText('Суммы в фишках')
    // Пас — боты играют дальше: внизу «Доиграть сразу» (#194); нажал — сразу итог раздачи
    await foldUntilPlayOn(d)
    await d.tableShot('03c-protiv-botov-doigrat')
    await d.click('Доиграть сразу')
    await d.waitText('Новая раздача через') // раздача кончилась — отсчёт до следующей («Быстро» в форме сначала)
    await d.tableShot('03d-protiv-botov-itog')
    // «Докупить всех до N» (#195): после раздачи у кого-то меньше стартового стека; «Перерыв» — чтобы отсчёт
    // не начал следующую раздачу до снимка. Нажал — у всех не меньше стартового, кнопки нет
    await d.waitText('Докупить всех до')
    await d.click('Перерыв')
    await d.waitText('Продолжить')
    await d.tableShot('03e-protiv-botov-dokupit-vseh')
    await d.click('Докупить всех до')
    await waitGone(d, 'Докупить всех до')
    await d.tableShot('03f-protiv-botov-dokupleny')
  })
  await historyStep(d)

  await playContinueStep(d)

  // Стол на одном телефоне на 10 мест — самый тесный стол: места не наезжают на панель хода
  await screen('Стол на этом телефоне', size, async () => {
    await localTable(d)
    await d.tableShot('09-stol-na-telefone')
    // Рейз до флопа — у следующего быстрые кнопки перерейза от ставки круга (Р-66)
    await d.click('3 ББ')
    await d.click('Рейз до')
    await d.waitText('×2,5')
    await sleep(500)
    await d.tableShot('09b-stol-na-telefone-pererejz')
  })
}

// Форма «Новая комната» без сервера (#238): карты на телефонах, омаха и «Микс» — видны все ряды кнопок выбора;
// с «Играть» и обратно на него
async function roomFormStep(d: Device): Promise<void> {
  await screen('Новая комната', d.size, async () => {
    await d.click('Настроить…')
    await d.waitText('Новая комната')
    await d.click('На телефонах')
    await d.click('Омаха')
    await d.waitText('Пот-лимит')
    await d.click('Батон предлагает игру перед раздачей')
    await d.waitText('двух третей')
    // Запас времени (#223) — поле есть только при времени на ход
    await d.click('20 с')
    await pickTimeBank(d, '15 с')
    await d.waitText('15 с на вечер')
    await choicesFit(d, 'Новая комната')
    await d.shot('03g-novaya-komnata')
    await d.click('Отмена')
    await d.waitText('Сесть за стол')
  })
}

// Кнопка «Запаса времени» (#223): те же надписи «30 с», «60 с» есть и у «Времени на ход» — ищем в своём ряду
async function pickTimeBank(d: Device, label: string): Promise<void> {
  const done = await d.eval<boolean>(`(() => {
    const set = [...document.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.innerText.trim() === 'Запас времени')
    const button = set && [...set.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!done) throw new Error(`нет кнопки запаса «${label}»`)
}

// npm run shots -- zapas (#223): «Быстрая комната» в «Настройках» со временем на ход и запасом — сохранить;
// «Играть» с её подписью и форма «Новая комната» с запасом; на телефоне и ноутбуке
async function timeBankOnly(cdp: Cdp): Promise<void> {
  for (const size of SIZES.slice(0, 2)) {
    console.log(`Запас времени, ${size.width} × ${size.height}`)
    const d = await Device.open(cdp, size)
    await themeOnly(d)
    await screen('Быстрая комната', size, async () => {
      await openSettings(d, 'Покер онлайн и стол')
      await d.waitText('Настроить быструю комнату')
      await d.fontsLoaded()
      await d.click('Настроить быструю комнату')
      await d.waitText('Время на ход')
      await d.click('20 с')
      await pickTimeBank(d, '30 с')
      await d.waitText('30 с на вечер')
      await choicesFit(d, 'Быстрая комната')
      // «Сохранить» на «Настройках» не одна — отправить форму, где «Запас времени»
      const saved = await d.eval<boolean>(`(() => {
        const set = [...document.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.innerText.trim() === 'Запас времени')
        const form = set?.closest('form')
        if (!form) return false
        form.requestSubmit()
        return true
      })()`)
      if (!saved) throw new Error('нет формы «Быстрой комнаты»')
      await d.waitText('запас 30 с')
      await d.shot('05b-bystraya-komnata-zapas')
    })
    await playStep(d)
    await roomFormStep(d)
  }
}

// Форма «Против ботов» с «Играть»: замер кнопок выбора (#238) и снимок; форма остаётся открытой
async function botsFormStep(d: Device): Promise<void> {
  await d.click('Сесть за стол')
  await d.waitText('Карты ботов открыты')
  await d.waitText('После паса — сразу доигрывать')
  await choicesFit(d, 'Против ботов')
  await d.shot('03a-protiv-botov-forma')
}

// npm run shots -- vybor (#238): только ряды кнопок выбора — «Вид стола», «Новая комната» и «Против ботов»,
// на телефоне и ноутбуке, с замером
async function choicesOnly(cdp: Cdp): Promise<void> {
  for (const size of SIZES.slice(0, 2)) {
    console.log(`Кнопки выбора, ${size.width} × ${size.height}`)
    const d = await Device.open(cdp, size)
    await themeOnly(d)
    await screen('Вид стола', size, async () => {
      await openSettings(d, 'Покер онлайн и стол')
      await d.waitText('Выбрать вид стола')
      await d.fontsLoaded()
      await d.click('Выбрать вид стола')
      await d.waitText('Колода')
      await choicesFit(d, 'Вид стола')
      await d.shot('08-vid-stola')
    })
    await playStep(d)
    await roomFormStep(d)
    await screen('Против ботов', size, () => botsFormStep(d))
  }
}

// Казино (на телефоне — ещё на шестерых) и справка — в конце сценария
async function casinoAndHelpSteps(d: Device): Promise<void> {
  const size = d.size
  await screen('Казино', size, async () => {
    await d.goto('#/poker')
    await d.waitText('Войти по ссылке')
    await d.click('В казино')
    await d.waitText('Новая игра — только казино')
    await d.click('Демо: игра идёт')
    await d.waitText('карты раздаёт программа, всё в открытую')
    await d.click('Раздать')
    await boardsGoing(d)
    await d.shot('04-kazino')
  })
  const casino = await d.eval<string>('location.hash') // раунд этого казино — для снимков в другом лице карт

  // Казино на шестерых (Р-67, #193) — только телефон: места одним рядом сверху, всё без прокрутки.
  // Новая игра «только казино» из шести гостей; снимок — первый экран, как его видно на телефоне
  if (size.width < 600) {
    await screen('Казино на шестерых', size, async () => {
      await d.goto('#/poker')
      await d.waitText('Войти по ссылке')
      await d.click('В казино')
      await d.waitText('Новая игра — только казино')
      await d.click('Новая игра — только казино')
      await d.waitFor('input[aria-label="Имя гостя"]')
      for (const name of GUESTS.slice(0, 6)) {
        await d.type('input[aria-label="Имя гостя"]', name)
        await sleep(100)
        await d.click('Добавить')
        await sleep(100)
      }
      await d.click('Начать')
      await d.waitText('карты раздаёт программа, всё в открытую')
      await d.waitText('участников 6')
      await d.click('Раздать')
      await boardsGoing(d)
      await d.shot('04c-kazino-6', false)
    })
  }

  // Лицо карт (#219): касание в «Виде стола» — образец колоды в этом лице; затем тот же раунд казино в нём —
  // рука места, стол, строка победителя, подсветка и приглушение; остальные столы ещё рубашкой.
  // Перед следующими экранами — снова «Крупное»
  const faces = [
    ['Классическое', '08b-vid-stola-klassicheskoe', '04d-kazino-klassicheskoe'],
    ['Цветное', '08c-vid-stola-cvetnoe', '04e-kazino-cvetnoe'],
  ] as const
  for (const [face, look, shot] of faces) {
    await screen(`Лицо карт «${face}»`, size, async () => {
      await pickFace(d, face)
      await d.waitFor('.deck-sample .playing-card.face-' + (face === 'Цветное' ? 'color' : 'classic'))
      await d.shot(look)
      await d.goto(casino)
      await d.waitFor('.casino-board.open .playing-card.face-' + (face === 'Цветное' ? 'color' : 'classic'))
      await sleep(600) // переворот карт стола
      await d.shot(shot)
    })
  }
  await screen('Лицо карт «Крупное»', size, async () => {
    await pickFace(d, 'Крупное')
    await d.waitFor('.deck-sample .playing-card:not(.face-classic):not(.face-color)')
  })

  await ownBackStep(d)

  await screen('Справка', size, async () => {
    await d.goto('#/help')
    await d.waitFor('details.card.help')
    await d.shot('06-spravka')
  })
}

// Имена у мест казино на телефоне (#254): новая игра «только казино» из четырёх гостей с именами 8–12 букв, холдем
// и омаха, на 360 и 390 px; снимок — первый экран. Замер: у каждого имени — шрифт, ширина текста и места; имя
// с многоточием (текст шире места) — сбой. npm run shots -- imena — только этот шаг
const LONG_GUESTS = ['Константин', 'Александра', 'Владислав', 'Станислава'] // выдуманные гости
const NAME_SIZES: Size[] = [
  { name: '360', width: 360, height: 780 },
  { name: '390', width: 390, height: 844 },
]

async function namesOnly(cdp: Cdp): Promise<void> {
  for (const size of NAME_SIZES) {
    const d = await Device.open(cdp, size)
    await themeOnly(d)
    for (const [kind, file] of [
      ['Холдем', '04f-kazino-imena-holdem'],
      ['Омаха', '04g-kazino-imena-omaha'],
    ] as const) {
      await screen(`Казино: имена, ${kind}`, size, async () => {
        await d.goto('#/poker')
        await d.waitText('Войти по ссылке')
        await d.click('В казино')
        await d.waitText('Новая игра — только казино')
        await d.click('Новая игра — только казино')
        await d.waitFor('input[aria-label="Имя гостя"]')
        for (const name of LONG_GUESTS) {
          await d.type('input[aria-label="Имя гостя"]', name)
          await sleep(100)
          await d.click('Добавить')
          await sleep(100)
        }
        await d.click('Начать')
        await d.waitText('карты раздаёт программа, всё в открытую')
        await d.waitText(`участников ${LONG_GUESTS.length}`)
        // Вариант — в свёрнутых настройках: раскрыть, выбрать, свернуть
        await d.eval(`(document.querySelector('.casino-fold').click(), true)`)
        await d.waitText('Вариант')
        await d.click(kind)
        await sleep(100)
        await d.eval(`(document.querySelector('.casino-fold[aria-expanded="true"]')?.click(), true)`)
        await sleep(100)
        await d.click('Раздать')
        await boardsGoing(d)
        await d.fontsLoaded()
        await d.shot(file, false)
        await namesFit(d)
      })
    }
  }
}

// Имена у мест казино (#254): шрифт, ширина текста (в долях шрифта) и места; текст шире места — сбой
async function namesFit(d: Device): Promise<void> {
  const r = await d.eval<{ name: string; font: number; text: number; box: number; em: number }[]>(`(() => {
    return [...document.querySelectorAll('.casino-seat .seat-name')].map((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const text = range.getBoundingClientRect().width
      const font = parseFloat(getComputedStyle(el).fontSize)
      const r2 = (x) => Math.round(x * 100) / 100
      return { name: el.textContent, font: r2(font), text: r2(text), box: r2(el.getBoundingClientRect().width), em: r2(text / font) }
    })
  })()`)
  for (const s of r) console.log(`  имя «${s.name}»: шрифт ${s.font} px, текст ${s.text} px (${s.em} em), место ${s.box} px`)
  const cut = r.filter((s) => s.text > s.box + 0.01)
  if (cut.length > 0) throw new Error(`имена с многоточием: ${cut.map((s) => s.name).join(', ')}`)
}

// Своя рубашка (#220): «Вид стола» → картинка в поле выбора файла (фишка-иконка, PNG 512 px) → выбрана «Своя»
// с образцом; затем новое казино до «Раздать» — места и столы её рубашкой. Потом «Удалить свою рубашку», и дальше
// сценарий идёт со встроенной. npm run shots -- rubashka — только этот шаг
async function ownBackStep(d: Device): Promise<void> {
  const size = d.size
  await screen('Своя рубашка', size, async () => {
    await openSettings(d, 'Покер онлайн и стол')
    await d.waitText('Выбрать вид стола')
    await d.click('Выбрать вид стола')
    await d.waitText('Своя картинка…')
    await d.setFile('input[type="file"]', ownBackPicture)
    await d.waitText('Удалить свою рубашку')
    await d.waitFor('button[aria-pressed="true"] .look-back.back-own')
    const saved = await d.eval<string>(`localStorage.getItem('fishki.poker.ownBack') || ''`)
    const kb = (Math.round((saved.length * 3) / 4 / 100) / 10).toString().replace('.', ',')
    console.log(`  своя рубашка: ${saved.slice(5, saved.indexOf(';'))}, ${saved.length} знаков (≈ ${kb} КБ)`)
    await choicesFit(d, 'Вид стола, своя рубашка')
    await d.shot('08d-vid-stola-svoya-rubashka')

    await d.goto('#/poker')
    await d.waitText('Войти по ссылке')
    await d.click('В казино')
    await d.waitText('Новая игра — только казино')
    await d.click('Новая игра — только казино')
    await d.waitFor('input[aria-label="Имя гостя"]')
    for (const name of GUESTS.slice(0, 4)) {
      await d.type('input[aria-label="Имя гостя"]', name)
      await sleep(100)
      await d.click('Добавить')
      await sleep(100)
    }
    await d.click('Начать')
    await d.waitText('карты раздаёт программа, всё в открытую')
    await d.waitFor('.back-own .playing-card.back')
    await d.shot('04f-kazino-svoya-rubashka')

    await openSettings(d, 'Покер онлайн и стол')
    await d.waitText('Выбрать вид стола')
    await d.click('Выбрать вид стола')
    await d.waitText('Удалить свою рубашку')
    await d.click('Удалить свою рубашку')
    await waitGone(d, 'Удалить свою рубашку')
  })
}

async function ownBackOnly(cdp: Cdp): Promise<void> {
  for (const size of SIZES) {
    console.log(`Своя рубашка, ${size.width} × ${size.height}`)
    const d = await Device.open(cdp, size)
    await themeOnly(d)
    await ownBackStep(d)
  }
}

// «Настройки» → «Вид стола» → «Лицо карт»: выбрать касанием
async function pickFace(d: Device, face: string): Promise<void> {
  await openSettings(d, 'Покер онлайн и стол')
  await d.waitText('Выбрать вид стола')
  await d.click('Выбрать вид стола')
  await d.waitText('Лицо карт')
  await d.click(face)
}

// Стол на одном телефоне на 10 гостей (выдуманные имена): раздача началась, ход — у первого, панель хода с ползунком
async function localTable(d: Device): Promise<void> {
  await d.goto('#/poker')
  await d.waitText('Войти по ссылке')
  await d.click('Открыть стол')
  await d.waitText('Ведущий ходит за каждого')
  for (const name of GUESTS) {
    await d.type('input[aria-label="Имя гостя"]', name)
    await sleep(100)
    await d.click('Добавить')
    await sleep(100)
  }
  await d.waitText(`За столом: ${GUESTS.length}`)
  await d.click('Начать')
  await d.waitText('Удалить стол')
  await d.click('Начать раздачу')
  await d.waitFor('.dock.actions')
  await sleep(1500) // раздача долетела
}

// Страддл (#222): стол на этом телефоне на 4 гостей — форма с галочкой «Страддл» (09c), затем первая раздача (09d):
// у UTG — 2 ББ, над столом «· страддл …», ход — у следующего после него. Своё хранилище;
// npm run shots -- straddl — только он, на всех трёх размерах
async function straddleStep(cdp: Cdp, size: Size): Promise<void> {
  console.log(`Страддл, ${size.width} × ${size.height}`)
  await screen('Страддл', size, async () => {
    const d = await Device.open(cdp, size)
    await themeOnly(d)
    await d.goto('#/poker')
    await d.waitText('Войти по ссылке')
    await d.click('Открыть стол')
    await d.waitText('Ведущий ходит за каждого')
    for (const name of GUESTS.slice(0, 4)) {
      await d.type('input[aria-label="Имя гостя"]', name)
      await sleep(100)
      await d.click('Добавить')
      await sleep(100)
    }
    await d.waitText('За столом: 4')
    await d.click('Страддл: UTG ставит 2 ББ вслепую')
    await d.waitText('Ходит до флопа последним')
    await d.shot('09c-straddl-forma')
    await d.click('Начать')
    await d.waitText('Удалить стол')
    await d.click('Начать раздачу')
    await d.waitFor('.dock.actions')
    await d.waitText('· страддл')
    await sleep(1500) // раздача долетела
    await d.tableShot('09d-straddl-razdacha')
  })
}

// История раздач (#239): стол с ботами на «Перерыве» после раздачи, где я сбросил, — список за столом
// (строка: мои карты, позиция, итог, борд), затем тот же вечер в «Прошлых вечерах»: итог вечера (#242) и список,
// раздача, где я сбросил (сверху — последняя), и она же «Текстом»; в конце — карточка «Прошлые вечера» в «Настройках»
async function historyStep(d: Device): Promise<void> {
  await screen('История раздач', d.size, async () => {
    await d.click('История раздач')
    await d.waitFor('.history-hand .history-pos')
    await d.shot('03g-istoriya-razdach', false)
  })
  // Вечер «Против ботов» в «Прошлых вечерах»: открыть; hand — и последнюю раздачу (сверху)
  async function openEvening(hand: boolean): Promise<void> {
    await d.goto('#/poker')
    await d.waitText('Прошлые вечера')
    const opened = await d.eval<boolean>(`(() => {
      const el = [...document.querySelectorAll('button.history-item')].find((b) => b.innerText.includes('Против ботов'))
      if (!el) return false
      el.click()
      return true
    })()`)
    if (!opened) throw new Error('нет вечера «Против ботов» в «Прошлых вечерах»')
    await d.waitFor('.history-hand .history-pos')
    if (!hand) return
    await d.eval(`document.querySelector('.history-hand').click()`)
    await d.waitText('Вам сдано')
    await d.waitText('Ваш итог за раздачу')
  }
  await screen('Прошлые вечера: раздача', d.size, async () => {
    await d.goto('#/poker')
    await d.waitText('Прошлые вечера')
    await d.shot('03h0-proshlye-vechera') // #242: строка вечера — с моим итогом
    await openEvening(false)
    await d.shot('03h-proshlye-vechera-spisok')
    await d.eval(`document.querySelector('.history-hand').click()`)
    await d.waitText('Вам сдано')
    await d.waitText('Ваш итог за раздачу')
    await d.shot('03i-razdacha-pas')
    // #221: «В калькулятор» — тренажёр с моими картами, бордом и сторонами соперников
    await d.click('В калькулятор')
    await d.waitText('Добавить сторону')
    await d.waitFor('.trainer-side .card-slots .playing-card')
    await waitGone(d, 'Считаем…')
    await d.shot('03i2-razdacha-v-kalkulyator')
    await openEvening(true)
    await d.click('Текстом')
    await d.waitText('*** HOLE CARDS ***')
    await d.shot('03j-razdacha-tekstom')
  })
  // #242: «Итог вечера» над списком раздач — в 03h; здесь — удаление пачкой в «Настройках», «Копия данных»
  await screen('Настройки: прошлые вечера', d.size, async () => {
    await openSettings(d, 'Копия данных')
    await d.waitText('Удалить вечера против ботов (')
    await d.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.innerText.startsWith('Удалить вечера против ботов'))
      b.closest('.card').scrollIntoView({ block: 'center' })
      return true
    })()`)
    await d.shot('03k-nastroyki-proshlye-vechera', false)
  })
}

// npm run shots -- history: только история раздач (#239) — стол с ботами до паса и «Доиграть сразу», на телефоне и ноутбуке
async function historyOnly(cdp: Cdp): Promise<void> {
  for (const size of SIZES.slice(0, 2)) {
    console.log(`История раздач, ${size.width} × ${size.height}`)
    const d = await Device.open(cdp, size)
    await screen('Против ботов', size, async () => {
      await botsTable(d, 3)
      await foldUntilPlayOn(d)
      await d.click('Доиграть сразу')
      await d.waitText('Новая раздача через')
      await d.click('Перерыв')
      await d.waitText('Продолжить')
    })
    await historyStep(d)
  }
}

// npm run shots -- hud: карточка HUD за столом с ботами — «Боты читают: …» (#240) и десять чисел (#241),
// на телефоне и ноутбуке.
// После первой раздачи у всех одна раздача: бот — «как подписан», я — «как среднего игрока»; затем в памяти
// стола у первого бота раздач 45 («первое чтение»), у второго — 120 («твёрдое»), страница перезагружается
async function hudOnly(cdp: Cdp): Promise<void> {
  // Строка HUD места seat; hands — у кого столько раздач («… · 45»)
  const openHud = async (d: Device, seat: string, hands?: number) => {
    const done = await d.eval<boolean>(`(() => {
      const all = [...document.querySelectorAll(${JSON.stringify(`${seat} button.seat-hud`)})]
      const el = ${hands === undefined ? 'all[0]' : `all.find((b) => b.innerText.trim().endsWith(' ${hands}'))`}
      if (!el) return false
      el.click()
      return true
    })()`)
    if (!done) throw new Error(`нет строки HUD у места ${seat}${hands === undefined ? '' : ` с ${hands} раздачами`}`)
    await d.waitText('Боты читают')
  }
  const closeHud = (d: Device) => d.eval(`(document.querySelector('.hud-pop button')?.click(), true)`)
  for (const size of SIZES.slice(0, 2)) {
    console.log(`HUD за столом с ботами, ${size.width} × ${size.height}`)
    const d = await Device.open(cdp, size)
    await screen('Против ботов, HUD', size, async () => {
      await botsTable(d, 3)
      await foldUntilPlayOn(d)
      await d.click('Доиграть сразу')
      await d.waitText('Новая раздача через')
      await d.click('Перерыв')
      await d.waitText('Продолжить')
      await openHud(d, '.seat:not(.me)')
      await d.shot('11a-hud-bot-kak-podpisan')
      await closeHud(d)
      await openHud(d, '.seat.me')
      await d.shot('11b-hud-ya-kak-srednego')
      await closeHud(d)
      await d.eval(`(() => {
        const bt = JSON.parse(localStorage.getItem('fishki.poker.bots'))
        const bots = bt.table.players.filter((p) => p.id !== bt.meId)
        bt.table.hud[bots[0].id].hands = 45
        // Второму — и числа #241: 3-бет 10 %, фолд на 3-бет 60 %, WTSD 28 %, W$SD 57 %, bb/100 +12,5
        Object.assign(bt.table.hud[bots[1].id], {
          hands: 120, threeBetChances: 40, threeBets: 4, foldTo3BetChances: 10, foldsTo3Bet: 6,
          flops: 50, showdowns: 14, showdownWins: 8, netHands: 120, net: 1500,
        })
        localStorage.setItem('fishki.poker.bots', JSON.stringify(bt))
        return true
      })()`)
      await d.reload()
      await d.waitText('Продолжить')
      await sleep(1500)
      for (const [hands, label, file] of [
        [45, 'первое чтение', '11c-hud-pervoe-chtenie'],
        [120, 'твёрдое', '11d-hud-tvyordoe'],
      ] as const) {
        await openHud(d, '.seat:not(.me)', hands)
        await d.waitText(`Боты читают: ${label}`)
        await d.shot(file)
        await closeHud(d)
      }
    })
  }
}

// npm run shots -- gear: «⚙ Стол» за столом с ботами (#243) — в мой ход, посреди раздачи, на телефоне и ноутбуке,
// в «Ночи» и «Дне»: верх карточки («Мой вид стола») и она же, пролистанная к «Этот стол»
async function gearOnly(cdp: Cdp): Promise<void> {
  for (const size of SIZES.slice(0, 2)) {
    for (const theme of ['night', 'day'] as const) {
      console.log(`«⚙ Стол», ${theme}, ${size.width} × ${size.height}`)
      const d = await Device.open(cdp, size, theme === 'night' ? '' : `${theme}-`)
      if (theme !== 'night') {
        await openSettings(d)
        await pickTheme(d, theme)
      }
      await screen('Против ботов, ⚙ Стол', size, async () => {
        await botsTable(d, 3)
        await d.click('⚙ Стол')
        await d.waitText('Этот стол')
        await d.waitText('Меняется между раздачами')
        await d.shot('13a-gear-stol', false)
        await d.eval(`(() => {
          const h = [...document.querySelectorAll('.gear-pop h3')].find((e) => e.innerText.trim() === 'Этот стол')
          h.scrollIntoView({ block: 'start' })
          return true
        })()`)
        await d.shot('13b-gear-etot-stol', false)
        // «Готово» закрывает, стол на месте
        await d.click('Готово')
        await waitGone(d, 'Этот стол')
      })
    }
  }
}

// npm run shots -- smotret: наблюдение за столом с ботами (#244), на телефоне и ноутбуке: в мой ход «⚙ Стол» →
// «Отойти и смотреть» (карточка — уже с «Вернуться за стол»), «Готово»; свою раздачу — «Пас», следующая — без меня
async function watchOnly(cdp: Cdp): Promise<void> {
  for (const size of SIZES.slice(0, 2)) {
    console.log(`Наблюдение за столом с ботами, ${size.width} × ${size.height}`)
    const d = await Device.open(cdp, size)
    await screen('Против ботов, наблюдение', size, async () => {
      await botsTable(d, 3)
      await d.click('⚙ Стол')
      await d.waitText('Этот стол')
      await d.click('Отойти и смотреть')
      await d.waitText('Вернуться за стол')
      await d.eval(`(() => {
        const b = [...document.querySelectorAll('.gear-pop button')].find((e) => e.innerText.trim() === 'Вернуться за стол')
        b.scrollIntoView({ block: 'center' })
        return true
      })()`)
      await d.shot('14a-nablyudenie-gear', false)
      await d.click('Готово')
      await waitGone(d, 'Этот стол')
      await watchUntilBotsPlay(d)
      await d.waitText('Вы смотрите: раздачи идут без вас')
      await d.shot('14b-nablyudenie-stol')
      // Под столом — карточка «Стол с ботами» со строкой «Вы смотрите»
      await d.eval(`(() => {
        const h = [...document.querySelectorAll('h2')].find((e) => e.innerText.trim() === 'Стол с ботами')
        h.scrollIntoView({ block: 'center' })
        return true
      })()`)
      await d.shot('14c-nablyudenie-kartochka', false)
    })
  }
}

// Наблюдение: своя раздача — «Пас» в свой ход, пока внизу не «Вы смотрите · Ждём хода» — раздача без меня
async function watchUntilBotsPlay(d: Device): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < BOTS_TIMEOUT) {
    const state = await d.eval<string>(`(() => {
      if (document.body.innerText.includes('Вы смотрите · Ждём хода')) return 'watch'
      const fold = [...document.querySelectorAll('.dock.actions button')].find((b) => b.innerText.trim() === 'Пас' && !b.disabled)
      if (fold) {
        fold.click()
        return 'fold'
      }
      return 'wait'
    })()`)
    if (state === 'watch') return
    await sleep(300)
  }
  throw new Error(`за ${BOTS_TIMEOUT / 1000} с не пошла раздача без меня — нет «Вы смотрите · Ждём хода»`)
}

// Против ботов с bots ботами (1…5) — с чистого хранилища: форма, «Начать», мой ход
async function botsTable(d: Device, bots: number): Promise<void> {
  await themeOnly(d)
  await d.goto('#/poker')
  await d.waitText('Сесть за стол')
  await d.click('Сесть за стол')
  await d.waitText('Карты ботов открыты')
  await d.click(String(bots))
  await d.click('Начать')
  await d.waitText(`Ботов: ${bots}`)
  await myTurn(d)
}

// «Панель ставок» и «Размер стола» (Р-63) — как их пишут «Настройки», в память устройства; стол читает их
// при открытии — страница перезагружается, ход остаётся
async function tableFit(d: Device, dock: 'medium' | 'large', size: number): Promise<void> {
  await d.eval(`(() => {
    localStorage.setItem('fishki.poker.dockSize', ${JSON.stringify(dock)})
    localStorage.setItem('fishki.poker.tableSize', ${JSON.stringify(String(size))})
    return true
  })()`)
  await d.reload()
  await d.waitFor('.dock.actions')
  await sleep(1500) // стол отрисован, без полёта карт
}

// Места и панель на широком окне (#210) — только 1366 и 1920: в свой ход (ползунок) на 2 места (1 бот),
// 6 (5 ботов) и 10 (стол на телефоне), на 6 и 10 — ещё «Панель ставок: Крупная» при «Размере стола» 100 и 70 %.
// Каждый стол — своё хранилище; на каждом снимке — проверка, что ни одно место не под панелью
async function wideTableStep(cdp: Cdp, size: Size): Promise<void> {
  if (size.width < 1024) return
  console.log(`Места и панель, ${size.width} × ${size.height}`)
  await screen('Против ботов, 2 места', size, async () => {
    const d = await Device.open(cdp, size)
    await botsTable(d, 1)
    await d.tableShot('10a-stol-2-mesta')
  })
  await screen('Против ботов, 6 мест', size, async () => {
    const d = await Device.open(cdp, size)
    await botsTable(d, 5)
    await d.tableShot('10b-stol-6-mest')
    await tableFit(d, 'large', 100)
    await d.tableShot('10c-stol-6-mest-krupnaya-100')
    await tableFit(d, 'large', 70)
    await d.tableShot('10d-stol-6-mest-krupnaya-70')
  })
  await screen('Стол на этом телефоне, 10 мест', size, async () => {
    const d = await Device.open(cdp, size)
    await themeOnly(d)
    await localTable(d)
    await d.tableShot('10e-stol-10-mest')
    await tableFit(d, 'large', 100)
    await d.tableShot('10f-stol-10-mest-krupnaya-100')
    await tableFit(d, 'large', 70)
    await d.tableShot('10g-stol-10-mest-krupnaya-70')
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

// Против ботов: в свой ход — «Пас», пока после него раздача не пойдёт дальше между ботами («Доиграть сразу»);
// остался один бот — раздача кончилась, ждать следующей очереди
async function foldUntilPlayOn(d: Device): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < BOTS_TIMEOUT) {
    await myTurn(d)
    await d.click('Пас')
    await sleep(300)
    if (await d.eval<boolean>(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Доиграть сразу')`)) return
  }
  throw new Error(`за ${BOTS_TIMEOUT / 1000} с после паса раздача ни разу не пошла дальше — нет «Доиграть сразу»`)
}

// Ждать, пока текст пропадёт с экрана
async function waitGone(d: Device, text: string): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < TIMEOUT) {
    if (!(await d.eval<boolean>(`document.body.innerText.includes(${JSON.stringify(text)})`))) return
    await sleep(200)
  }
  throw new Error(`«${text}» не пропало с экрана`)
}

// Коснуться своего имени у места за столом (Р-64): суммы ББ ↔ фишки
async function tapMyName(d: Device): Promise<void> {
  const done = await d.eval<boolean>(`(() => {
    const el = document.querySelector('.seat.me button.seat-name')
    if (!el) return false
    el.click()
    return true
  })()`)
  if (!done) throw new Error('нет своего места за столом')
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

// SHOTS_THEME: пусто — «Ночь» и ключевые экраны «Клуба» и «Дня»; club или day — весь сценарий в ней
function shotsTheme(): Theme {
  const raw = process.env.SHOTS_THEME ?? ''
  if (raw === '') return 'night'
  if (raw === 'night' || raw === 'club' || raw === 'day') return raw
  throw new Error(`SHOTS_THEME=${raw}: гамма — night, club или day`)
}

async function main(): Promise<void> {
  const theme = shotsTheme()
  runTheme = theme
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  console.log('Сборка сайта…')
  await build({ logLevel: 'warn' })

  const site = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' })
  const profile = await mkdtemp(join(tmpdir(), 'fishki-shots-'))
  // Картинка для своей рубашки (#220) — фишка-иконка приложения, во временный файл; удаляется с профилем
  const picture = await mkdtemp(join(tmpdir(), 'fishki-picture-'))
  ownBackPicture = join(picture, 'svoya-rubashka.png')
  await writeFile(ownBackPicture, chipIcon({ size: 512 }))
  let chrome: ChildProcess | null = null
  let cdp: Cdp | null = null
  try {
    const launched = await launchChrome(profile)
    chrome = launched.process
    cdp = await Cdp.connect(launched.url)
    const onlyTable = process.argv.includes('table') // npm run shots -- table: только места и панель (#210)
    const uchet = process.argv.includes('uchet') // npm run shots -- uchet: без столов покера (#211)
    const onlyTrainer = process.argv.includes('trainer') // npm run shots -- trainer: «Играть» и «Тренажёр» (#213)
    const onlyChoices = process.argv.includes('vybor') // npm run shots -- vybor: ряды кнопок выбора (#238)
    const onlyHistory = process.argv.includes('history') // npm run shots -- history: история раздач (#239)
    const onlyHud = process.argv.includes('hud') // npm run shots -- hud: «Боты читают» в карточке HUD (#240)
    const onlyTimeBank = process.argv.includes('zapas') // npm run shots -- zapas: запас времени в формах (#223)
    const onlyGear = process.argv.includes('gear') // npm run shots -- gear: «⚙ Стол» за столом с ботами (#243)
    const onlyNames = process.argv.includes('imena') // npm run shots -- imena: имена у мест казино на телефоне (#254)
    const onlyWatch = process.argv.includes('smotret') // npm run shots -- smotret: наблюдение за столом с ботами (#244)
    const onlyOwnBack = process.argv.includes('rubashka') // npm run shots -- rubashka: своя рубашка картинкой (#220)
    const onlyStraddle = process.argv.includes('straddl') // npm run shots -- straddl: страддл на столе на телефоне (#222)
    const part =
      onlyTrainer || onlyChoices || onlyHistory || onlyHud || onlyTimeBank || onlyGear || onlyNames || onlyWatch || onlyOwnBack || onlyStraddle
    if (onlyStraddle) for (const size of SIZES) await straddleStep(cdp, size)
    if (onlyOwnBack) await ownBackOnly(cdp)
    if (onlyNames) await namesOnly(cdp)
    if (onlyTimeBank) await timeBankOnly(cdp)
    if (onlyHud) await hudOnly(cdp)
    if (onlyGear) await gearOnly(cdp)
    if (onlyWatch) await watchOnly(cdp)
    if (onlyTrainer) await trainerOnly(cdp)
    if (onlyChoices) await choicesOnly(cdp)
    if (onlyHistory) await historyOnly(cdp)
    if (!onlyTable && !part) for (const size of SIZES) await scenario(cdp, size, theme, uchet)
    if (!onlyTable && !part) await namesOnly(cdp)
    if (!onlyTable && !uchet && !part) for (const size of SIZES) await straddleStep(cdp, size)
    if (!uchet && !part) for (const size of SIZES) await wideTableStep(cdp, size)
    if (!onlyTable && !uchet && !part) await gearOnly(cdp)
    if (!onlyTable && !uchet && !part) await watchOnly(cdp)
    if (!process.env.SHOTS_THEME && !onlyTable && !uchet && !part) {
      for (const other of ['club', 'day'] as const) for (const size of SIZES) await themeScenario(cdp, size, other)
    }
    console.log('Готово: снимки в', OUT)
  } finally {
    if (cdp) {
      await cdp.send('Browser.close').catch(() => undefined)
      cdp.close()
    }
    chrome?.kill('SIGKILL')
    await site.close()
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    await rm(picture, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
