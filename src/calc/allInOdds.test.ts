import { describe, expect, it } from 'vitest'
import { buildDeck, HOLDEM, OMAHA, SHORT_DECK, winners, type Card, type Variant } from '../poker/cards'
import { allin, call, check, fold, newTable, play, raise, stackedDeck, start } from '../poker/testing'
import { viewFor, type HandRecord } from '../poker/table'
import { allInOdds, equity, percents } from './allInOdds'

// Образец — полный перебор досдач через winners из правил покера (медленно, только с флопа и тёрна)
function reference(variant: Variant, hands: Card[][], board: Card[]): number[] {
  const used = new Set([...board, ...hands.flat()])
  const rest = buildDeck(variant).filter((c) => !used.has(c))
  const shares = hands.map(() => 0)
  let runs = 0
  const each = (from: number, picked: Card[]) => {
    if (board.length + picked.length === 5) {
      const won = winners(variant, [...board, ...picked], hands.map((cards, i) => ({ id: String(i), cards })))
      for (const id of won) shares[Number(id)] += 1 / won.length
      runs++
      return
    }
    for (let i = from; i < rest.length; i++) each(i + 1, [...picked, rest[i]])
  }
  each(0, [])
  return shares.map((s) => s / runs)
}

function expectSame(variant: Variant, hands: Card[][], board: Card[]) {
  const got = equity(variant, hands, board, 5)
  const want = reference(variant, hands, board)
  expect(got).toHaveLength(want.length)
  got?.forEach((s, i) => expect(s).toBeCloseTo(want[i], 10))
}

