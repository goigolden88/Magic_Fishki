// Снимки экранов для отчёта PR (Ш-202 Штаба, #182): npm run shots.
// Собирает сайт (vite build), поднимает vite preview (порт 4173) и ведёт Chrome без окна по экранам:
// «Настройки» → демо-игры, «Игры», «Игроки», «Вид стола» в «Настройках», «Играть», «Стол на этом телефоне»
// (10 гостей, панель хода), «Против ботов» (мой ход, панель хода), «Казино» (столы идут; на телефоне — ещё
// на шестерых), «Справка».
// Сервер комнат не нужен — всё без сети; комнаты на снимках нет. Демо-игры и гости — выдуманные (src/calc/demo.ts).
// Chrome — по DevTools-протоколу (обычный --screenshot не умеет нажимать кнопки), без сторонних библиотек.
// Размеры: 390 × 844 (телефон), 1366 × 768 (ноутбук), 1920 × 1080 (монитор); у каждого — своё хранилище.
// PNG — в shots/ (не в репо), имя — «ширина-номер-экран.png». Сбой — код выхода 1 и строка, какой экран.
// Гамма (Р-70): весь сценарий — в «Ночи», а затем «Клуб» и «День» — «Настройки», «Игры», «Играть», стол против ботов
// и «Играть» с полосой «Продолжить» (#209) («ширина-гамма-номер-экран.png»). SHOTS_THEME=club или day — весь сценарий в этой гамме (имена прежние), без остальных.
// Гамма выбирается касанием в «Настройках», как у человека.
// Шрифты (#218): снимок — после document.fonts.ready; на первом экране каждого размера оба шрифта должны быть загружены.
// Стол на широком окне (#210): на каждом снимке стола на 1366 и 1920 — проверка, что ни одно место (.seat) не под
// панелью хода (.table-dock), иначе сбой; ещё — свой шаг «Места и панель» (2, 6 и 10 мест, «Крупная» при 100 и 70 %).
// npm run shots -- table — только этот шаг.
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
const GUESTS = ['Аня', 'Боря', 'Вика', 'Гоша', 'Даша', 'Егор', 'Женя', 'Зоя', 'Илья', 'Катя'] // выдуманные гости стола
const BOTS_TIMEOUT = 60_000 // боты ходят через секунду; моя очередь может прийти не в первой раздаче
type Theme = 'night' | 'club' | 'day'
const THEME_BUTTONS: Record<Theme, string> = { night: 'Ночь', club: 'Клуб', day: 'День' } // кнопки «Оформления»
const FONTS = ['Golos Text', 'Geologica'] // шрифты приложения (src/fonts, #218): текст и заголовки

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

  private constructor(cdp: Cdp, session: string, size: Size, prefix: string) {
    this.cdp = cdp
    this.session = session
    this.size = size
    this.prefix = prefix
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

  private metrics(height: number): Promise<unknown> {
    const { width } = this.size
    return this.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, this.session)
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
    if (height > this.size.height) await this.metrics(this.size.height)
    const path = join(OUT, `${this.size.name}-${this.prefix}${file}.png`)
    await writeFile(path, Buffer.from(data, 'base64'))
    console.log('  снимок', path)
  }

  // Снимок стола покера — первый экран; на широком окне (#210) сначала — ни одно место не под панелью хода
  async tableShot(file: string): Promise<void> {
    await sleep(400) // перерисовка
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

// «Настройки»: гамма — касанием в «Оформлении» («Ночь» не выбрана — как у того, кто не выбирал), снимок, демо-игры
async function settingsStep(d: Device, theme: Theme): Promise<void> {
  await screen('Настройки', d.size, async () => {
    await d.goto('#/settings')
    await d.waitText('Добавить демо-данные')
    await d.fontsLoaded() // первый экран каждого размера
    if (theme !== 'night') {
      await d.click(THEME_BUTTONS[theme])
      await d.waitFor(`html[data-theme="${theme}"]`)
    }
    await d.shot('05-nastroyki')
    // Демо-игры (Р-04) — для «Игр» и казино
    await d.click('Добавить демо-данные')
    await d.waitText('Добавлено демо-игр')
  })
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

async function scenario(cdp: Cdp, size: Size, theme: Theme): Promise<void> {
  console.log(`Размер ${size.width} × ${size.height}`)
  const d = await Device.open(cdp, size)

  await settingsStep(d, theme)
  await gamesStep(d)

  await screen('Игроки', size, async () => {
    await d.goto('#/players')
    await d.waitFor('main h1')
    await d.shot('07-igroki')
  })

  // «Вид стола» в «Настройках»: на широком окне — ещё размер стола и панели ставок (Р-63)
  await screen('Вид стола', size, async () => {
    await d.goto('#/settings')
    await d.waitText('Выбрать вид стола')
    await d.click('Выбрать вид стола')
    await d.waitText('Колода')
    if (size.width >= 1024) await d.waitText('Размер стола')
    await d.shot('08-vid-stola')
  })

  await playStep(d)

  await screen('Против ботов', size, async () => {
    await d.click('Сесть за стол')
    await d.waitText('Карты ботов открыты')
    await d.waitText('После паса — сразу доигрывать')
    await d.shot('03a-protiv-botov-forma')
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

  await screen('Справка', size, async () => {
    await d.goto('#/help')
    await d.waitFor('details.card.help')
    await d.shot('06-spravka')
  })
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

// Против ботов с bots ботами (1…5) — с чистого хранилища: форма, «Начать», мой ход
async function botsTable(d: Device, bots: number): Promise<void> {
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
    const onlyTable = process.argv.includes('table') // npm run shots -- table: только места и панель (#210)
    if (!onlyTable) for (const size of SIZES) await scenario(cdp, size, theme)
    for (const size of SIZES) await wideTableStep(cdp, size)
    if (!process.env.SHOTS_THEME && !onlyTable) {
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
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
