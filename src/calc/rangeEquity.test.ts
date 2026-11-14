import { describe, expect, it } from 'vitest'
import { HOLDEM, type Card } from '../poker/cards'
import { equity } from './allInOdds'
import { COMBOS, handClass } from './botRanges'
import { rangeEquity, type EquitySide, type RangeEquity } from './rangeEquity'
import { classIndex, emptyRange, fullRange, parseRange } from './rangeText'

const hand = (text: string): EquitySide => ({ cards: text.match(/../g) as Card[] })
const cards = (text: string) => (text.match(/../g) ?? []) as Card[]
function range(text: string): EquitySide {
  const r = parseRange(text)
  if ('error' in r) throw new Error(r.error)
  return { range: r.weights }
}

function counted(r: RangeEquity) {
  if (!r.ok) throw new Error(r.reason)
  return r
}
const shares = (r: RangeEquity) => counted(r).sides.map((s) => s.share)

// Весовая сумма точных или выборочных расчётов пар сочетаний по отдельности (equity)
function bySum(a: string, b: string, board: Card[], samples: number): number {
  const wa = (range(a) as { range: number[] }).range
  const wb = (range(b) as { range: number[] }).range
  const combos = (w: number[]) =>
    COMBOS.map((c) => ({ c, w: w[classIndex(handClass(c.a, c.b))] })).filter(
      ({ c, w }) => w > 0 && !board.includes(c.a) && !board.includes(c.b),
    )
  let total = 0
  let sum = 0
  for (const x of combos(wa)) {
    for (const y of combos(wb)) {
      if ([x.c.a, x.c.b].some((card) => card === y.c.a || card === y.c.b)) continue
      const e = equity(HOLDEM, [[x.c.a, x.c.b], [y.c.a, y.c.b]], board, 5, [], samples) as number[]
      sum += x.w * y.w * e[0]
      total += x.w * y.w
    }
  }
  return sum / total
}

describe('rangeEquity: до флопа', () => {
  it('AA против KK — у AA 81–83 %', () => {
    const [aa] = shares(rangeEquity([range('AA'), range('KK')], []))
    expect(aa).toBeGreaterThan(0.81)
    expect(aa).toBeLessThan(0.83)
  })

  it('AKs против QQ — 45–47 %', () => {
    const [ak] = shares(rangeEquity([range('AKs'), range('QQ')], []))
    expect(ak).toBeGreaterThan(0.45)
    expect(ak).toBeLessThan(0.47)
  })

  it('AA против «любые две» — 84–86 %', () => {
    const r = counted(rangeEquity([range('AA'), { range: fullRange() }], []))
    expect(r.sides[0].share).toBeGreaterThan(0.84)
    expect(r.sides[0].share).toBeLessThan(0.86)
    expect(r.exact).toBe(false)
    expect(r.runs).toBe(20_000)
  })
})

describe('rangeEquity: итог', () => {
  it('у каждой стороны доля банка, побед и ничьих; доли банка — в сумме 1', () => {
    // Вдвоём ничья — пополам: банк = победы + ничьи / 2
    const two = counted(rangeEquity([range('AKo'), range('AKs, QQ')], cards('2c7d9h')))
    for (const s of two.sides) expect(s.share).toBeCloseTo(s.win + s.tie / 2, 9)
    expect(two.sides[0].tie).toBe(two.sides[1].tie)
    expect(two.sides[0].tie).toBeGreaterThan(0.1) // AK против AK — часто пополам
    expect(two.sides[0].win + two.sides[1].win + two.sides[0].tie).toBeCloseTo(1, 9)
    const three = counted(rangeEquity([range('AKo'), range('AKs'), range('QQ')], cards('2c7d9h')))
    for (const s of three.sides) expect(s.win + s.tie).toBeLessThanOrEqual(1)
    expect(three.sides.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 9)
    expect(three.runs).toBeGreaterThan(0)
  })

  it('одни и те же входы — один и тот же ответ', () => {
    const sides = [range('QQ+, AKs'), range('JJ, AQs'), hand('7c6c')]
    expect(rangeEquity(sides, [])).toEqual(rangeEquity(sides, []))
    expect(rangeEquity(sides, cards('2h3h4s'))).toEqual(rangeEquity(sides, cards('2h3h4s')))
  })
})

