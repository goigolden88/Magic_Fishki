// История раздач вечера (#113): каждая оконченная раздача — итог, как «прошлая раздача» стола.
// В комнате — отдельными записями хранилища, не в столе: стол уходит телефонам на каждый ход
// и ограничен по размеру. На одном телефоне — рядом со столом (localTable.ts). Здесь — что
// записать после хода и что из записи видит игрок
import type { HandLogEntry } from './hand'
import type { HandResult, TableState } from './table'

// Живые карты: записи раздачи (record) у стола нет — места в начале и ходы берутся из самой раздачи
export type LiveRecord = {
  seats: { id: string; name: string; chips: number }[] // по местам; стек в начале раздачи
  button: number // индекс в seats
  log: HandLogEntry[]
}

export type HistoryHand = HandResult & { live?: LiveRecord }

// Ход стола before → after: раздача окончилась или «Показать» поменял запись прошлой — что записать
// под её номером; иначе null. Живые карты кончаются только «Раздать банки» ведущего: ходы и места —
// у раздачи до этого сообщения (before.hand); стек в начале — стек в раздаче плюс вложенное
export function finishedHand(before: TableState, after: TableState): HistoryHand | null {
  const last = after.lastHand
  if (!last || JSON.stringify(last) === JSON.stringify(before.lastHand)) return null
  const hand = before.hand
  if (last.record || !hand || hand.number !== last.number) return last
  const names = new Map(before.players.map((p) => [p.id, p.name]))
  const seats = hand.seats.map((s) => ({ id: s.id, name: names.get(s.id) ?? 'Ушёл', chips: s.chips + s.committed }))
  return { ...last, live: { seats, button: hand.button, log: hand.log } }
}

// История на одном телефоне: запись с тем же номером — заменить («Показать»), новая — в конец
export function keepHand(history: HistoryHand[], hand: HistoryHand | null): HistoryHand[] {
  if (!hand) return history
  const at = history.findIndex((h) => h.number === hand.number)
  return at === -1 ? [...history, hand] : history.map((h, i) => (i === at ? hand : h))
}

// Что из записи видит игрок: карты взявшего банк без вскрытия — только он сам, пока не показал
// (как прошлая раздача в viewFor). null — не вошедший
export function handFor(hand: HistoryHand, playerId: string | null): HistoryHand {
  const hidden = hand.record?.hidden
  if (!hand.record || !hidden || hidden.playerId === playerId) return hand
  return { ...hand, record: { ...hand.record, hidden: null } }
}
