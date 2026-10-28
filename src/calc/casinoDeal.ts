// Раунд казино с картами (#76): программа раздаёт участникам карты в открытую и N столов по 5 карт
// из одной колоды; часть банка каждого стола — лучшей руке на нём. Итог — обычный раунд казино (Р-13)
import { bestHand, buildDeck, HOLDEM, OMAHA, winners, type Card, type Variant } from '../poker/cards'
import { shuffle } from '../poker/game'
import type { RandomBytes } from '../poker/tokens'
import type { ParsedRound } from './casino'

export type DealKind = 'holdem' | 'omaha'

// Вариант раунда: правило руки — из cards.ts, карт в руке — своё
export const DEAL_KINDS: Record<DealKind, { variant: Variant; hand: number; label: string }> = {
  holdem: { variant: HOLDEM, hand: 2, label: 'Холдем' },
  omaha: { variant: OMAHA, hand: 4, label: 'Омаха' },
}

export const BOARD_CARDS = 5 // карт на столе
export const DEFAULT_TABLES = 5
export const DEFAULT_STAKE = 10_000 // копеек — 100 ₽, пока на устройстве нет ставки прошлого раунда
export const MIN_DEAL_PLAYERS = 2

export function deckSize(kind: DealKind): number {
  return buildDeck(DEAL_KINDS[kind].variant).length
}

// Карт из колоды: участники × карты руки + столы × 5
export function cardsUsed(kind: DealKind, players: number, tables: number): number {
  return players * DEAL_KINDS[kind].hand + tables * BOARD_CARDS
}

// Больше столов колоды не хватит; 0 — не хватит и на один
export function maxTables(kind: DealKind, players: number): number {
  return Math.max(0, Math.floor((deckSize(kind) - players * DEAL_KINDS[kind].hand) / BOARD_CARDS))
}

// Больше участников при стольких столах колоды не хватит
export function maxPlayers(kind: DealKind, tables: number): number {
  return Math.max(0, Math.floor((deckSize(kind) - tables * BOARD_CARDS) / DEAL_KINDS[kind].hand))
}

export type Deal = {
  kind: DealKind
  ids: string[] // участники по порядку — он же порядок копеек остатка
  hands: Record<string, Card[]>
  boards: Card[][]
}

// Раздача из готовой колоды: в руки по одной по кругу, затем столы по 5 карт подряд
export function dealFromDeck(kind: DealKind, ids: string[], tables: number, deck: Card[]): Deal {
  if (new Set(ids).size !== ids.length) throw new Error('Участник раунда повторяется')
  if (ids.length < MIN_DEAL_PLAYERS) throw new Error(`Участников меньше ${MIN_DEAL_PLAYERS}`)
  if (!Number.isInteger(tables) || tables < 1) throw new Error('Столов должно быть не меньше одного')
  if (cardsUsed(kind, ids.length, tables) > deck.length) throw new Error('Карт одной колоды не хватит')
  const rest = [...deck]
  const hands: Record<string, Card[]> = Object.fromEntries(ids.map((id) => [id, []]))
  for (let k = 0; k < DEAL_KINDS[kind].hand; k++) for (const id of ids) hands[id].push(rest.shift() as Card)
  const boards = Array.from({ length: tables }, () => rest.splice(0, BOARD_CARDS))
  return { kind, ids: [...ids], hands, boards }
}

// Раздача из перетасованной колоды варианта (Web Crypto; random — для тестов)
export function newDeal(kind: DealKind, ids: string[], tables: number, random?: RandomBytes): Deal {
  return dealFromDeck(kind, ids, tables, shuffle(buildDeck(DEAL_KINDS[kind].variant), random))
}

export type BoardResult = {
  winners: string[] // лучшая рука на столе; ничья — несколько, в порядке участников
  hand: string // «Флеш, старший туз»
  best: Record<string, Card[]> // у каждого победителя — лучшая пятёрка: сначала карты комбинации, затем кикеры (#96)
}

export function boardResult(deal: Deal, index: number): BoardResult {
  const { variant } = DEAL_KINDS[deal.kind]
  const board = deal.boards[index]
  const ids = winners(
    variant,
    board,
    deal.ids.map((id) => ({ id, cards: deal.hands[id] })),
  )
  const results = ids.map((id) => bestHand(variant, deal.hands[id], board))
  return {
    winners: ids,
    hand: results[0].name,
    best: Object.fromEntries(ids.map((id, i) => [id, results[i].cards])),
  }
}

// Часть банка на каждый стол: поровну, копейки остатка — по одной первым столам
export function tableParts(pot: number, tables: number): number[] {
  const base = Math.floor(pot / tables)
  return Array.from({ length: tables }, (_, i) => base + (i < pot % tables ? 1 : 0))
}

export type RoundShare = { id: string; won: number; net: number } // копеек: выиграл и выиграл минус ставка

// Итог раунда: банк = ставка × участников, часть стола — его победителям поровну,
// копейки остатка — по одной по порядку победителей. Сумма net — ноль
export function roundShares(stake: number, ids: string[], boardWinners: string[][]): RoundShare[] {
  const won = new Map(ids.map((id) => [id, 0]))
  const parts = tableParts(stake * ids.length, boardWinners.length)
  boardWinners.forEach((ws, t) => {
    const each = Math.floor(parts[t] / ws.length)
    ws.forEach((id, i) => won.set(id, (won.get(id) ?? 0) + each + (i < parts[t] % ws.length ? 1 : 0)))
  })
  return ids.map((id) => ({ id, won: won.get(id) ?? 0, net: (won.get(id) ?? 0) - stake }))
}

// Раунд по именам — для addRound, как введённый строкой
export function sharesToRound(shares: RoundShare[], nameById: Map<string, string>): ParsedRound {
  const amounts = shares.map((s) => ({ name: nameById.get(s.id) ?? '', kopecks: s.net }))
  return { amounts, sum: amounts.reduce((s, a) => s + a.kopecks, 0), bad: [] }
}