describe('шансы на ва-банке: расчёт', () => {
  it('тёрн: у королей два аута из 44 — 95 % и 5 %', () => {
    const shares = equity(HOLDEM, [['As', 'Ah'], ['Ks', 'Kh']], ['2c', '7d', '9h', 'Js'], 5)
    expect(shares?.[1]).toBeCloseTo(2 / 44, 12)
    expect(percents(shares!)).toEqual([95, 5])
  })

  it('флоп: пара против двух старших — как полный перебор по правилам', () => {
    const hands = [['9c', '9s'], ['Ah', 'Kd']]
    const board = ['2s', '5d', '7h']
    expectSame(HOLDEM, hands, board)
    const [pair, overs] = percents(equity(HOLDEM, hands, board, 5)!)
    expect(pair + overs).toBe(100)
    expect(overs).toBeGreaterThan(20)
    expect(overs).toBeLessThan(30)
  })

  it('ничья: оба играют стол — по 50 %', () => {
    const shares = equity(HOLDEM, [['2c', '3d'], ['2h', '3s']], ['Ah', 'Kd', 'Qc', 'Js'], 5)
    expect(shares).toEqual([0.5, 0.5])
    expect(percents(shares!)).toEqual([50, 50])
  })

  it('до флопа: тузы против королей ≈ 82/18 — выборкой, одинаково при каждом запуске', () => {
    const hands = [['As', 'Ah'], ['Kd', 'Kc']]
    const first = percents(equity(HOLDEM, hands, [], 5)!)
    expect(first[0]).toBeGreaterThanOrEqual(81)
    expect(first[0]).toBeLessThanOrEqual(83)
    expect(first[0] + first[1]).toBe(100)
    expect(percents(equity(HOLDEM, hands, [], 5)!)).toEqual(first)
  })

  it('омаха: только две из руки — одна червь при четырёх на столе флеша не даёт', () => {
    // У первого пара королей, у второго тройка девяток; спасут первого только два оставшихся короля из 40
    const shares = equity(OMAHA, [['Kh', 'Kc', 'Qd', 'Js'], ['9c', '9d', 'Ts', '8s']], ['Ah', '9h', '6h', '3h'], 5)
    expect(shares?.[0]).toBeCloseTo(2 / 40, 12)
    expect(percents(shares!)).toEqual([5, 95])
    expectSame(OMAHA, [['Ah', 'Kh', 'Qd', 'Jd'], ['Tc', 'Ts', '8c', '7c'], ['5s', '6s', 'As', '2d']], ['9d', '2c', '3h'])
  })

  it('шорт-дек: флеш старше фулл-хауса, колода 36; младший стрит A-6-7-8-9', () => {
    // У второго фулл-хаус — по шорт-деку он слабее флеша; спасает его только последний король (каре) из 28
    const shares = equity(SHORT_DECK, [['Ah', 'Th'], ['Ks', '9s']], ['Kh', 'Kd', '9h', '7h'], 5)
    expect(shares?.[1]).toBeCloseTo(1 / 28, 12)
    expect(percents(shares!)).toEqual([96, 4])
    expectSame(SHORT_DECK, [['Ad', '9c'], ['Kd', 'Ks']], ['6c', '7d', '8s'])
    expectSame(SHORT_DECK, [['Ac', 'Qc'], ['Jd', 'Jh'], ['8h', '9h']], ['Tc', '6c', 'Jc'])
  })

  it('трое: у каждого свой шанс, сумма — 100; до флопа — быстро и одинаково', () => {
    expectSame(HOLDEM, [['Ah', 'Kh'], ['Qs', 'Qd'], ['7c', '8c']], ['9c', 'Th', '2d'])
    const hands = [['Ah', 'Kh'], ['Qs', 'Qd'], ['7c', '8c']]
    const started = Date.now()
    const first = percents(equity(HOLDEM, hands, [], 5)!)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(first.reduce((a, b) => a + b, 0)).toBe(100)
    expect(first.every((p) => p > 0)).toBe(true)
    expect(percents(equity(HOLDEM, hands, [], 5)!)).toEqual(first)
  })

  it('омаха втроём до флопа — самый долгий случай, не дольше секунды', () => {
    const omaha = [['Ah', 'Kh', 'Qd', 'Jd'], ['Tc', 'Ts', '8c', '7c'], ['5s', '6s', 'As', '2d']]
    const t = Date.now()
    expect(percents(equity(OMAHA, omaha, [], 5)!).reduce((a, b) => a + b, 0)).toBe(100)
    expect(Date.now() - t).toBeLessThan(1000)
  })

  it('округление: разница — первому', () => {
    expect(percents([1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33])
    expect(percents([0.725, 0.275])).toEqual([72, 28])
  })

  it('неверные карты или повтор — null, а не случайный ответ', () => {
    expect(equity(HOLDEM, [['As', 'Ah'], ['As', 'Kh']], [], 5)).toBeNull()
    expect(equity(SHORT_DECK, [['As', 'Ah'], ['2s', 'Kh']], [], 5)).toBeNull()
  })
})

describe('шансы на ва-банке: по записи раздачи', () => {
  const PHONES = { cards: 'phones' as const }
  const recordOf = (s: ReturnType<typeof play>): HandRecord => s.lastHand!.record!

  it('ва-банк до флопа — улица «префлоп», по местам', () => {
    // Хедз-ап: кнопка p0, сдача с p1
    const deck = stackedDeck([['Kd', 'Kc'], ['As', 'Ah']])
    const s = play(newTable(['p0', 'p1'], PHONES), [start('p0', deck), allin('p0'), call('p1')], false)
    const odds = allInOdds(recordOf(viewFor(s, 'p1')))
    expect(odds?.street).toBe('preflop')
    expect(odds?.players.map((p) => p.name)).toEqual(['P0', 'P1'])
    expect(odds!.players[0].percent).toBeGreaterThanOrEqual(81)
    expect(odds!.players[0].percent).toBeLessThanOrEqual(83)
  })

  it('ва-банк на флопе — по трём картам стола; сбросивший не в счёт', () => {
    const deck = stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s'])
    const s = play(newTable(['p0', 'p1', 'p2'], PHONES), [start('p0', deck), call('p0'), fold('p1'), check('p2'), allin('p2'), call('p0')], false)
    const odds = allInOdds(recordOf(s))
    expect(odds?.street).toBe('flop')
    expect(odds?.players.map((p) => p.name)).toEqual(['P0', 'P2'])
    const want = percents(reference(HOLDEM, [['Ah', 'Ad'], ['2c', '7d']], ['2s', '7h', '9d']))
    expect(odds?.players.map((p) => p.percent)).toEqual(want)
  })

  it('торги закрылись на ривере или банк без вскрытия — шансов нет', () => {
    const deck = stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s'])
    const steps = [start('p0', deck), call('p0'), fold('p1'), check('p2'), raise('p2', 20), call('p0')]
    for (let k = 0; k < 2; k++) steps.push(check('p2'), check('p0'))
    expect(allInOdds(recordOf(play(newTable(['p0', 'p1', 'p2'], PHONES), steps, false)))).toBeNull()
    const quiet = play(newTable(['p0', 'p1', 'p2'], PHONES), [start('p0', deck), raise('p0', 30), fold('p1'), fold('p2')], false)
    expect(allInOdds(recordOf(quiet))).toBeNull()
  })
})
