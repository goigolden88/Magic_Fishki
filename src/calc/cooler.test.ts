import { describe, expect, it } from 'vitest'
import { HOLDEM_GAME, OMAHA_GAME, SHORT_DECK_GAME, type GameDef } from '../poker/game'
import type { HandLogEntry } from '../poker/hand'
import type { HandRecord, HandResult, RunRecord } from '../poker/table'
import { coolerOf } from './cooler'
import type { SavedHand } from './evenings'
import { historyList } from './pokerView'

const BB = 10

// Хедз-ап: a — кнопка и малый, b — большой; до флопа рейз a и колл b — каждый вложил to фишек
function bets(to: number): HandLogEntry[] {
  return [
    { street: 'preflop', playerId: 'a', type: 'raise', bet: to, allIn: false },
    { street: 'preflop', playerId: 'b', type: 'call', bet: to, allIn: false },
  ]
}

// Раздача дошла до вскрытия: у обоих карты открыты, банк — winners
function hand(opts: {
  game?: GameDef
  board: string[]
  a: string[]
  b: string[]
  winners: string[]
  put?: number
  runs?: RunRecord[]
}): HandResult {
  const put = opts.put ?? 25 * BB
  const record: HandRecord = {
    game: opts.game ?? HOLDEM_GAME,
    sb: BB / 2,
    bb: BB,
    seats: [
      { id: 'a', name: 'Аня', chips: 1000 },
      { id: 'b', name: 'Боря', chips: 1000 },
    ],
    button: 0,
    board: opts.board,
    log: bets(put),
    shown: { a: opts.a, b: opts.b },
    hands: { a: 'рука a', b: 'рука b' },
    hidden: null,
    ...(opts.runs ? { runs: opts.runs } : {}),
  }
  return { number: 7, pots: [{ amount: put * 2, winners: opts.winners }], payouts: {}, record }
}

const BOARD = ['Ah', 'Kh', '7h', '7d', '2c']
const FLUSH = ['Qh', 'Jh'] // флеш, старший туз
const FULL = ['Kd', 'Ks'] // фулл-хаус, короли и семёрки

describe('кулер (#262)', () => {
  it('холдем: флеш против фулл-хауса, вложено 25 ББ — кулер', () => {
    expect(coolerOf(hand({ board: BOARD, a: FLUSH, b: FULL, winners: ['b'] }))).toEqual({ winner: 'b', loser: 'a' })
  })

  it('холдем: стрит против флеша — нет', () => {
    const board = ['Th', '9h', '8h', '2c', '3d']
    expect(coolerOf(hand({ board, a: ['Jc', 'Qd'], b: ['Ah', '4h'], winners: ['b'] }))).toBeNull()
  })

  it('вложено 15 ББ — нет, ровно 20 ББ — кулер', () => {
    expect(coolerOf(hand({ board: BOARD, a: FLUSH, b: FULL, winners: ['b'], put: 15 * BB }))).toBeNull()
    expect(coolerOf(hand({ board: BOARD, a: FLUSH, b: FULL, winners: ['b'], put: 20 * BB }))).toEqual({ winner: 'b', loser: 'a' })
  })

  it('омаха: флеш против фулл-хауса — нет, фулл против каре — да', () => {
    const flush = ['Qh', 'Jh', '3s', '4s']
    const full = ['Kd', 'Ks', '5c', '6c']
    expect(coolerOf(hand({ game: OMAHA_GAME, board: BOARD, a: flush, b: full, winners: ['b'] }))).toBeNull()
    const quads = ['7s', '7c', '5d', '6d']
    const fullA = ['Kd', 'Ks', '3c', '4c']
    expect(coolerOf(hand({ game: OMAHA_GAME, board: BOARD, a: fullA, b: quads, winners: ['b'] }))).toEqual({ winner: 'b', loser: 'a' })
  })

  it('короткая колода — нет', () => {
    const board = ['Ah', 'Kh', '7h', '7d', '6c']
    expect(coolerOf(hand({ game: SHORT_DECK_GAME, board, a: FLUSH, b: FULL, winners: ['a'] }))).toBeNull()
  })

  it('своя игра с правилом холдема — нет', () => {
    const own: GameDef = { ...HOLDEM_GAME, id: 'own-1', name: 'Мой холдем' }
    expect(coolerOf(hand({ game: own, board: BOARD, a: FLUSH, b: FULL, winners: ['b'] }))).toBeNull()
  })

  it('без вскрытия и без записи — нет', () => {
    const h = hand({ board: BOARD, a: FLUSH, b: FULL, winners: ['b'] })
    const record = h.record as HandRecord
    expect(coolerOf({ ...h, record: { ...record, hands: { b: 'рука b' }, shown: { b: FULL } } })).toBeNull()
    expect(coolerOf({ number: 7, pots: h.pots, payouts: {} })).toBeNull()
  })

  it('несколько прогонов — по первому борду', () => {
    const second = ['Ah', 'Kh', '7h', '3d', '2c'] // флеш a бьёт пару королей b
    const run = (board: string[], winner: string): RunRecord => ({ board, hands: {}, best: {}, winners: [[winner]] })
    const twice = hand({ board: BOARD, a: FLUSH, b: FULL, winners: ['b', 'a'], runs: [run(BOARD, 'b'), run(second, 'a')] })
    expect(coolerOf(twice)).toEqual({ winner: 'b', loser: 'a' })
    // Первый борд без кулера, второй — с ним: нет
    const back = hand({ board: second, a: FLUSH, b: FULL, winners: ['a', 'b'], runs: [run(second, 'a'), run(BOARD, 'b')] })
    expect(coolerOf(back)).toBeNull()
  })

  it('история раздач: пометка «кулер» только у кулера', () => {
    const saved = (h: HandResult, number: number): SavedHand => ({ evening: 'e', code: null, startedAt: 0, number, hand: { ...h, number } })
    const yes = hand({ board: BOARD, a: FLUSH, b: FULL, winners: ['b'] })
    const no = hand({ board: BOARD, a: FLUSH, b: FULL, winners: ['b'], put: 15 * BB })
    expect(historyList([saved(yes, 1), saved(no, 2)]).map((i) => [i.number, i.cooler])).toEqual([
      [2, undefined],
      [1, true],
    ])
  })

  it('проигравших двое — тот, у кого рука сильнее', () => {
    const h = hand({ board: BOARD, a: FLUSH, b: FULL, winners: ['b'] })
    const record = h.record as HandRecord
    const three: HandResult = {
      ...h,
      record: {
        ...record,
        seats: [...record.seats, { id: 'c', name: 'Вера', chips: 1000 }],
        log: [...record.log, { street: 'preflop', playerId: 'c', type: 'call', bet: 25 * BB, allIn: false }],
        shown: { ...record.shown, c: ['9h', '8h'] },
        hands: { ...record.hands, c: 'рука c' },
      },
    }
    expect(coolerOf(three)).toEqual({ winner: 'b', loser: 'a' })
  })
})
