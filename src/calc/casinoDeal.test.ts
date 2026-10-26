import { describe, expect, it } from 'vitest'
import { bestHand, buildDeck, HOLDEM } from '../poker/cards'
import type { Game } from '../model'
import { addRound, gameResult, roundSum } from './casino'
import {
  boardResult,
  cardsUsed,
  dealFromDeck,
  maxPlayers,
  maxTables,
  newDeal,
  roundShares,
  sharesToRound,
  tableParts,
  type Deal,
} from './casinoDeal'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`)

describe('предел столов по колоде', () => {
  it('примеры из задачи: холдем — 13 участников на 5 столах, омаха — 6, омаха на 7 — не больше 4 столов', () => {
    expect(maxPlayers('holdem', 5)).toBe(13)
    expect(maxTables('holdem', 13)).toBe(5)
    expect(maxTables('holdem', 14)).toBe(4)
    expect(maxPlayers('omaha', 5)).toBe(6)
    expect(maxTables('omaha', 6)).toBe(5)
    expect(maxTables('omaha', 7)).toBe(4)
  })

  it('карт: участники × карты руки + столы × 5; не хватает и на один стол — 0', () => {
    expect(cardsUsed('omaha', 7, 4)).toBe(48)
    expect(cardsUsed('holdem', 13, 5)).toBe(51)
    expect(maxTables('omaha', 12)).toBe(0)
    expect(maxPlayers('omaha', 1)).toBe(11)
  })

  it('раздать больше, чем хватает карт, нельзя', () => {
    expect(() => newDeal('omaha', ids(7), 5)).toThrow('не хватит')
    expect(() => newDeal('holdem', ids(14), 5)).toThrow('не хватит')
    expect(() => newDeal('holdem', ids(1), 5)).toThrow()
    expect(() => newDeal('holdem', ids(3), 0)).toThrow()
    expect(() => newDeal('holdem', ['a', 'a'], 1)).toThrow('повторяется')
  })
})

describe('раздача', () => {
  it('без повторов: все карты разные и из колоды — холдем 13 × 2 + 5 столов, омаха 6 × 4 + 5 столов', () => {
    for (let n = 0; n < 20; n++) {
      for (const [kind, players] of [
        ['holdem', 13],
        ['omaha', 6],
      ] as const) {
        const deal = newDeal(kind, ids(players), 5)
        const cards = [...Object.values(deal.hands).flat(), ...deal.boards.flat()]
        expect(cards).toHaveLength(cardsUsed(kind, players, 5))
        expect(new Set(cards).size).toBe(cards.length)
        for (const c of cards) expect(buildDeck(HOLDEM)).toContain(c)
        for (const id of deal.ids) expect(deal.hands[id]).toHaveLength(kind === 'holdem' ? 2 : 4)
        for (const b of deal.boards) expect(b).toHaveLength(5)
      }
    }
  })

  it('из колоды по порядку: в руки по одной по кругу, затем столы по 5 подряд', () => {
    const deck = buildDeck(HOLDEM)
    const deal = dealFromDeck('holdem', ['a', 'b'], 2, deck)
    expect(deal.hands).toEqual({ a: [deck[0], deck[2]], b: [deck[1], deck[3]] })
    expect(deal.boards).toEqual([deck.slice(4, 9), deck.slice(9, 14)])
  })
})

describe('победители столов', () => {
  it('лучшая рука берёт стол, рука подписана', () => {
    const deal: Deal = {
      kind: 'holdem',
      ids: ['a', 'b'],
      hands: { a: ['Ah', 'Kh'], b: ['2c', '7d'] },
      boards: [['Qh', 'Jh', '3h', '8s', '9c']],
    }
    expect(boardResult(deal, 0)).toEqual({ winners: ['a'], hand: 'Флеш, старший туз' })
  })

  it('ничья — все с лучшей рукой, в порядке участников', () => {
    const deal: Deal = {
      kind: 'holdem',
      ids: ['a', 'b', 'c'],
      hands: { a: ['2c', '3d'], b: ['4c', '5d'], c: ['7c', '8d'] },
      boards: [['As', 'Ks', 'Qs', 'Js', 'Ts']],
    }
    expect(boardResult(deal, 0)).toEqual({ winners: ['a', 'b', 'c'], hand: 'Роял-флеш' })
  })

  it('омаха — ровно 2 из руки: одна черва в руке и четыре на столе — не флеш', () => {
    const board = ['Qh', 'Jh', '9h', '5h', '2d']
    const hands = { a: ['Ah', '2c', '3d', '4s'], b: ['Kd', 'Kc', '7s', '8c'] }
    // В холдеме у a был бы флеш — любые из руки и стола
    expect(bestHand(HOLDEM, hands.a, board).category).toBe('flush')
    const deal: Deal = { kind: 'omaha', ids: ['a', 'b'], hands, boards: [board] }
    expect(boardResult(deal, 0)).toEqual({ winners: ['b'], hand: 'Пара, короли' })
  })
})

describe('раунд в ноль', () => {
  it('банк поровну на столы: 3 по 100 ₽ на 5 столов — по 60 ₽', () => {
    expect(tableParts(30_000, 5)).toEqual([6000, 6000, 6000, 6000, 6000])
    const shares = roundShares(10_000, ['a', 'b', 'c'], [['a'], ['a'], ['b'], ['a'], ['c']])
    expect(shares).toEqual([
      { id: 'a', won: 18_000, net: 8000 },
      { id: 'b', won: 6000, net: -4000 },
      { id: 'c', won: 6000, net: -4000 },
    ])
  })

  it('остаток копеек — по одной: первым столам, на ничьей — первым по порядку участников', () => {
    // Банк 300 коп. на 7 столов: шесть по 43 и один 42
    expect(tableParts(300, 7)).toEqual([43, 43, 43, 43, 43, 43, 42])
    const shares = roundShares(100, ['a', 'b', 'c'], [['a'], ['b', 'c'], ['a', 'b', 'c'], ['c'], ['a'], ['b'], ['c']])
    // a: 43 + 15 + 43; b: 22 + 14 + 43; c: 21 + 14 + 43 + 42
    expect(shares.map((s) => s.won)).toEqual([101, 79, 120])
    expect(shares.map((s) => s.net)).toEqual([1, -21, 20])
    expect(shares.reduce((s, x) => s + x.net, 0)).toBe(0)
  })

  it('случайные раунды всегда в ноль', () => {
    for (let n = 0; n < 50; n++) {
      const players = ids(2 + (n % 12))
      const tables = Math.max(1, maxTables('holdem', players.length) - (n % 3))
      const deal = newDeal('holdem', players, tables)
      const stake = 1 + n * 37
      const shares = roundShares(
        stake,
        deal.ids,
        deal.boards.map((_, i) => boardResult(deal, i).winners),
      )
      expect(shares.reduce((s, x) => s + x.net, 0)).toBe(0)
      expect(shares.reduce((s, x) => s + x.won, 0)).toBe(stake * players.length)
    }
  })

  it('записанный раунд — как введённый строкой: доли по участникам игры, нулевые не пишутся, сумма — ноль', () => {
    const game: Game = {
      id: 'g',
      name: 'Игра',
      date: '2026-10-26',
      rate: 0.5,
      players: [
        { id: 'a', name: 'Эрик' },
        { id: 'b', name: 'Артём' },
        { id: 'c', name: 'Арман' },
      ],
      entries: [],
      updatedAt: '2026-10-26T20:00:00.000Z',
    }
    const names = new Map(game.players.map((p) => [p.id, p.name]))
    const round = sharesToRound(roundShares(10_000, ['a', 'b', 'c'], [['a'], ['a'], ['b']]), names)
    expect(round).toEqual({
      amounts: [
        { name: 'Эрик', kopecks: 10_000 },
        { name: 'Артём', kopecks: 0 },
        { name: 'Арман', kopecks: -10_000 },
      ],
      sum: 0,
      bad: [],
    })
    let k = 0
    const won = addRound(game, round, [], () => `id${k++}`, '2026-10-26T21:00:00.000Z')
    expect(won.players).toEqual(game.players)
    expect(won.casino).toHaveLength(1)
    expect(won.casino![0].amounts).toEqual([
      { playerId: 'a', kopecks: 10_000 },
      { playerId: 'c', kopecks: -10_000 },
    ])
    expect(roundSum(won.casino![0])).toBe(0)
    expect(gameResult(won).casinoOk).toBe(true)
  })
})
