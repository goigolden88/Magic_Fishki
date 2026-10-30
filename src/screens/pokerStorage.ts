import { parseBotTable, type BotTable } from '../calc/botTable'
import { parseLocalTable, type LocalTable } from '../calc/localTable'
import { serverBase, type SavedSeat } from '../calc/pokerLink'

// Покер онлайн: пароль компании, свой адрес сервера, места в комнатах, «кто я» ведущего, записанные итоги,
// звук «ваш ход», «карты всегда открыты», стол на этом телефоне и стол против ботов — данные этого устройства,
// а не игр: в localStorage, не в IndexedDB и не в копию (Р-19, Р-21, Р-38)
const PASSWORD_KEY = 'fishki.poker.password'
const SERVER_KEY = 'fishki.poker.server'
const SEATS_KEY = 'fishki.poker.seats'
const ME_KEY = 'fishki.poker.me'
const GAMES_KEY = 'fishki.poker.games'
const LOCAL_KEY = 'fishki.poker.local'
const BOTS_KEY = 'fishki.poker.bots'
const CHECK_KEY = 'fishki.poker.check'
const SOUND_KEY = 'fishki.poker.sound'
const OPEN_KEY = 'fishki.poker.open'

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // нет места или запрещено — просто не запомним
  }
}

export const loadPassword = () => read(PASSWORD_KEY)
export const savePassword = (password: string) => write(PASSWORD_KEY, password)

// Свой адрес сервера; пусто — постоянный
export const loadServer = () => read(SERVER_KEY)
export const saveServer = (server: string) => write(SERVER_KEY, server.trim())

// Звук «ваш ход» на этом устройстве (#75); сначала — включён
export const loadTurnSound = () => read(SOUND_KEY) !== 'off'
export const saveTurnSound = (on: boolean) => write(SOUND_KEY, on ? '' : 'off')

// «Карты всегда открыты» на этом устройстве (#86): свои карты лицом без пальца; сначала — выключено
export const loadOpenCards = () => read(OPEN_KEY) === 'on'
export const saveOpenCards = (on: boolean) => write(OPEN_KEY, on ? 'on' : '')

// Кто из постоянных — ведущий на этом телефоне: отмечен в новой комнате сразу
export const loadMe = () => read(ME_KEY)
export const saveMe = (regularId: string) => write(ME_KEY, regularId)

// Места по кодам комнат: с ним возврат на своё место без выбора. Сервер комнаты (#83) — необязательное поле:
// места, запомненные раньше, его не имеют и читаются как были
export function loadSeats(): Record<string, SavedSeat> {
  try {
    const parsed: unknown = JSON.parse(read(SEATS_KEY) || '{}')
    const out: Record<string, SavedSeat> = {}
    if (parsed && typeof parsed === 'object') {
      for (const [code, seat] of Object.entries(parsed as Record<string, unknown>)) {
        const { playerId, token, server } = (seat ?? {}) as Record<string, unknown>
        if (typeof playerId !== 'string' || typeof token !== 'string') continue
        const base = typeof server === 'string' && server.trim() ? serverBase(server) : null
        out[code] = base ? { playerId, token, server: base } : { playerId, token }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function loadSeat(code: string): SavedSeat | null {
  return loadSeats()[code] ?? null
}

export function saveSeat(code: string, seat: SavedSeat | null) {
  const seats = loadSeats()
  if (seat) seats[code] = seat
  else delete seats[code]
  write(SEATS_KEY, Object.keys(seats).length ? JSON.stringify(seats) : '')
}

// Итог какого стола уже записан игрой: «код/место» → id игры. Повторное «Закончить игру»
// второй игры не пишет. Место — потому что код освобождается и достаётся новой комнате
const GAMES_KEPT = 20

function loadGames(): [string, string][] {
  try {
    const parsed: unknown = JSON.parse(read(GAMES_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string')
      : []
  } catch {
    return []
  }
}

export function loadRecordedGame(code: string, playerId: string): string | null {
  return loadGames().find(([key]) => key === `${code}/${playerId}`)?.[1] ?? null
}

export function saveRecordedGame(code: string, playerId: string, gameId: string) {
  const key = `${code}/${playerId}`
  const games = [...loadGames().filter(([k]) => k !== key), [key, gameId] as [string, string]].slice(-GAMES_KEPT)
  write(GAMES_KEY, JSON.stringify(games))
}

// Стол на этом телефоне (Р-21): один на устройстве, весь стол целиком — после каждого изменения.
// Копия — и в памяти страницы: без памяти браузера (приватный режим) стол живёт до закрытия
let localTable: LocalTable | null | undefined // undefined — ещё не читали

export function loadLocalTable(): LocalTable | null {
  if (localTable === undefined) localTable = parseLocalTable(read(LOCAL_KEY))
  return localTable
}

// false — память браузера не приняла: после закрытия стол пропадёт
export function saveLocalTable(local: LocalTable): boolean {
  localTable = local
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local))
    return true
  } catch {
    return false
  }
}

export function clearLocalTable() {
  localTable = null
  write(LOCAL_KEY, '')
}

// Стол против ботов (#117, Р-38): свой ключ — со «Столом на этом телефоне» не мешают друг другу.
// Так же: весь стол после каждого хода, копия — в памяти страницы
let botTable: BotTable | null | undefined // undefined — ещё не читали

export function loadBotTable(): BotTable | null {
  if (botTable === undefined) botTable = parseBotTable(read(BOTS_KEY))
  return botTable
}

// false — память браузера не приняла: после закрытия стол пропадёт
export function saveBotTable(bots: BotTable): boolean {
  botTable = bots
  try {
    localStorage.setItem(BOTS_KEY, JSON.stringify(bots))
    return true
  } catch {
    return false
  }
}

export function clearBotTable() {
  botTable = null
  write(BOTS_KEY, '')
}

// Память браузера работает: записать и прочитать
export function storageWorks(): boolean {
  try {
    localStorage.setItem(CHECK_KEY, '1')
    const back = localStorage.getItem(CHECK_KEY)
    localStorage.removeItem(CHECK_KEY)
    return back === '1'
  } catch {
    return false
  }
}
