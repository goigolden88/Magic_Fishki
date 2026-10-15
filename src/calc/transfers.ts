import { balance, toKopecks, type PlayerTotal } from './totals'

// Перевод в рублях: кто, кому, сколько копеек
export type Payment = {
  from: string // playerId должника
  to: string // playerId получателя
  kopecks: number
}

export type Transfer = Payment & { chips: number }

type Side = { playerId: string; left: number }

// Первый из самых больших — при равенстве порядок участников сохраняется
function largest(sides: Side[]): Side | undefined {
  let best: Side | undefined
  for (const s of sides) if (s.left > 0 && (!best || s.left > best.left)) best = s
  return best
}

// Жадно (Р-03): самый большой должник платит самому большому получателю, пока все не на нуле.
// Сумма итогов не ноль — переводы кончаются, когда на нуле одна из сторон
function settle(amounts: { playerId: string; amount: number }[]): { from: string; to: string; amount: number }[] {
  const debtors: Side[] = amounts.filter((a) => a.amount < 0).map((a) => ({ playerId: a.playerId, left: -a.amount }))
  const creditors: Side[] = amounts.filter((a) => a.amount > 0).map((a) => ({ playerId: a.playerId, left: a.amount }))
  const result: { from: string; to: string; amount: number }[] = []
  for (;;) {
    const from = largest(debtors)
    const to = largest(creditors)
    if (!from || !to) break
    const amount = Math.min(from.left, to.left)
    from.left -= amount
    to.left -= amount
    result.push({ from: from.playerId, to: to.playerId, amount })
  }
  return result
}

// Покер без казино: считается в фишках — они целые и в сходящейся игре в сумме дают ноль; рубли — из фишек.
// Игра не сходится — переводов нет.
export function transfers(totals: PlayerTotal[], rate: number): Transfer[] {
  if (!balance(totals).ok) return []
  return settle(totals.map((t) => ({ playerId: t.playerId, amount: t.chips }))).map((s) => ({
    from: s.from,
    to: s.to,
    chips: s.amount,
    kopecks: toKopecks(s.amount, rate),
  }))
}

// С казино (Р-13): то же правило по «итого» в копейках
export function kopeckTransfers(totals: { playerId: string; kopecks: number }[]): Payment[] {
  return settle(totals.map((t) => ({ playerId: t.playerId, amount: t.kopecks }))).map((s) => ({
    from: s.from,
    to: s.to,
    kopecks: s.amount,
  }))
}
