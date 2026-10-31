// Анимация раздачи (#133): в каком порядке и с какой задержкой каждая карта летит из центра стола.
// Только экран: правила и сервер о ней не знают. Здесь — порядок и время; полёт рисует экран (cardFly)
import type { TableView } from './pokerView'

// Полёт одной карты: key — какая карта на экране (группа и номер в ней), delay — через сколько мс
// после начала раздачи вылетает, ms — сколько летит
export type Flight = { key: string; delay: number; ms: number }

export const DEAL_TOTAL_MS = 1500 // вся раздача по местам — не дольше, при любом числе мест и карт
export const STREET_TOTAL_MS = 1000 // улица (флоп, тёрн, ривер) — не дольше
const DEAL_FLY_MS = 400
const DEAL_MAX_GAP_MS = 150 // мест мало — карты не медленнее этого: раздача короче предела
const STREET_FLY_MS = 300
const STREET_MAX_GAP_MS = 200

export const BOARD_GROUP = 'board'
export const seatGroup = (seat: number) => `seat-${seat}`
export const flyKey = (group: string, card: number) => `${group}:${card}`

// count карт подряд: каждая через равный промежуток, последняя долетает к total
function spread(count: number, fly: number, maxGap: number, total: number): { delay: number; ms: number }[] {
  const gap = count > 1 ? Math.min(maxGap, (total - fly) / (count - 1)) : 0
  return Array.from({ length: count }, (_, i) => ({ delay: Math.round(i * gap), ms: fly }))
}

// Раздача по местам, как у дилера: по одной карте каждому по кругу, начиная с first (индекс в seats),
// и так cards кругов. seats — номера мест по часовой
export function dealFlights(seats: number[], first: number, cards: number): Flight[] {
  const n = seats.length
  if (n === 0 || cards <= 0) return []
  const start = ((first % n) + n) % n
  const order: { seat: number; card: number }[] = []
  for (let card = 0; card < cards; card++) {
    for (let i = 0; i < n; i++) order.push({ seat: seats[(start + i) % n], card })
  }
  const times = spread(order.length, DEAL_FLY_MS, DEAL_MAX_GAP_MS, DEAL_TOTAL_MS)
  return order.map((o, i) => ({ key: flyKey(seatGroup(o.seat), o.card), ...times[i] }))
}

// Общие карты с номера from до to (не включая): флоп — три по одной, тёрн и ривер — по одной
export function streetFlights(from: number, to: number): Flight[] {
  const count = Math.max(0, to - from)
  const times = spread(count, STREET_FLY_MS, STREET_MAX_GAP_MS, STREET_TOTAL_MS)
  return times.map((t, i) => ({ key: flyKey(BOARD_GROUP, from + i), ...t }))
}

// Конец полёта последней карты, мс
export const flightsEnd = (flights: Flight[]) => flights.reduce((end, f) => Math.max(end, f.delay + f.ms), 0)

// Стол покера для анимации: номер раздачи, идёт ли она, общие карты, сданные места по часовой,
// место кнопки и сколько карт в руке
export type DealSnapshot = {
  hand: number
  playing: boolean // идёт раздача (не между раздачами)
  board: string[]
  seats: number[] // номера сданных мест по возрастанию — это и есть «по часовой»
  button: number | null // номер места с кнопкой
  cards: number // карт в руке у каждого; карт на экране нет (живые карты) — 0
}

// Снимок из вида стола. Карт в руке — по моим или по чьим-то у места (рубашки тоже карты); живые карты — 0
export function tableSnapshot(v: TableView): DealSnapshot {
  return {
    hand: v.handNumber,
    playing: v.stage !== null,
    board: v.board,
    seats: v.seats.filter((s) => s.inHand).map((s) => s.seat),
    button: v.seats.find((s) => s.button)?.seat ?? null,
    cards: v.myCards?.length ?? v.seats.find((s) => s.cards)?.cards?.length ?? 0,
  }
}

export type DealPlan = { kind: 'deal' | 'street'; flights: Flight[] }

// Что проиграть, когда стол сменился с prev на next. prev нет (стол только открыли) — ничего:
// карты уже лежат. Новая раздача — карты по местам с места после кнопки; та же раздача и общих карт
// прибавилось — новые общие карты. Иначе — ничего
export function dealPlan(prev: DealSnapshot | null, next: DealSnapshot): DealPlan | null {
  if (!prev) return null
  if (next.hand !== prev.hand) {
    if (!next.playing) return null
    const at = next.button === null ? -1 : next.seats.indexOf(next.button)
    // Кнопки среди сданных нет — от первого места после её номера
    const first = at !== -1 ? at + 1 : next.seats.findIndex((s) => next.button !== null && s > next.button)
    const flights = dealFlights(next.seats, first === -1 ? 0 : first, next.cards)
    return flights.length > 0 ? { kind: 'deal', flights } : null
  }
  const grew = next.board.length > prev.board.length && prev.board.every((c, i) => next.board[i] === c)
  if (!grew) return null
  return { kind: 'street', flights: streetFlights(prev.board.length, next.board.length) }
}
