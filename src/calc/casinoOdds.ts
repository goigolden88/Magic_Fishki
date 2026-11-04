// Шансы казино-стола (#137, Р-43): у каждого стола — какая доля его части банка досталась бы
// каждому участнику при досдаче стола, и ожидаемый итог раунда у места. Все карты у мест открыты,
// колода одна: открытые карты любого стола в досдачу не идут, закрытые — неизвестны и остаются в колоде.
// Только показ: раунд и его запись (casinoDeal, casino) об этом не знают. Сила руки — общий счёт
// шансов на ва-банке (equity в allInOdds.ts)
import { equity } from './allInOdds'
import { boardResult, BOARD_CARDS, DEAL_KINDS, roundShares, tableParts, type Deal } from './casinoDeal'

// Досдач больше — выборка этого размера с зерном из самой раздачи (меньше — полный перебор):
// пересчёт после каждой открытой карты и при омахе на 10 участников не задерживает экран;
// точность около ±1 % (Р-43)
export const CASINO_SAMPLES = 2_000

// Имён в строке шансов стола — не больше; остальные — «ещё N»
export const ODDS_NAMES = 3

export type CasinoOdds = {
  boards: number[][] // у каждого стола — доли участников по порядку deal.ids, сумма — 1; открытый — у победителей
  net: number[] // копеек, по порядку deal.ids: сумма по столам «доля × часть стола» минус ставка
}

// visible — сколько карт каждого стола видно, слева направо (0 — рубашкой, 5 — открыт целиком).
// Открытый стол — ровно у победителей (ничья — поровну), и его часть — с копейками, как в roundShares:
// все столы открыты — итог совпадает с «Итогом раунда» до копейки. Карты не сходятся — null
export function casinoOdds(deal: Deal, stake: number, visible: number[], samples = CASINO_SAMPLES): CasinoOdds | null {
  if (visible.length !== deal.boards.length) return null
  const { variant } = DEAL_KINDS[deal.kind]
  const hands = deal.ids.map((id) => deal.hands[id])
  const seen = deal.boards.map((b, i) => b.slice(0, Math.max(0, Math.min(BOARD_CARDS, visible[i]))))
  const winners: string[][] = [] // у открытых столов; у остальных — пусто
  const boards: number[][] = []
  for (let i = 0; i < deal.boards.length; i++) {
    if (seen[i].length === BOARD_CARDS) {
      const ws = boardResult(deal, i).winners
      winners.push(ws)
      boards.push(deal.ids.map((id) => (ws.includes(id) ? 1 / ws.length : 0)))
      continue
    }
    const dead = seen.flatMap((cards, j) => (j === i ? [] : cards))
    const shares = equity(variant, hands, seen[i], BOARD_CARDS, dead, samples)
    if (!shares) return null
    winners.push([])
    boards.push(shares)
  }
  const parts = tableParts(stake * deal.ids.length, deal.boards.length)
  // Открытые — точно, с копейками остатка; закрытые — ожиданием
  const exact = roundShares(stake, deal.ids, winners)
  const net = exact.map((s, p) => {
    const expected = boards.reduce((sum, b, t) => sum + (winners[t].length > 0 ? 0 : b[p] * parts[t]), 0)
    return s.won + Math.round(expected) - stake
  })
  return { boards, net }
}

// Доли — в целые проценты: сумма — 100, недостающие — самым большим остаткам (при равных — раньше по порядку).
// Нулевая доля остаётся нулём
export function wholePercents(shares: number[]): number[] {
  const raw = shares.map((s) => s * 100)
  const out = raw.map(Math.floor)
  const order = raw.map((r, i) => ({ i, rest: r - out[i] })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  let missing = 100 - out.reduce((a, b) => a + b, 0)
  for (const { i, rest } of order) {
    if (missing <= 0 || rest <= 0) break
    out[i]++
    missing--
  }
  return out
}

export type OddsEntry = { id: string; percent: number }

// Строка шансов стола: по убыванию (равные — по порядку мест), нулевые не показаны,
// не больше max имён; остальные ненулевые — числом «ещё N»
export function topOdds(ids: string[], shares: number[], max = ODDS_NAMES): { top: OddsEntry[]; more: number } {
  const all = wholePercents(shares)
    .map((percent, i) => ({ id: ids[i], percent, i }))
    .filter((e) => e.percent > 0)
    .sort((a, b) => b.percent - a.percent || a.i - b.i)
    .map(({ id, percent }) => ({ id, percent }))
  return { top: all.slice(0, max), more: Math.max(0, all.length - max) }
}
