import { describe, expect, it } from 'vitest'
import { buildDeck, HOLDEM, type Card } from '../poker/cards'
import { boardResult, BOARD_CARDS, dealFromDeck, maxTables, newDeal, roundShares, type Deal, type DealKind } from './casinoDeal'
import { CASINO_SAMPLES, casinoOdds, topOdds, wholePercents } from './casinoOdds'

// Случайность с зерном: раздачи тестов одни и те же
function seeded(seed: number) {
  let a = seed
  return (bytes: Uint8Array<ArrayBuffer>) => {
    for (let i = 0; i < bytes.length; i++) {
      a = (Math.imul(a, 1103515245) + 12345) >>> 0
      bytes[i] = a >>> 24
    }
    return bytes
  }
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`)

// Колода: сначала нужные карты по порядку, затем остальные
function deckWith(first: Card[]): Card[] {
  return [...first, ...buildDeck(HOLDEM).filter((c) => !first.includes(c))]
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function allVisible(deal: Deal) {
  return deal.boards.map(() => BOARD_CARDS)
}

describe('casinoOdds — шансы казино-стола', () => {
  it('сумма шансов каждого стола — 100 %, и рубашкой, и по ходу переворота', () => {
    const deal = newDeal('holdem', ids(4), 3, seeded(1))
    for (const visible of [
      [0, 0, 0],
      [5, 3, 0],
      [5, 5, 4],
    ]) {
      const odds = casinoOdds(deal, 10_000, visible)!
      expect(odds.boards).toHaveLength(3)
      for (const shares of odds.boards) {
        expect(sum(shares)).toBeCloseTo(1, 9)
        expect(sum(wholePercents(shares))).toBe(100)
      }
    }
  })

  it('открытый стол — ровно у победителей, ничья — поровну', () => {
    // Роял-флеш на столе: оба играют его — ничья
    const tie = dealFromDeck('holdem', ['a', 'b'], 1, deckWith(['2c', '3d', '4c', '5d', 'As', 'Ks', 'Qs', 'Js', 'Ts']))
    expect(casinoOdds(tie, 10_000, [5])!.boards[0]).toEqual([0.5, 0.5])
    const deal = newDeal('omaha', ids(5), 4, seeded(2))
    const odds = casinoOdds(deal, 10_000, allVisible(deal))!
    deal.boards.forEach((_, t) => {
      const ws = boardResult(deal, t).winners
      expect(odds.boards[t]).toEqual(deal.ids.map((id) => (ws.includes(id) ? 1 / ws.length : 0)))
    })
  })

  it('открытые карты других столов в досдачу не идут', () => {
    // Тузы против королей; на первом столе видно четыре карты, королю нужен один из двух оставшихся королей.
    // Оба короля лежат на втором столе: открыт он — у королей шансов нет
    const deal = dealFromDeck(
      'holdem',
      ['a', 'k'],
      2,
      deckWith(['As', 'Ks', 'Ah', 'Kh', '2c', '7d', '9h', 'Js', '8c', 'Kd', 'Kc', '3s', '4s', '5d']),
    )
    const closed = casinoOdds(deal, 10_000, [4, 0])!
    expect(closed.boards[0][1]).toBeCloseTo(2 / 44, 9) // 52 − 4 на руках − 4 на столе
    const opened = casinoOdds(deal, 10_000, [4, 5])!
    expect(opened.boards[0]).toEqual([1, 0])
    expect(opened.boards[0][1]).toBe(0)
  })

  it('все столы открыты — итог у мест совпадает с roundShares до копейки', () => {
    for (const [kind, n, tables, stake] of [
      ['holdem', 2, 1, 10_000],
      ['holdem', 3, 2, 1_001], // банк 3 003 копейки: остаток по столам и при ничьей
      ['omaha', 6, 5, 7_777],
      ['holdem', 10, 6, 10_000],
    ] as [DealKind, number, number, number][]) {
      for (let seed = 1; seed <= 4; seed++) {
        const deal = newDeal(kind, ids(n), tables, seeded(seed * 31 + n))
        const odds = casinoOdds(deal, stake, allVisible(deal))!
        const shares = roundShares(
          stake,
          deal.ids,
          deal.boards.map((_, t) => boardResult(deal, t).winners),
        )
        expect(odds.net).toEqual(shares.map((s) => s.net))
      }
    }
  })

  it('ожидаемый итог — шанс × часть стола − ставка; в сумме около нуля', () => {
    const deal = newDeal('holdem', ids(3), 2, seeded(5))
    const stake = 10_000
    const odds = casinoOdds(deal, stake, [5, 2])!
    const parts = [15_000, 15_000]
    const won = boardResult(deal, 0).winners
    deal.ids.forEach((id, p) => {
      const first = won.includes(id) ? Math.floor(parts[0] / won.length) : 0
      expect(Math.abs(odds.net[p] - (first + odds.boards[1][p] * parts[1] - stake))).toBeLessThanOrEqual(won.length)
    })
    expect(Math.abs(sum(odds.net))).toBeLessThanOrEqual(deal.ids.length)
  })

  it('один стол и двое участников', () => {
    const deal = newDeal('holdem', ids(2), 1, seeded(7))
    const odds = casinoOdds(deal, 5_000, [0])!
    expect(sum(odds.boards[0])).toBeCloseTo(1, 9)
    expect(odds.net[0] + odds.net[1]).toBeLessThanOrEqual(1)
    expect(odds.net[0] + odds.net[1]).toBeGreaterThanOrEqual(-1)
  })

  it('выборка с зерном из раздачи: та же раздача — те же шансы', () => {
    const deal = newDeal('omaha', ids(10), maxTables('omaha', 10), seeded(9))
    const visible = deal.boards.map(() => 0)
    const first = casinoOdds(deal, 10_000, visible)!
    expect(casinoOdds(deal, 10_000, visible)).toEqual(first)
    expect(first.boards.every((b) => Math.abs(sum(b) - 1) < 1e-9)).toBe(true)
  })

  it('выборка близка к полному перебору: около процента', () => {
    // Два участника, на столе две карты: досдач C(46, 3) = 15 180 — больше выборки; с перебором всех
    const deal = newDeal('holdem', ids(2), 1, seeded(11))
    const sampled = casinoOdds(deal, 10_000, [2], CASINO_SAMPLES)!
    const full = casinoOdds(deal, 10_000, [2], 1_000_000)!
    expect(Math.abs(sampled.boards[0][0] - full.boards[0][0])).toBeLessThan(0.03)
  })

  it('видимых карт столько же, сколько столов, иначе — null', () => {
    const deal = newDeal('holdem', ids(3), 2, seeded(13))
    expect(casinoOdds(deal, 10_000, [0])).toBeNull()
  })
})

describe('wholePercents и topOdds — строка шансов стола', () => {
  it('сумма 100, нулевая доля — ноль', () => {
    expect(wholePercents([0, 1 / 3, 1 / 3, 1 / 3])).toEqual([0, 34, 33, 33])
    expect(wholePercents([1, 0])).toEqual([100, 0])
    expect(wholePercents([0.5, 0.5])).toEqual([50, 50])
    expect(sum(wholePercents([0.123, 0.456, 0.421]))).toBe(100)
  })

  it('по убыванию, без нулевых, три имени и «ещё N»', () => {
    const names = ids(6)
    const got = topOdds(names, [0.1, 0.31, 0, 0.22, 0.18, 0.19])
    expect(got.top).toEqual([
      { id: 'p1', percent: 31 },
      { id: 'p3', percent: 22 },
      { id: 'p5', percent: 19 },
    ])
    expect(got.more).toBe(2)
    expect(topOdds(['a', 'b'], [0, 1])).toEqual({ top: [{ id: 'b', percent: 100 }], more: 0 })
  })
})
