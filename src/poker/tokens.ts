// Токен возврата: игрок после обрыва или перезагрузки садится на своё место.
// Токен — секрет владельца места; знать id игрока мало. Карту «игрок → токен» хранит сервер.
// Случайность — Web Crypto (есть и в браузере, и в Workers); для тестов — параметром
import type { TableState } from './table'

export type RandomBytes = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

export function issueToken(random: RandomBytes = (b) => crypto.getRandomValues(b)): string {
  return [...random(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type RejoinReason = 'noCreds' | 'unknownPlayer' | 'badToken' | 'notSeated'

export function canRejoin(
  tokens: Record<string, string>,
  table: TableState,
  playerId: string,
  token: string,
): { ok: true } | { ok: false; reason: RejoinReason } {
  if (!playerId || !token) return { ok: false, reason: 'noCreds' }
  const expected = tokens[playerId]
  if (!expected) return { ok: false, reason: 'unknownPlayer' }
  if (expected !== token) return { ok: false, reason: 'badToken' }
  if (!table.players.some((p) => p.id === playerId)) return { ok: false, reason: 'notSeated' }
  return { ok: true }
}
