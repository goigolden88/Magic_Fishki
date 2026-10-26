// Обычные запросы к серверу: строка «работает» и создание комнаты по паролю компании.
// Без привязки к Cloudflare — реестр и комнату даёт index.ts, в тестах — подделки
import { PROTOCOL_VERSION, VERSION_ERROR, WRONG_PASSWORD, type CreateRoomResponse, type RosterEntry } from '../../src/poker/protocol'
import type { Settings } from '../../src/poker/table'

// «Неверный пароль» — общий с экраном, в протоколе
export { WRONG_PASSWORD }

export const STATUS_TEXT = `Сервер покера «Фишек» работает, протокол ${PROTOCOL_VERSION}`
export const NO_PASSWORD = 'На сервере не задан пароль'

// Больше постоянных в списке комнаты не берём: столько за столом не сядет
export const MAX_ROSTER = 30

export type CreateDeps = {
  password: string | undefined // секрет ROOM_PASSWORD
  reserve: () => Promise<{ ok: true; code: string } | { ok: false; error: string }>
  init: (
    code: string,
    name: unknown,
    settings: Partial<Settings>,
    roster: RosterEntry[],
    regularId: string | null,
  ) => Promise<{ ok: true; playerId: string; token: string } | { ok: false; error: string }>
  release: (code: string) => Promise<void>
}

export async function createRoom(body: unknown, deps: CreateDeps): Promise<{ status: number; body: CreateRoomResponse }> {
  const fail = (status: number, error: string) => ({ status, body: { v: PROTOCOL_VERSION, error } })
  if (!isRecord(body) || body.v !== PROTOCOL_VERSION) return fail(400, VERSION_ERROR)
  if (!deps.password) return fail(503, NO_PASSWORD)
  if (typeof body.password !== 'string' || !samePassword(body.password, deps.password)) return fail(403, WRONG_PASSWORD)
  const reserved = await deps.reserve()
  if (!reserved.ok) return fail(409, reserved.error)
  const roster = pickRoster(body.roster)
  const regularId = roster.some((r) => r.id === body.regularId) ? (body.regularId as string) : null
  const created = await deps.init(reserved.code, body.name, pickSettings(body.settings), roster, regularId)
  if (!created.ok) {
    await deps.release(reserved.code)
    return fail(400, created.error)
  }
  return { status: 200, body: { v: PROTOCOL_VERSION, code: reserved.code, playerId: created.playerId, token: created.token } }
}

// Сайт живёт на другом адресе (GitHub Pages) — браузеру нужно разрешение
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  })
}

// Из настроек — только известные поля; проверяет их сам стол (createTable)
function pickSettings(x: unknown): Partial<Settings> {
  if (!isRecord(x)) return {}
  const out: Record<string, unknown> = {}
  for (const key of ['sb', 'bb', 'startingStack', 'maxSeats', 'rebuyMaxBB', 'cards'] as const) {
    if (key in x) out[key] = x[key]
  }
  return out as Partial<Settings>
}

// Список постоянных: только { id, name } со строками, имя без пробелов по краям, id без повторов
function pickRoster(x: unknown): RosterEntry[] {
  if (!Array.isArray(x)) return []
  const out: RosterEntry[] = []
  for (const r of x) {
    if (!isRecord(r) || typeof r.id !== 'string' || !r.id || typeof r.name !== 'string') continue
    const name = r.name.trim()
    if (!name || out.some((o) => o.id === r.id)) continue
    out.push({ id: r.id, name })
    if (out.length === MAX_ROSTER) break
  }
  return out
}

// Сравнение без раннего выхода: время ответа не подсказывает, сколько знаков угадано
function samePassword(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]
  return diff === 0
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
