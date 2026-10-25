import type { Seat } from '../calc/pokerLink'

// Покер онлайн: пароль компании, свой адрес сервера, места в комнатах, «кто я» ведущего и записанные итоги —
// данные этого устройства, а не игр: в localStorage, не в IndexedDB и не в копию (Р-19)
const PASSWORD_KEY = 'fishki.poker.password'
const SERVER_KEY = 'fishki.poker.server'
const SEATS_KEY = 'fishki.poker.seats'
const ME_KEY = 'fishki.poker.me'
const GAMES_KEY = 'fishki.poker.games'

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

// Кто из постоянных — ведущий на этом телефоне: отмечен в новой комнате сразу
export const loadMe = () => read(ME_KEY)
export const saveMe = (regularId: string) => write(ME_KEY, regularId)

// Места по кодам комнат: с ним возврат на своё место без выбора
export function loadSeats(): Record<string, Seat> {
  try {
    const parsed: unknown = JSON.parse(read(SEATS_KEY) || '{}')
    const out: Record<string, Seat> = {}
    if (parsed && typeof parsed === 'object') {
      for (const [code, seat] of Object.entries(parsed as Record<string, unknown>)) {
        const { playerId, token } = (seat ?? {}) as Record<string, unknown>
        if (typeof playerId === 'string' && typeof token === 'string') out[code] = { playerId, token }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function loadSeat(code: string): Seat | null {
  return loadSeats()[code] ?? null
}

export function saveSeat(code: string, seat: Seat | null) {
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
