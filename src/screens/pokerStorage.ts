import type { Seat } from '../calc/pokerLink'

// Покер онлайн: пароль компании, свой адрес сервера, места в комнатах и «кто я» ведущего —
// данные этого устройства, а не игр: в localStorage, не в IndexedDB и не в копию (Р-19)
const PASSWORD_KEY = 'fishki.poker.password'
const SERVER_KEY = 'fishki.poker.server'
const SEATS_KEY = 'fishki.poker.seats'
const ME_KEY = 'fishki.poker.me'

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
