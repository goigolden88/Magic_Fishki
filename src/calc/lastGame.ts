// Полоса «Продолжить» на «Играть» (#209): последняя открытая незаконченная игра этого телефона —
// стол против ботов, стол на этом телефоне или комната со своим местом. Запись — в localStorage
// (`fishki.poker.last`, src/screens/pokerStorage.ts), в копию не идёт. Здесь — разбор записи и слова полосы
import { dayOf } from '../dates'
import type { TableState } from '../poker/table'
import { daysAgoText, formatNumber, pluralForm } from './format'
import { serverBase } from './pokerLink'
import { GAME_CHOICES } from './quickRoom'

export type LastGameKind = 'bots' | 'local' | 'room'

// at — когда открыт стол, мс; code и server — только у комнаты (server — не постоянный сервер)
export type LastGame = { kind: LastGameKind; at: number; code?: string; server?: string }

const KINDS: readonly unknown[] = ['bots', 'local', 'room']

// Запись из памяти браузера: кривая — null, полосы нет
export function parseLastGame(raw: unknown): LastGame | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { kind, at, code, server } = raw as Record<string, unknown>
  if (!KINDS.includes(kind) || typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null
  if (kind !== 'room') return { kind: kind as LastGameKind, at }
  if (typeof code !== 'string' || code.trim() === '') return null
  const base = typeof server === 'string' && server.trim() ? serverBase(server) : null
  return base ? { kind, at, code, server: base } : { kind, at, code }
}

// Запись про этот стол: у ботов и стола на телефоне стол один, у комнаты — по коду
export function isLastGame(game: LastGame | null, kind: LastGameKind, code?: string): boolean {
  return game !== null && game.kind === kind && (kind !== 'room' || game.code === code)
}

// «холдем 5/10», «омаха 25/50»
function gameText(table: Pick<TableState, 'settings'>): string {
  const s = table.settings
  const name = GAME_CHOICES.find(([id]) => id === (s.game ?? 'holdem'))?.[1] ?? 'Холдем'
  return `${name.toLowerCase()} ${formatNumber(s.sb)}/${formatNumber(s.bb)}`
}

// Слова полосы: крупно — «Против ботов · холдем 5/10», «Стол на телефоне · холдем 5/10» или «Комната KQ7MZP»;
// под ним — «6 мест · раздач 43 · вчера», у комнаты — только когда. table — стол ботов или на телефоне
export function lastGameText(
  game: LastGame,
  table: Pick<TableState, 'settings' | 'handCount'> | null,
  today: string,
): { title: string; line: string } {
  const when = daysAgoText(dayOf(game.at), today)
  if (game.kind === 'room') return { title: `Комната ${game.code ?? ''}`.trim(), line: when }
  const name = game.kind === 'bots' ? 'Против ботов' : 'Стол на телефоне'
  if (!table) return { title: name, line: when }
  const seats = table.settings.maxSeats
  return {
    title: `${name} · ${gameText(table)}`,
    line: `${seats} ${pluralForm(seats, 'место', 'места', 'мест')} · раздач ${formatNumber(table.handCount)} · ${when}`,
  }
}
