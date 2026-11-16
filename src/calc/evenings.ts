// Прошлые вечера (#114, Р-37): копия раздач вечера на телефоне. Каждая раздача — записью
// хранилища hands (store/db.ts) под ключом «вечер + номер»: та же раздача второй раз заменяет
// запись, а не дописывается. Здесь — чем вечер назван, что записать и как показать список
import type { Card } from '../poker/cards'
import { limitFor, type TableState } from '../poker/table'
import type { GameId, Limit } from '../poker/game'
import type { HistoryHand } from '../poker/history'
import { formatNumber } from './format'
import { handNet, type Blinds } from './handResult'

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

// hands — сколько раздач записано; myNet — мой итог за вечер фишками (#242): меня в вечере нет — поля нет
export type EveningSummary = Evening & { hands: number; myNet?: number }

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

export function isBotsEvening(e: { id: string }): boolean {
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

// Блайнды живых карт (записи раздачи нет) — стола, если не турнир: там они растут (#239)
export function handBlinds(s: SavedHand): Blinds | null {
  return s.table && !s.table.tournament ? { sb: s.table.sb, bb: s.table.bb } : null
}

// Итог вечера по игрокам (#242): по каждому, кто сидел в раздачах (с ушедшими), — раздач сыграно и итог —
// сумма итогов за раздачу (handNet, #239) фишками и в ББ (итог каждой раздачи — в её большом блайнде).
// Имя — последнее за столом; me — игрок этого телефона. Сортировка — по итогу, больший сверху.
// plus и minus — сумма выигравших и проигравших: игра сходится, когда plus + minus = 0.
// unknown — раздачи, где итог не посчитать (живые карты в турнире: блайнды не записаны), — в итог не входят
export type EveningPlayer = { id: string; name: string; hands: number; net: number; bb: number; me: boolean }
export type EveningResult = { players: EveningPlayer[]; plus: number; minus: number; unknown: number }

export function eveningResult(records: SavedHand[]): EveningResult {
  const players = new Map<string, EveningPlayer>()
  let unknown = 0
  for (const s of [...records].sort((a, b) => a.number - b.number)) {
    const h = s.hand
    const blinds = handBlinds(s)
    const bb = h.record?.bb ?? blinds?.bb ?? null
    const me = s.table?.me ?? null
    let known = true
    for (const seat of h.record?.seats ?? h.live?.seats ?? []) {
      const p = players.get(seat.id) ?? { id: seat.id, name: seat.name, hands: 0, net: 0, bb: 0, me: false }
      p.name = seat.name
      p.hands += 1
      p.me ||= seat.id === me
      const net = handNet(h, seat.id, blinds)
      if (net === null) known = false
      else {
        p.net += net
        if (bb) p.bb += net / bb
      }
      players.set(seat.id, p)
    }
    if (!known) unknown += 1
  }
  const list = [...players.values()].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, 'ru'))
  const plus = list.reduce((sum, p) => sum + Math.max(0, p.net), 0)
  const minus = list.reduce((sum, p) => sum + Math.min(0, p.net), 0)
  return { players: list, plus, minus, unknown }
}

// Мой итог за вечер — строка игрока этого телефона из итога вечера; меня в вечере нет — null
export function myEveningNet(records: SavedHand[]): number | null {
  return eveningResult(records).players.find((p) => p.me)?.net ?? null
}

// Под таблицей итога — с основанием: «Сходится: +2 300 и −2 300»; сумма не ноль — «Не сходится…»;
// раздачи без итога — сколько их и почему. Игроков нет — null
export function eveningBalanceText(r: EveningResult): string | null {
  if (r.players.length === 0) return null
  const pair = `+${formatNumber(r.plus)} и −${formatNumber(-r.minus)}`
  const diff = r.plus + r.minus
  const head = diff === 0 ? `Сходится: ${pair}` : `Не сходится: ${pair}, разница ${formatNumber(Math.abs(diff))}`
  return r.unknown > 0 ? `${head}. Без итога раздач: ${r.unknown} — блайнды не записаны` : head
}

// Строки «Прошлых вечеров» из записей раздач: вечер — по первой записи (меньший номер), число раздач и мой итог
export function eveningSummaries(records: SavedHand[]): EveningSummary[] {
  const groups = new Map<string, SavedHand[]>()
  for (const r of records) {
    const group = groups.get(r.evening)
    if (group) group.push(r)
    else groups.set(r.evening, [r])
  }
  return byNewest(
    [...groups.values()].map((hands) => {
      const first = hands.reduce((a, b) => (b.number < a.number ? b : a))
      const net = myEveningNet(hands)
      return { id: first.evening, code: first.code, startedAt: first.startedAt, hands: hands.length, ...(net !== null ? { myNet: net } : {}) }
    }),
  )
}

// Сколько вечеров и раздач против ботов и всего — «Удалить» пачкой в «Настройках» (#242)
export type EveningCounts = { evenings: number; hands: number }

export function eveningCounts(evenings: EveningSummary[], onlyBots: boolean): EveningCounts {
  const picked = onlyBots ? evenings.filter(isBotsEvening) : evenings
  return { evenings: picked.length, hands: picked.reduce((sum, e) => sum + e.hands, 0) }
}

// День вечера по часам телефона: YYYY-MM-DD
export function eveningDay(e: Evening): string {
  const d = new Date(e.startedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