describe('rangeEquity: конкретные руки — как equity', () => {
  const cases: [string[], string][] = [
    [['AhKh', 'QsQd'], ''],
    [['AhKh', 'QsQd'], '2h7h9c'],
    [['AhKh', 'QsQd'], '2h7h9cTd'],
    [['AsAd', 'KhKc', '7s6s'], ''],
    [['AsAd', 'KhKc', '7s6s'], '5s8dKs'],
    [['9c9d', 'AhKd', 'QcJc', '2s2h', 'Ts9s', '5d4d'], ''],
  ]
  for (const [hands, board] of cases) {
    it(`${hands.join(' против ')}${board ? ` на ${board}` : ' до флопа'}`, () => {
      const r = counted(rangeEquity(hands.map(hand), cards(board)))
      const e = equity(HOLDEM, hands.map(cards), cards(board), 5) as number[]
      r.sides.forEach((s, i) => expect(Math.abs(s.share - e[i])).toBeLessThan(0.01))
      if (board) expect(r.exact).toBe(true)
    })
  }
})

describe('rangeEquity: диапазон — весовая сумма пар', () => {
  it('«QQ+, AKs» против «JJ» до флопа', () => {
    const [mine] = shares(rangeEquity([range('QQ+, AKs'), range('JJ')], []))
    expect(Math.abs(mine - bySum('QQ+, AKs', 'JJ', [], 4000))).toBeLessThan(0.01)
  })

  it('с весами и на флопе', () => {
    const board = cards('Jd8c3s')
    const [mine] = shares(rangeEquity([range('QQ+, AKs:0.5, T9s'), range('JJ:0.3, 99, AQo')], board))
    expect(Math.abs(mine - bySum('QQ+, AKs:0.5, T9s', 'JJ:0.3, 99, AQo', board, 2000))).toBeLessThan(0.01)
  })

  it('на борде из 5 карт — точный ответ без выборки', () => {
    const board = cards('Jd8c3s2hKh')
    const r = counted(rangeEquity([range('QQ+, AKs, T9s'), range('JJ, 99, AQ')], board))
    expect(r.exact).toBe(true)
    expect(r.sides[0].share).toBeCloseTo(bySum('QQ+, AKs, T9s', 'JJ, 99, AQ', board, 1), 9)
  })

  it('на борде из 5 карт любые две против любых двух — тоже точно', () => {
    const r = counted(rangeEquity([{ range: fullRange() }, { range: fullRange() }], cards('Jd8c3s2hKh')))
    expect(r.exact).toBe(true)
    expect(r.runs).toBe(1081 * 990) // сочетаний без карт борда, у второго — ещё без карт первого
    expect(r.sides[0].share).toBeCloseTo(0.5, 12)
  })
})

describe('rangeEquity: не считается', () => {
  const reason = (r: RangeEquity) => (r.ok ? null : r.reason)
  it('сторон меньше 2 или больше 6', () => {
    expect(reason(rangeEquity([range('AA')], []))).toContain('от 2 до 6')
    expect(reason(rangeEquity(Array.from({ length: 7 }, () => range('22+')), []))).toContain('от 2 до 6')
  })
  it('борд — не 0, 3, 4 и не 5 карт', () => {
    expect(reason(rangeEquity([range('AA'), range('KK')], cards('2c3c')))).toContain('0, 3, 4 или 5')
    expect(reason(rangeEquity([range('AA'), range('KK')], cards('2c3c4c5c6c7c')))).toContain('0, 3, 4 или 5')
  })
  it('в руке не 2 карты, не карта, повтор карты', () => {
    expect(reason(rangeEquity([hand('AsKsQs'), range('KK')], []))).toContain('2 карты')
    expect(reason(rangeEquity([hand('AsXx'), range('KK')], []))).toContain('Xx')
    expect(reason(rangeEquity([hand('AsKs'), hand('AsQd')], []))).toContain('дважды')
    expect(reason(rangeEquity([hand('AsKs'), range('QQ')], cards('Ks2c3d')))).toContain('дважды')
  })
  it('веса диапазона не те', () => {
    expect(reason(rangeEquity([{ range: [1, 1] }, range('KK')], []))).toContain('169')
    const bad = emptyRange()
    bad[0] = 2
    expect(reason(rangeEquity([{ range: bad }, range('KK')], []))).toContain('169')
  })
  it('пустой диапазон — и пустой после карт борда и рук', () => {
    expect(reason(rangeEquity([{ range: emptyRange() }, range('KK')], []))).toContain('Сторона 1: пустой')
    expect(reason(rangeEquity([hand('AsAh'), range('AA')], cards('Ad2c3c')))).toContain('Сторона 2: пустой')
  })
  it('нет ни одной раскладки без общих карт', () => {
    // Тузов четыре — на три пары тузов не хватит; точно и выборкой
    expect(reason(rangeEquity([range('AA'), range('AA'), range('AA')], cards('2c3d4h5s')))).toContain('Нет ни одной')
    expect(reason(rangeEquity([range('AA'), range('AA'), range('AA')], []))).toContain('Нет ни одной')
  })
  it('не падает — ответ', () => {
    expect(() => rangeEquity([], [])).not.toThrow()
  })
})
