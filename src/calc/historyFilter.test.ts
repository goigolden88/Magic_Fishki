import { describe, expect, it } from 'vitest'
import type { Card } from '../poker/cards'
import { HOLDEM_GAME, OMAHA_GAME } from '../poker/game'
import type { HistoryHand } from '../poker/history'
import type { HandRecord } from '../poker/table'
import type { EveningTable, SavedHand } from './evenings'
import { historyRows, isPicked, NO_PICK, pickHistory, pickOptions, type HistoryPick } from './historyFilter'

const TABLE: EveningTable = { me: 'a', game: 'holdem', limit: 'nolimit', sb: 5, bb: 10, ante: 0, maxSeats: 9, tournament: false }

// Хедз-ап Аня (a, телефон) и Боря (b): до флопа рейз до put и колл; банк берёт winner.
// button 0 — Аня на кнопке (BTN/SB), 1 — на большом (BB); showdown — дошли до вскрытия
function saved(opts: { number: number; mine: Card[]; board?: Card[]; winner?: 'a' | 'b'; put?: number; button?: number; showdown?: boolean; omaha?: boolean }): SavedHand {
  const put = opts.put ?? 20
  const winner = opts.winner ?? 'a'
  const showdown = opts.showdown ?? true
  const record: HandRecord = {
    game: opts.omaha ? OMAHA_GAME : HOLDEM_GAME,
    sb: 5,
    bb: 10,
    seats: [
      { id: 'a', name: 'Аня', chips: 1000 },
      { id: 'b', name: 'Боря', chips: 1000 },
    ],
    button: opts.button ?? 0,
    board: opts.board ?? [],
    log: [
      { street: 'preflop', playerId: opts.button === 1 ? 'b' : 'a', type: 'raise', bet: put, allIn: false },
      { street: 'preflop', playerId: opts.button === 1 ? 'a' : 'b', type: 'call', bet: put, allIn: false },
    ],
    shown: showdown ? { a: opts.mine, b: ['2c', '3d'] } : {},
    hands: showdown ? { a: 'рука a', b: 'рука b' } : {},
    hidden: null,
  }
  const hand: HistoryHand = { number: opts.number, pots: [{ amount: put * 2, winners: [winner] }], payouts: { [winner]: put * 2 }, record }
  return { evening: 'e', code: null, startedAt: 0, number: opts.number, hand, table: TABLE, mine: opts.mine }
}

// Живые карты: записи с картами нет — ни стола, ни вскрытия; на одном телефоне — меня нет
function live(number: number): SavedHand {
  const seats = [
    { id: 'a', name: 'Аня', chips: 1000 },
    { id: 'b', name: 'Боря', chips: 1000 },
  ]
  const hand: HistoryHand = { number, pots: [{ amount: 300, winners: ['b'] }], payouts: { b: 300 }, live: { seats, button: 0, log: [] } }
  return { evening: 'e', code: null, startedAt: 0, number, hand, table: { ...TABLE, me: null } }
}

const FLOP: Card[] = ['2s', '7h', '9d']
const RIVER: Card[] = ['2s', '7h', '9d', 'Jc', '3s']

const HANDS = [
  saved({ number: 1, mine: ['Ah', 'Kd'], board: RIVER, winner: 'a', put: 50 }), // +50, BTN/SB, ривер, вскрытие
  saved({ number: 2, mine: ['7c', '7d'], board: FLOP, winner: 'b', put: 30, button: 1, showdown: false }), // −30, BB, флоп
  saved({ number: 3, mine: ['Qs', 'Js'], winner: 'a', put: 10, showdown: false }), // +10, BTN/SB, префлоп
  live(4),
  saved({ number: 5, mine: ['9h', '8h'], board: RIVER.slice(0, 4), winner: 'b', put: 100, button: 1 }), // −100, BB, тёрн
]

const pick = (p: Partial<HistoryPick>) => pickHistory(historyRows(HANDS), { ...NO_PICK, ...p })
const numbers = (p: Partial<HistoryPick>) => pick(p).rows.map((r) => r.number)

