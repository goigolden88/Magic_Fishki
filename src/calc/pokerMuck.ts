// «Мак по выбору» на экране стола (#286): пауза после раздачи банков — решающему карточка «Показать карты?»
// с отсчётом, остальным — кто решает. Правила паузы — в src/poker/table.ts (muckVote, closeMuck)
import type { Card } from '../poker/cards'
import { hiddenOf, type TableState } from '../poker/table'

// Идёт пауза. canChoose — решаю я и ещё не ответил: кнопки «Показать» и «Сбросить», cards — мои закрытые карты;
// left — секунд до конца; waiting — кто ещё решает, по именам
export type MuckView = {
  line: string
  left: number
  canChoose: boolean
  cards: Card[] | null
  waiting: string[]
}

// null — паузы нет (или уже идёт новая раздача)
export function muckView(table: TableState, me: string, now: number): MuckView | null {
  const vote = table.muckVote
  if (!vote || table.hand || table.lastHand?.number !== vote.hand) return null
  const nameOf = (id: string) => table.players.find((p) => p.id === id)?.name ?? 'Ушёл'
  const waitingIds = muckDeciding(table)
  const canChoose = waitingIds.includes(me)
  const others = waitingIds.filter((id) => id !== me).map(nameOf)
  const line = canChoose
    ? 'Показать карты?'
    : others.length > 0
      ? `${others.join(', ')} ${others.length > 1 ? 'решают' : 'решает'}: показать или сбросить…`
      : 'Ответили все'
  return {
    line,
    left: Math.max(0, Math.ceil((vote.deadline - now) / 1000)),
    canChoose,
    cards: canChoose ? (hiddenOf(table.lastHand?.record)[me] ?? null) : null,
    waiting: waitingIds.map(nameOf),
  }
}

// Кто ещё решает на паузе «Мак по выбору» — по местам; паузы нет — пусто
export function muckDeciding(table: TableState): string[] {
  const vote = table.muckVote
  if (!vote || table.hand || table.lastHand?.number !== vote.hand) return []
  return vote.players.filter((id) => !Object.hasOwn(vote.answers, id))
}

// Пометка решающего в прошлой раздаче, пока идёт пауза
export const MUCK_DECIDING_NOTE = 'решает: показать или сбросить'
