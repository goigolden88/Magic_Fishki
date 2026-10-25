// Покер онлайн: адрес сервера, ссылка на комнату, понятные слова для отказов сервера.
// Без сети и без браузера — проверяется тестами
import {
  CLOSE_ENDED,
  CLOSE_NO_ROOM,
  CLOSE_REPLACED,
  CLOSE_VERSION,
  NO_ROOM,
  VERSION_ERROR,
  WRONG_PASSWORD,
} from '../poker/protocol'

// Постоянный сервер комнат (Worker из #58); в настройках можно вписать другой
export const DEFAULT_SERVER = 'https://fishki-poker.goigolden88.workers.dev'

export const NO_CONNECTION = 'Нет связи с сервером'
export const ROOM_CLOSED = 'Комната закрыта'
export const UPDATE_APP = 'Обновите приложение'

// Место игрока за столом: с ним — возврат без повторного выбора
export type Seat = { playerId: string; token: string }

// Вписанный адрес: пусто — постоянный; без http(s):// или с пробелами — не адрес
export function serverBase(custom: string): string | null {
  const text = custom.trim().replace(/\/+$/, '')
  if (!text) return DEFAULT_SERVER
  return /^https?:\/\/[^\s/]+(\/\S*)?$/.test(text) ? text : null
}

export function roomsUrl(base: string): string {
  return `${base}/rooms`
}

export function socketUrl(base: string, code: string): string {
  return `${base.replace(/^http/, 'ws')}/rooms/${encodeURIComponent(code)}`
}

// Код комнаты — 6 знаков, буквы и цифры (регистр не важен)
export function normalizeCode(text: string): string | null {
  const code = text.trim().toUpperCase()
  return /^[A-Z0-9]{6}$/.test(code) ? code : null
}

// Адрес внутри сайта: #/poker/КОД, с местом — #/poker/КОД/игрок/токен («пересадить»)
export function roomHash(code: string, seat?: Seat): string {
  return seat ? `#/poker/${code}/${seat.playerId}/${seat.token}` : `#/poker/${code}`
}

// Ссылка, которую ведущий кидает в чат: адрес сайта без ?app=… и с адресом комнаты
export function roomLink(siteUrl: string, code: string, seat?: Seat): string {
  return siteUrl.replace(/[?#].*$/, '') + roomHash(code, seat)
}

// Вставленная ссылка или просто код → комната и, если есть, место
export function parseRoomLink(text: string): { code: string; seat?: Seat } | null {
  const trimmed = text.trim()
  const m = /#\/poker\/([^/\s]+)(?:\/([^/\s]+)\/([^/\s]+))?\s*$/.exec(trimmed)
  if (!m) {
    const code = normalizeCode(trimmed)
    return code ? { code } : null
  }
  const code = normalizeCode(decodeURIComponent(m[1]))
  if (!code) return null
  return m[2] && m[3] ? { code, seat: { playerId: decodeURIComponent(m[2]), token: decodeURIComponent(m[3]) } } : { code }
}

// Отказ при создании комнаты → что сказать ведущему
export type CreateFailure = { kind: 'password' | 'update' | 'other'; text: string }

export function createFailure(error: string): CreateFailure {
  if (error === WRONG_PASSWORD) return { kind: 'password', text: 'Неверный пароль компании — введите снова' }
  if (error === VERSION_ERROR) return { kind: 'update', text: `${UPDATE_APP}: версия сервера новее` }
  return { kind: 'other', text: error }
}

// Соединение закрыто сервером: конец комнаты, старая версия, вход с другого устройства;
// остальное (обрыв сети, сон телефона) — переподключаться
export type CloseKind = 'closed' | 'update' | 'replaced' | 'retry'

export function closeKind(code: number): CloseKind {
  if (code === CLOSE_ENDED || code === CLOSE_NO_ROOM) return 'closed'
  if (code === CLOSE_VERSION) return 'update'
  if (code === CLOSE_REPLACED) return 'replaced'
  return 'retry'
}

// Ошибка сервера в соединении: конец комнаты и версия — свои экраны, остальное — строкой
export function errorKind(error: string): 'closed' | 'update' | 'message' {
  if (error === NO_ROOM) return 'closed'
  if (error === VERSION_ERROR) return 'update'
  return 'message'
}

// Пауза перед новой попыткой связи: 1, 2, 4, 8 секунд, дальше — каждые 10
export function retryDelay(attempt: number): number {
  return Math.min(10_000, 1000 * 2 ** Math.max(0, attempt))
}
