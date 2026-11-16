import { describe, expect, it } from 'vitest'
import type { Card } from '../poker/cards'
import { HOLDEM_GAME, OMAHA_GAME, SHORT_DECK_GAME, type GameDef } from '../poker/game'
import type { HandLogEntry, Street } from '../poker/hand'
import type { HistoryHand } from '../poker/history'
import type { HandRecord } from '../poker/table'
import type { EveningTable, SavedHand } from './evenings'
import { parseTrainerPath, trainerHash, trainerHashOf, trainerStart } from './trainerFromHand'

const TABLE: EveningTable = { me: 'p0', game: 'holdem', limit: 'nolimit', sb: 5, bb: 10, ante: 0, maxSeats: 9, tournament: false }

const move = (playerId: string, type: HandLogEntry['type'], street: Street = 'preflop', bet = 0): HandLogEntry => ({
  street,
  playerId,
  type,
  bet,
  allIn: false,
})

// Раздача холдема на n мест: p0…p(n−1), кнопка — p0; остальное — поверх
function record(n: number, over: Partial<HandRecord> = {}): HandRecord {
  return {
    game: HOLDEM_GAME,
    sb: 5,
    bb: 10,
    seats: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, chips: 1000 })),
    button: 0,
    board: [],
    log: [],
    shown: {},
    hands: {},
    hidden: null,
    ...over,
  }
}

function saved(rec: HandRecord | undefined, opts: { me?: string | null; mine?: Card[]; table?: boolean } = {}): SavedHand {
  const hand: HistoryHand = { number: 1, pots: [{ amount: 30, winners: [] }], payouts: {}, ...(rec ? { record: rec } : {}) }
  return {
    evening: 'KQ7MZP-1',
    code: 'KQ7MZP',
    startedAt: 1,
    number: 1,
    hand,
    ...(opts.table === false ? {} : { table: { ...TABLE, me: opts.me === undefined ? 'p0' : opts.me } }),
    ...(opts.mine ? { mine: opts.mine } : {}),
  }
}

