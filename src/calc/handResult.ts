// Позиция и итог игрока за раздачу (#239) — по записи раздачи из истории (HistoryHand): одни и те же
// для «Истории раздач» и для итога вечера. Ходы журнала — ставка «до N» на улице; блайнды в журнал
// не пишутся — ставятся по местам от кнопки, как в раздаче (startHand): хедз-ап — малый у кнопки.
// Непокрытая ставка вернулась — вложено больше, чем во всех банках: лишнее — у вложившего больше всех
import type { Street } from '../poker/hand'
import type { HistoryHand } from '../poker/history'

export type Blinds = { sb: number; bb: number }

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']

// Подписи позиций по числу сданных, от кнопки по кругу: «BTN», «SB», «BB», «UTG», поздние с конца —
// «CO», «HJ», «LJ», «MP», «UTG+1»; хедз-ап — «BTN/SB» и «BB», как при сдаче
export function positionLabels(n: number): string[] {
  if (n < 2) return n === 1 ? ['BTN'] : []
  if (n === 2) return ['BTN/SB', 'BB']
  const late = ['CO', 'HJ', 'LJ', 'MP', 'UTG+1', 'UTG+2', 'UTG+3'].slice(0, Math.max(0, n - 4)).reverse()
  return ['BTN', 'SB', 'BB', ...(n > 3 ? ['UTG'] : []), ...late]
}

function seatsOf(h: HistoryHand): { id: string; name: string; chips: number }[] {
  return h.record?.seats ?? h.live?.seats ?? []
}

function buttonOf(h: HistoryHand): number {
  return h.record?.button ?? h.live?.button ?? 0
}

// Позиция каждого места раздачи — по порядку мест
export function handPositions(h: HistoryHand): string[] {
  const n = seatsOf(h).length
  const labels = positionLabels(n)
  return seatsOf(h).map((_, i) => labels[(i - buttonOf(h) + n) % n])
}

// Позиция игрока в раздаче; его не было (не сел, пропускал) — null
export function handPosition(h: HistoryHand, playerId: string): string | null {
  const i = seatsOf(h).findIndex((s) => s.id === playerId)
  return i === -1 ? null : handPositions(h)[i]
}

// Блайнды раздачи: из записи; у живых карт записи нет — те, что знает вызывающий (стол, не турнир), иначе null
function blindsOf(h: HistoryHand, fallback: Blinds | null): Blinds | null {
  return h.record ? { sb: h.record.sb, bb: h.record.bb } : fallback
}

// Деньги раздачи: сколько каждый вложил (вернувшаяся непокрытая ставка уже вычтена) и банк на начало
// каждой улицы, до её ходов (префлоп — анте, блайнды и страддл). Улицы после закрытых торгов (ва-банк) — банк итоговый.
// Блайнды неизвестны — null
export type HandMoney = {
  committed: Record<string, number>
  potAt: Partial<Record<Street, number>>
}

export function handMoney(h: HistoryHand, fallback: Blinds | null = null): HandMoney | null {
  const blinds = blindsOf(h, fallback)
  if (!blinds) return null
  const seats = seatsOf(h)
  const log = h.record?.log ?? h.live?.log ?? []
  const committed: Record<string, number> = Object.fromEntries(seats.map((s) => [s.id, 0]))
  const left = new Map(seats.map((s) => [s.id, s.chips]))
  const put = (id: string, amount: number) => {
    committed[id] = (committed[id] ?? 0) + amount
    left.set(id, (left.get(id) ?? 0) - amount)
  }
  const total = () => Object.values(committed).reduce((a, b) => a + b, 0)

  for (const e of log) if (e.type === 'ante') put(e.playerId, e.bet)
  let bets = new Map<string, number>() // ставка улицы у каждого
  const n = seats.length
  if (n >= 2) {
    const sbIndex = n === 2 ? buttonOf(h) : (buttonOf(h) + 1) % n
    for (const [index, blind] of [
      [sbIndex, blinds.sb],
      [(sbIndex + 1) % n, blinds.bb],
    ]) {
      const id = seats[index].id
      const amount = Math.max(0, Math.min(blind, left.get(id) ?? 0))
      put(id, amount)
      bets.set(id, amount)
    }
  }
  // Страддл (#222) — записью журнала, как блайнд: в банке префлопа до ходов
  for (const e of log) {
    if (e.type !== 'straddle') continue
    put(e.playerId, Math.max(0, e.bet - (bets.get(e.playerId) ?? 0)))
    bets.set(e.playerId, e.bet)
  }
  const potAt: HandMoney['potAt'] = { preflop: total() }
  let street: Street = 'preflop'
  for (const e of log) {
    if (e.type === 'ante' || e.type === 'straddle') continue
    if (e.street !== street) {
      street = e.street
      bets = new Map()
      potAt[street] = total()
    }
    const before = bets.get(e.playerId) ?? 0
    if (e.bet > before) {
      put(e.playerId, e.bet - before)
      bets.set(e.playerId, e.bet)
    }
  }

  const returned = total() - h.pots.reduce((sum, p) => sum + p.amount, 0)
  if (returned > 0 && n > 0) {
    const top = seats.reduce((a, b) => (committed[b.id] > committed[a.id] ? b : a))
    committed[top.id] -= returned
  }
  // Ва-банк: улицы без ходов открылись после торгов — банк на них итоговый
  for (const s of STREETS.slice(STREETS.indexOf(street) + 1)) potAt[s] = total()
  return { committed, potAt }
}

// Итог игрока за раздачу: взял из банков минус вложил. Его не было в раздаче или блайнды неизвестны — null
export function handNet(h: HistoryHand, playerId: string, fallback: Blinds | null = null): number | null {
  if (!seatsOf(h).some((s) => s.id === playerId)) return null
  const money = handMoney(h, fallback)
  if (!money) return null
  return (h.payouts[playerId] ?? 0) - (money.committed[playerId] ?? 0)
}