describe('история раздач: отбор и сортировка (#294)', () => {
  it('признаки строки: банк, улица по картам стола, вскрытие; у живых карт улицы и вскрытия нет', () => {
    const rows = historyRows(HANDS)
    expect(rows.map((r) => [r.number, r.pot, r.street, r.showdown])).toEqual([
      [5, 200, 'turn', true],
      [4, 300, null, null],
      [3, 20, 'preflop', false],
      [2, 60, 'flop', false],
      [1, 100, 'river', true],
    ])
    expect(rows.map((r) => r.mine?.net ?? null)).toEqual([-100, null, 10, -30, 50])
  })

  it('без выбора — как сейчас: новые сверху, всё', () => {
    expect(numbers({})).toEqual([5, 4, 3, 2, 1])
    expect(isPicked(NO_PICK)).toBe(false)
  })

  it('сортировка: старые, по выигрышу, по проигрышу, по банку; без итога — в конце', () => {
    expect(numbers({ sort: 'old' })).toEqual([1, 2, 3, 4, 5])
    expect(numbers({ sort: 'won' })).toEqual([1, 3, 2, 5, 4])
    expect(numbers({ sort: 'lost' })).toEqual([5, 2, 3, 1, 4])
    expect(numbers({ sort: 'pot' })).toEqual([4, 5, 1, 2, 3])
    expect(isPicked({ ...NO_PICK, sort: 'pot' })).toBe(true)
  })

  it('итог: в плюс, в минус — раздачу без итога не берёт', () => {
    expect(numbers({ result: 'plus' })).toEqual([3, 1])
    expect(numbers({ result: 'minus' })).toEqual([5, 2])
  })

  it('моя рука диапазоном, как в чартах', () => {
    expect(numbers({ range: '77+, AKo' })).toEqual([2, 1])
    expect(numbers({ range: 'QJs, 98s' })).toEqual([5, 3])
    expect(numbers({ range: 'AKs' })).toEqual([])
    // Не разобрать — ошибка, отбор по руке не идёт
    const bad = pick({ range: '77+, XYZ' })
    expect(bad.rangeError).toBe('Не понял «XYZ»')
    expect(bad.rows.map((r) => r.number)).toEqual([5, 4, 3, 2, 1])
    expect(isPicked({ ...NO_PICK, range: ' ' })).toBe(false)
  })

  it('позиция, улица, вскрытие — у живых карт отбор по ним раздачу не берёт', () => {
    expect(numbers({ position: 'BB' })).toEqual([5, 2])
    expect(numbers({ position: 'BTN/SB' })).toEqual([3, 1])
    expect(numbers({ street: 'preflop' })).toEqual([3])
    expect(numbers({ street: 'river' })).toEqual([1])
    expect(numbers({ showdown: 'yes' })).toEqual([5, 1])
    expect(numbers({ showdown: 'no' })).toEqual([3, 2])
  })

  it('отборы сочетаются', () => {
    expect(numbers({ result: 'minus', showdown: 'yes' })).toEqual([5])
    expect(numbers({ position: 'BB', street: 'flop', sort: 'old' })).toEqual([2])
    expect(numbers({ result: 'plus', range: '22+' })).toEqual([])
  })

  it('что показать в «Отборе»: позиции по кругу; рука — только у рук из двух карт', () => {
    expect(pickOptions(historyRows(HANDS))).toEqual({ range: true, result: true, positions: ['BTN/SB', 'BB'], streets: true, showdown: true })
    const omaha = [saved({ number: 1, mine: ['Ah', 'Kd', 'Qs', 'Jc'], omaha: true })]
    expect(pickOptions(historyRows(omaha)).range).toBe(false)
    // Одна рука омахи в диапазон не попадает
    expect(pickHistory(historyRows(omaha), { ...NO_PICK, range: 'AK' }).rows).toEqual([])
    // Стол на одном телефоне с живыми картами — меня нет, стола нет: только сортировка
    expect(pickOptions(historyRows([live(1)]))).toEqual({ range: false, result: false, positions: [], streets: false, showdown: false })
  })
})