describe('раздача из истории — стороны калькулятора (#221)', () => {
  it('пас на префлопе: мои карты — из копии на телефоне, взявший без вскрытия — пустым диапазоном', () => {
    // Трое: p1 повысил, p2 и я сбросили — банк у p1 без вскрытия
    const rec = record(3, {
      log: [move('p1', 'raise', 'preflop', 30), move('p2', 'fold'), move('p0', 'fold')],
      hidden: { playerId: 'p1', cards: ['Ah', 'Ad'] },
    })
    expect(trainerStart(saved(rec, { mine: ['7c', '2d'] }))).toEqual({ sides: [['7c', '2d'], null], board: [] })
  })

  it('вскрытие троих: я и двое — рукой, борд раздачи', () => {
    const board = ['2s', '7h', '9d', 'Jc', '3s']
    const rec = record(3, {
      board,
      log: [move('p1', 'call'), move('p2', 'check'), move('p0', 'check'), move('p1', 'check', 'river')],
      shown: { p0: ['Kh', 'Qh'], p1: ['Ac', 'Ad'], p2: ['5c', '6c'] },
    })
    expect(trainerStart(saved(rec, { mine: ['Kh', 'Qh'] }))).toEqual({ sides: [['Kh', 'Qh'], ['Ac', 'Ad'], ['5c', '6c']], board })
  })

  it('выиграл без вскрытия соперник — у него пустой диапазон, его карты в адрес не попадают', () => {
    const rec = record(2, {
      board: ['2s', '7h', '9d'],
      log: [move('p0', 'call'), move('p1', 'check'), move('p1', 'raise', 'flop', 50), move('p0', 'fold', 'flop')],
      hidden: { playerId: 'p1', cards: ['Ah', 'Ad'] },
    })
    const s = saved(rec, { mine: ['Kh', 'Qh'] })
    expect(trainerStart(s)).toEqual({ sides: [['Kh', 'Qh'], null], board: ['2s', '7h', '9d'] })
    const hash = trainerHashOf(s)
    expect(hash).toBe('#/poker/trainer?side=KhQh&side=&board=2s7h9d')
    expect(hash).not.toContain('Ah')
    expect(hash).not.toContain('Ad')
  })

  it('выиграл без вскрытия я — мои карты из записи взятого банка', () => {
    const rec = record(3, {
      log: [move('p1', 'fold'), move('p2', 'fold')],
      hidden: { playerId: 'p0', cards: ['Ts', 'Th'] },
    })
    // Остальные сбросили на префлопе — последней улице: оба пустым диапазоном
    expect(trainerStart(saved(rec))).toEqual({ sides: [['Ts', 'Th'], null, null], board: [] })
  })

  it('мои вскрытые карты — рукой, если копии своих нет', () => {
    const rec = record(2, { log: [move('p0', 'call'), move('p1', 'check')], shown: { p0: ['9s', '9h'], p1: [null, null] } })
    expect(trainerStart(saved(rec))).toEqual({ sides: [['9s', '9h'], null], board: [] })
  })

  it('нет своих карт (запись до Р-54, стола вечера нет) — без моей стороны', () => {
    const rec = record(3, {
      log: [move('p1', 'fold'), move('p2', 'fold')],
      hidden: { playerId: 'p0', cards: ['Ts', 'Th'] },
    })
    // Не знаем, кто я: карты взявшего без вскрытия не видны никому — он и сбросившие на префлопе пустыми
    expect(trainerStart(saved(rec, { table: false }))).toEqual({ sides: [null, null, null], board: [] })
    // Знаем, кто я, но карт не видели — тоже без моей стороны
    const two = record(3, { log: [move('p1', 'call'), move('p2', 'check')] })
    expect(trainerStart(saved(two, { me: 'p2' }))).toEqual({ sides: [null, null], board: [] })
  })

  it('сбросивший с показанными картами — рукой; сбросивший раньше последней улицы — не сторона', () => {
    const rec = record(4, {
      board: ['2s', '7h', '9d'],
      log: [move('p1', 'call'), move('p2', 'call'), move('p3', 'fold'), move('p0', 'call'), move('p1', 'check', 'flop'), move('p2', 'fold', 'flop'), move('p0', 'check', 'flop')],
      shown: { p2: ['Qs', 'Qd'] },
    })
    expect(trainerStart(saved(rec, { mine: ['Kh', 'Qh'] }))).toEqual({ sides: [['Kh', 'Qh'], ['Qs', 'Qd'], null], board: ['2s', '7h', '9d'] })
  })

  it('9 мест, вскрытие семерых — ровно 6 сторон: я, затем по местам от кнопки', () => {
    const hole: Card[][] = [['Ah', 'Kh'], ['2c', '3c'], ['4c', '5c'], ['6c', '7c'], ['8c', '9c'], ['Tc', 'Jc'], ['Qc', 'Kc']]
    const shown: Record<string, Card[]> = {}
    hole.forEach((cards, i) => (shown[`p${i}`] = cards))
    const rec = record(9, { board: ['2s', '7h', '9d', 'Jd', '3s'], log: [move('p7', 'fold'), move('p8', 'fold')], shown })
    const start = trainerStart(saved(rec, { mine: ['Ah', 'Kh'] }))
    expect(start?.sides).toHaveLength(6)
    expect(start?.sides).toEqual([['Ah', 'Kh'], ['2c', '3c'], ['4c', '5c'], ['6c', '7c'], ['8c', '9c'], ['Tc', 'Jc']])
  })

  it('прогнали несколько раз — общая часть бордов', () => {
    const run = (board: Card[]) => ({ board, hands: {}, best: {}, winners: [] })
    const rec = record(2, {
      board: ['2s', '7h', '9d', 'Jd', '3s'],
      log: [move('p0', 'call'), move('p1', 'raise', 'preflop', 1000), move('p0', 'call', 'preflop', 1000)],
      shown: { p0: ['Kh', 'Qh'], p1: ['Ac', 'Ad'] },
      runs: [run(['2s', '7h', '9d', 'Jd', '3s']), run(['2s', '7h', '9d', '4c', '5d'])],
    })
    expect(trainerStart(saved(rec, { mine: ['Kh', 'Qh'] }))).toEqual({ sides: [['Kh', 'Qh'], ['Ac', 'Ad']], board: ['2s', '7h', '9d'] })
  })

  it('омаха, шорт-дек, своя игра и живые карты — null, кнопки нет', () => {
    const own: GameDef = { ...HOLDEM_GAME, id: 'own-x', name: 'Своя' }
    for (const game of [OMAHA_GAME, SHORT_DECK_GAME, own]) {
      expect(trainerStart(saved(record(2, { game })))).toBeNull()
      expect(trainerHashOf(saved(record(2, { game })))).toBeNull()
    }
    expect(trainerStart(saved(undefined))).toBeNull()
  })
})

describe('адрес калькулятора (#221)', () => {
  it('туда и обратно — те же стороны и борд', () => {
    const start = { sides: [['As', 'Ks'], null, ['Qh', 'Qd']], board: ['2c', '7d', '9h', 'Tc'] }
    const hash = trainerHash(start)
    expect(hash).toBe('#/poker/trainer?side=AsKs&side=&side=QhQd&board=2c7d9hTc')
    expect(parseTrainerPath(hash.slice(1))).toEqual(start)
  })

  it('без параметров — с чистого листа', () => {
    expect(parseTrainerPath('/poker/trainer')).toBeNull()
    expect(parseTrainerPath('/poker/trainer?')).toBeNull()
  })

  it('одна сторона — вторая пустым диапазоном', () => {
    expect(parseTrainerPath('/poker/trainer?side=AsKs')).toEqual({ sides: [['As', 'Ks'], null], board: [] })
  })

  it('кривые параметры отбрасываются', () => {
    const bad = [
      'side=AsXs&side=', // карта не из колоды
      'side=asKs&side=', // ранг строчной
      'side=AsKs&side=AsQd', // повтор между сторонами
      'side=AsKs&side=&board=As7d9h', // повтор с бордом
      'side=AsKsQs&side=', // три карты
      'side=As&side=', // одна карта
      'side=&side=&side=&side=&side=&side=&side=', // больше 6 сторон
      'side=AsKs&side=&board=2c7d', // борд из двух
      'side=AsKs&side=&board=2c', // борд из одной
      'side=AsKs&side=&board=2c7d9hTcJcQc', // борд из шести
      'side=AsKs&side=&board=2c7d9&', // нечётная запись
      'side=AsKs&side=&board=2c7d9h&board=Tc', // два борда
    ]
    for (const q of bad) expect(parseTrainerPath(`/poker/trainer?${q}`), q).toBeNull()
  })
})
