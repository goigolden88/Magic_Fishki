// Сколько каждое место вложило в раздачу, в фишках — по записи раздачи (HandRecord). Общее у итога раздачи
// за всё время (pokerAllTime, #197) и у кулера (#262). Вложенное — как у стола (hand.ts): анте, блайнды
// (в журнале ходов их нет — до первого хода ставка улицы и есть блайнд), на каждой улице — ставка после
// последнего хода; непокрытая часть самой большой ставки вернулась хозяину (closeBetting)
import type { Street } from '../poker/hand'
import type { HandRecord } from '../poker/table'

export function invested(record: HandRecord): Map<string, number> {
  const seats = record.seats
  const n = seats.length
  const total = new Map(seats.map((s) => [s.id, 0]))
  const left = new Map(seats.map((s) => [s.id, s.chips])) // стек после анте — на блайнды
  const add = (id: string, amount: number) => total.set(id, (total.get(id) ?? 0) + amount)
  for (const e of record.log) {
    if (e.type !== 'ante') continue
    add(e.playerId, e.bet)
    left.set(e.playerId, (left.get(e.playerId) ?? 0) - e.bet)
  }
  // Ставка улицы по игрокам: блайнды — до флопа, затем — после каждого хода
  const bets = new Map<Street, Map<string, number>>()
  const betsOf = (street: Street): Map<string, number> => {
    const m = bets.get(street) ?? new Map<string, number>()
    bets.set(street, m)
    return m
  }
  const blind = (index: number, amount: number) => {
    const id = seats[index]?.id
    if (id !== undefined) betsOf('preflop').set(id, Math.max(0, Math.min(amount, left.get(id) ?? 0)))
  }
  if (n >= 2) {
    // Хедз-ап: кнопка ставит малый (startHand)
    const sb = n === 2 ? record.button : (record.button + 1) % n
    blind(sb, record.sb)
    blind((sb + 1) % n, record.bb)
  }
  const folded = new Set<string>()
  for (const e of record.log) {
    if (e.type === 'ante') continue
    betsOf(e.street).set(e.playerId, e.bet)
    if (e.type === 'fold') folded.add(e.playerId)
  }
  for (const m of bets.values()) for (const [id, bet] of m) add(id, bet)
  const [top, second] = [...total.entries()].sort((a, b) => b[1] - a[1])
  if (top && !folded.has(top[0])) total.set(top[0], Math.min(top[1], second?.[1] ?? 0))
  return total
}
