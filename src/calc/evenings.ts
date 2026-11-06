// Прошлые вечера (#114, Р-37): копия раздач вечера на телефоне. Каждая раздача — записью
// хранилища hands (store/db.ts) под ключом «вечер + номер»: та же раздача второй раз заменяет
// запись, а не дописывается. Здесь — чем вечер назван, что записать и как показать список
import type { Card } from '../poker/cards'
import { limitFor, type TableState } from '../poker/table'
import type { GameId, Limit } from '../poker/game'
import type { HistoryHand } from '../poker/history'

// Вечер — один стол: комната по коду, стол на этом телефоне или против ботов (code — null).
// table — что нужно выгрузке (Р-54); у записей до неё поля нет
export type Evening = {
  id: string
  code: string | null
  startedAt: number // мс — закуп ведущего при создании стола
  table?: EveningTable
}

// Стол вечера для выгрузки раздач (Р-54): чей это телефон, игра и блайнды. У раздач с картами
// на телефонах блайнды — из записи раздачи; эти — для живых карт, где записи нет
export type EveningTable = {
  me: string | null // игрок этого телефона; стол на одном телефоне — null: ходят за всех
  game: GameId
  limit: Limit
  sb: number
  bb: number
  ante: number
  maxSeats: number
  tournament: boolean // в турнире блайнды растут — sb и bb только стартовые
  // Постоянные стола (#164, Р-55): id игрока за столом → id постоянного, с ушедшими; кого нет — гость.
  // Покеру за всё время — отличить гостя от постоянного с тем же именем. У записей до Р-55 поля нет
  regulars?: Record<string, string>
}

// Запись хранилища: раздача и её вечер; раздача — как пришла за столом (HistoryHand).
// mine — свои карты этого телефона в раздаче (Р-54): запись раздачи карт сбросивших не хранит
export type SavedHand = {
  evening: string
  code: string | null
  startedAt: number
  number: number
  hand: HistoryHand
  table?: EveningTable
  mine?: Card[]
}

export type EveningSummary = Evening & { hands: number } // hands — сколько раздач записано

// Начало стола — первая запись журнала фишек: закуп ведущего при создании (createTable)
function startOf(table: TableState): number {
  return table.chipLog[0]?.at ?? 0
}

export function eveningTable(table: TableState, me: string | null): EveningTable {
  const s = table.settings
  return {
    me,
    game: s.game ?? 'holdem',
    limit: limitFor(s),
    sb: s.sb,
    bb: s.bb,
    ante: s.format === 'tournament' ? 0 : (s.ante ?? 0),
    maxSeats: s.maxSeats,
    tournament: s.format === 'tournament',
    regulars: tableRegulars(table),
  }
}

// Ушедшие — из записи ухода (у записей до #60 постоянного в ней нет), сидящие — из стола
function tableRegulars(table: TableState): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of table.chipLog) if (e.kind === 'leave' && e.regularId) out[e.playerId] = e.regularId
  for (const p of table.players) if (p.regularId) out[p.id] = p.regularId
  return out
}

// Комната: код комнаты не уникален во времени (освобождается после конца) — вечер по коду и началу стола.
// me — игрок этого телефона за столом
export function roomEvening(code: string, table: TableState, me: string | null): Evening {
  const startedAt = startOf(table)
  return { id: `${code}-${startedAt}`, code, startedAt, table: eveningTable(table, me) }
}

// Стол на этом телефоне — по своему id стола
export function localEvening(localId: string, table: TableState): Evening {
  return { id: `local-${localId}`, code: null, startedAt: startOf(table), table: eveningTable(table, null) }
}

// Против ботов (Р-54) — свой вечер по id стола с ботами; «я» — человек за столом
const BOTS_PREFIX = 'bots-'

export function botsEvening(botsId: string, table: TableState, me: string): Evening {
  return { id: `${BOTS_PREFIX}${botsId}`, code: null, startedAt: startOf(table), table: eveningTable(table, me) }
}

export function isBotsEvening(e: Evening): boolean {
  return e.id.startsWith(BOTS_PREFIX)
}

// mine — свои карты по номеру раздачи, если телефон их видел
export function savedHands(evening: Evening, hands: HistoryHand[], mine?: ReadonlyMap<number, Card[]>): SavedHand[] {
  return hands.map((hand) => {
    const cards = mine?.get(hand.number)
    return {
      evening: evening.id,
      code: evening.code,
      startedAt: evening.startedAt,
      number: hand.number,
      hand,
      ...(evening.table ? { table: evening.table } : {}),
      ...(cards ? { mine: cards } : {}),
    }
  })
}

// Что записать из ответа истории: новые раздачи и изменённые «Показать»; known — записанные: номер → запись текстом
export function unsavedHands(known: ReadonlyMap<number, string>, hands: HistoryHand[]): HistoryHand[] {
  return hands.filter((h) => known.get(h.number) !== JSON.stringify(h))
}

// Новые вечера сверху
export function byNewest(evenings: EveningSummary[]): EveningSummary[] {
  return [...evenings].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
}

// Чей стол: «Стол KQ7MZP», «Стол на телефоне» или «Против ботов»
export function eveningName(e: Evening): string {
  return e.code ? `Стол ${e.code}` : isBotsEvening(e) ? 'Против ботов' : 'Стол на телефоне'
}

// Строка вечера: «Стол KQ7MZP · раздач 12», «Стол на телефоне · раздач 3» или «Против ботов · раздач 40»
export function eveningLine(e: EveningSummary): string {
  return `${eveningName(e)} · раздач ${e.hands}`
}

// День вечера по часам телефона: YYYY-MM-DD
export function eveningDay(e: Evening): string {
  const d = new Date(e.startedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
