// Незаписанный раунд казино-стола на устройстве (#151): раздача, ставка и сколько столов открыто —
// отдельно для каждой игры, в localStorage. Здесь — что хранится, разбор сохранённого (битое и чужое — null)
// и отсчёт открытия столов после возврата: карты уже лежат, автооткрытие на паузе до касания
import { buildDeck } from '../poker/cards'
import { BOARD_CARDS, DEAL_KINDS, MIN_DEAL_PLAYERS, type Deal, type DealKind } from './casinoDeal'
import type { Reveal } from './casinoReveal'

export type SavedCasinoRound = {
  v: 1
  gameId: string
  deal: Deal
  stake: number // копеек с каждого
  opened: number // столов открыто
}

export function savedCasinoRound(gameId: string, deal: Deal, stake: number, opened: number): SavedCasinoRound {
  return { v: 1, gameId, deal, stake, opened }
}

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string')

// Раунд этой игры из памяти устройства. Участники — из игры (players — id её участников), карты — из колоды
// варианта и без повторов, столов открыто — не больше, чем есть; иначе null
export function parseSavedCasinoRound(text: string, gameId: string, players: string[]): SavedCasinoRound | null {
  let x: unknown
  try {
    x = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof x !== 'object' || x === null) return null
  const o = x as Record<string, unknown>
  if (o.v !== 1 || o.gameId !== gameId) return null
  const { stake, opened } = o
  if (!Number.isSafeInteger(stake) || (stake as number) <= 0) return null
  const deal = parseDeal(o.deal, players)
  if (!deal) return null
  if (!Number.isInteger(opened) || (opened as number) < 0 || (opened as number) > deal.boards.length) return null
  return savedCasinoRound(gameId, deal, stake as number, opened as number)
}

function parseDeal(x: unknown, players: string[]): Deal | null {
  if (typeof x !== 'object' || x === null) return null
  const o = x as Record<string, unknown>
  const kind = Object.keys(DEAL_KINDS).find((k) => k === o.kind) as DealKind | undefined
  if (!kind) return null
  const { ids, hands, boards } = o
  if (!isStrings(ids) || ids.length < MIN_DEAL_PLAYERS || new Set(ids).size !== ids.length) return null
  if (!ids.every((id) => players.includes(id))) return null
  if (typeof hands !== 'object' || hands === null) return null
  const handOf = (id: string) => (hands as Record<string, unknown>)[id]
  const hand = DEAL_KINDS[kind].hand
  const own = ids.map(handOf)
  if (!own.every((h): h is string[] => isStrings(h) && h.length === hand)) return null
  if (!Array.isArray(boards) || boards.length < 1) return null
  if (!boards.every((b): b is string[] => isStrings(b) && b.length === BOARD_CARDS)) return null
  const deck = new Set(buildDeck(DEAL_KINDS[kind].variant))
  const all = [...own.flat(), ...boards.flat()]
  if (!all.every((c) => deck.has(c)) || new Set(all).size !== all.length) return null
  return {
    kind,
    ids: [...ids],
    hands: Object.fromEntries(ids.map((id, i) => [id, [...own[i]]])),
    boards: boards.map((b) => [...b]),
  }
}

// Отсчёт после возврата: открытые столы — целиком, без переворота; столы сами (every) — на паузе до «Продолжить»
export function restoredReveal(total: number, opened: number, every: number | null, flip: number, now: number): Reveal {
  return {
    total,
    every,
    flip,
    opened,
    turnAt: now - flip,
    due: null,
    held: null,
    paused: every !== null && opened < total,
  }
}
