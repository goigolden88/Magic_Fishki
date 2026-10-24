// Банки слоями: основной и побочные из вкладов игроков за раздачу (по прототипу, pots.js).
// Слой между соседними уровнями вкладов оплачивают все, кто вложил не меньше уровня;
// претендуют на него только не сбросившие. Фишки сбросивших остаются в банке.
// Соседние слои с теми же претендентами сливаются в один банк

export type Pot = {
  amount: number
  eligible: string[] // претенденты — в порядке мест
}

export type Contribution = { id: string; committed: number; folded: boolean }

export function buildPots(seats: Contribution[]): Pot[] {
  const levels = [...new Set(seats.filter((s) => s.committed > 0).map((s) => s.committed))].sort((a, b) => a - b)
  const pots: Pot[] = []
  let prev = 0
  let dead = 0 // слой без претендентов (все сбросили) — к соседнему банку
  for (const level of levels) {
    const contributors = seats.filter((s) => s.committed >= level)
    const amount = (level - prev) * contributors.length
    prev = level
    const eligible = contributors.filter((s) => !s.folded).map((s) => s.id)
    if (eligible.length === 0) {
      if (pots.length > 0) pots[pots.length - 1].amount += amount
      else dead += amount
      continue
    }
    const last = pots[pots.length - 1]
    if (last && sameSet(last.eligible, eligible)) last.amount += amount
    else pots.push({ amount: amount + dead, eligible })
    dead = 0
  }
  if (dead > 0) pots.push({ amount: dead, eligible: seats.filter((s) => !s.folded).map((s) => s.id) })
  return pots
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

// Делёж банка поровну; нечётные фишки — по одной, начиная с первого в порядке winners
// (вызывающий упорядочивает их по кругу от кнопки)
export function splitPot(amount: number, winners: string[]): Record<string, number> {
  const share = Math.floor(amount / winners.length)
  const extra = amount - share * winners.length
  const out: Record<string, number> = {}
  winners.forEach((id, i) => {
    out[id] = share + (i < extra ? 1 : 0)
  })
  return out
}
