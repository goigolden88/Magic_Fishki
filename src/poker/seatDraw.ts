// «Перемешать места» и розыгрыш кнопки (#316, Р-117): как за живым столом — ведущий случайно рассаживает
// игроков, затем каждому играющему открытой — по карте, у старшей — кнопка первой раздачи после розыгрыша.
// Чистые функции: случайность — перемешанная колода (сервер комнаты, на одном телефоне — сам телефон)
import { buildDeck, HOLDEM, SUITS, type Card } from './cards'

// Итог розыгрыша — в столе до начала раздачи (TableState.seatDraw): на нём анимация у всех телефонов
export type SeatDraw = {
  at: number // когда перемешали, мс — по нему телефоны узнают новый розыгрыш
  cards: Record<string, Card> // карта розыгрыша по игрокам (id → карта): играющие в первой раздаче
  button: string // id вытянувшего старшую — кнопка первой раздачи после розыгрыша
}

export const SHUFFLE_BETWEEN = 'Перемешать можно между раздачами'
export const SHUFFLE_TOURNAMENT = 'Места в турнире перемешиваются до старта'
export const SHUFFLE_NO_DECK = 'Нет колоды — места не перемешаны'

const RANKS = '23456789TJQKA'
const FULL = buildDeck(HOLDEM) // 52 карты по порядку: от двойки к тузу, внутри ранга — s h d c

// Полная колода из 52 карт без повторов — розыгрыш идёт всегда по ней, какая бы игра ни была за столом
export function isSeatDeck(deck: unknown): deck is Card[] {
  if (!Array.isArray(deck) || deck.length !== FULL.length) return false
  const set = new Set<unknown>(deck)
  return set.size === FULL.length && FULL.every((c) => set.has(c))
}

// Сила карты розыгрыша: ранг, при равенстве — масть ♠ > ♥ > ♦ > ♣. Двух равных не бывает
export function drawValue(card: Card): number {
  return RANKS.indexOf(card[0]) * 4 + (SUITS.length - 1 - SUITS.indexOf(card[1] as (typeof SUITS)[number]))
}

// У кого старшая карта; пусто — null
export function drawWinner(cards: Record<string, Card>): string | null {
  let best: string | null = null
  for (const [id, card] of Object.entries(cards)) if (best === null || drawValue(card) > drawValue(cards[best])) best = id
  return best
}

// Новая рассадка и розыгрыш по колоде. Места — те же занятые номера, перемешанные между игроками: свободные
// остаются свободными. Порядок — по первым картам колоды (у каждого игрока своя, по возрастанию порядка колоды),
// карты розыгрыша — следующие, по новым местам; так кнопка не зависит от рассадки.
// players — все за столом, playing — id тех, кто играет в следующей раздаче (им карта розыгрыша)
export function drawSeats(
  players: { id: string; seat: number }[],
  playing: string[],
  deck: Card[],
): { seats: Record<string, number>; cards: Record<string, Card>; button: string | null } {
  const bySeat = [...players].sort((a, b) => a.seat - b.seat)
  const keys = new Map(bySeat.map((p, i) => [p.id, FULL.indexOf(deck[i])]))
  const shuffled = [...bySeat].sort((a, b) => (keys.get(a.id) ?? 0) - (keys.get(b.id) ?? 0))
  const seats = Object.fromEntries(shuffled.map((p, i) => [p.id, bySeat[i].seat]))
  const order = shuffled.map((p) => p.id).filter((id) => playing.includes(id))
  const cards = Object.fromEntries(order.map((id, k) => [id, deck[bySeat.length + k]]))
  return { seats, cards, button: drawWinner(cards) }
}
