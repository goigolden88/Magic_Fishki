import { balance, toKopecks, type PlayerTotal } from './totals'

export type Transfer = {
  from: string // playerId должника
  to: string // playerId получателя
  chips: number
  kopecks: number
}

type Side = { playerId: string; left: number }

// Первый из самых больших — при равенстве порядок участников сохраняется
function largest(sides: Side[]): Side | undefined {
  let best: Side | undefined
  for (const s of sides) if (s.left > 0 && (!best || s.left > best.left)) best = s
  return best
}

// Жадно (Р-03): самый большой должник платит самому большому получателю, пока все не на нуле.
// Считается в фишках — они целые и в сходящейся игре в сумме дают ноль; рубли — из фишек.
// Игра не сходится — переводов нет.
export function transfers(totals: PlayerTotal[], rate: number): Transfer[] {
  if (!balance(totals).ok) return []
  const debtors: Side[] = totals.filter((t) => t.chips < 0).map((t) => ({ playerId: t.playerId, left: -t.chips }))
  const creditors: Side[] = totals.filter((t) => t.chips > 0).map((t) => ({ playerId: t.playerId, left: t.chips }))
  const result: Transfer[] = []
  for (;;) {
    const from = largest(debtors)
    const to = largest(creditors)
    if (!from || !to) break
    const chips = Math.min(from.left, to.left)
    from.left -= chips
    to.left -= chips
    result.push({ from: from.playerId, to: to.playerId, chips, kopecks: toKopecks(chips, rate) })
  }
  return result
}
