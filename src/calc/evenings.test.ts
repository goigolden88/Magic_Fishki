import { describe, expect, it } from 'vitest'
import type { HistoryHand } from '../poker/history'
import { createTable, type TableState } from '../poker/table'
import {
  botsEvening,
  byNewest,
  eveningLine,
  eveningTable,
  isBotsEvening,
  localEvening,
  roomEvening,
  savedHands,
  unsavedHands,
  type EveningSummary,
} from './evenings'

function table(now: number): TableState {
  const r = createTable('p0', 'Аня', {}, now)
  if (!r.ok) throw new Error(r.error)
  return r.state
}

function hand(number: number, amount = 100): HistoryHand {
  return { number, pots: [{ amount, winners: ['p0'] }], payouts: { p0: amount } }
}

describe('вечер стола', () => {
  it('комната — по коду и началу стола: тот же код в другой вечер — другой вечер', () => {
    const t = table(1000)
    expect(roomEvening('KQ7MZP', t, 'p0')).toEqual({ id: 'KQ7MZP-1000', code: 'KQ7MZP', startedAt: 1000, table: eveningTable(t, 'p0') })
    expect(roomEvening('KQ7MZP', table(2000), 'p0').id).not.toBe(roomEvening('KQ7MZP', t, 'p0').id)
  })

  it('стол на телефоне — по своему id, без кода; «я» нет — ходят за всех', () => {
    const t = table(5000)
    expect(localEvening('01X', t)).toEqual({ id: 'local-01X', code: null, startedAt: 5000, table: eveningTable(t, null) })
  })

  it('против ботов — свой вечер с пометкой; остальные — не боты', () => {
    const t = table(7000)
    const e = botsEvening('B1', t, 'p0')
    expect(e).toEqual({ id: 'bots-B1', code: null, startedAt: 7000, table: eveningTable(t, 'p0') })
    expect(isBotsEvening(e)).toBe(true)
    expect(isBotsEvening(localEvening('01X', t))).toBe(false)
    expect(eveningLine({ ...e, hands: 40 })).toBe('Против ботов · раздач 40')
  })

  it('стол вечера для выгрузки: игра, предел, блайнды, места; турнир — без анте', () => {
    const r = createTable('p0', 'Аня', { sb: 25, bb: 50, ante: 5, game: 'omaha', maxSeats: 6 }, 0)
    if (!r.ok) throw new Error(r.error)
    expect(eveningTable(r.state, 'p0')).toEqual({
      me: 'p0',
      game: 'omaha',
      limit: 'pot',
      sb: 25,
      bb: 50,
      ante: 5,
      maxSeats: 6,
      tournament: false,
    })
    expect(eveningTable(table(0), null)).toMatchObject({ me: null, game: 'holdem', limit: 'nolimit', ante: 0 })
  })

  it('записи раздач — с вечером, номером, столом и своими картами, если телефон их видел', () => {
    const e = roomEvening('KQ7MZP', table(1000), 'p0')
    expect(savedHands(e, [hand(3), hand(4)], new Map([[3, ['As', 'Kd']]]))).toEqual([
      { evening: 'KQ7MZP-1000', code: 'KQ7MZP', startedAt: 1000, number: 3, hand: hand(3), table: e.table, mine: ['As', 'Kd'] },
      { evening: 'KQ7MZP-1000', code: 'KQ7MZP', startedAt: 1000, number: 4, hand: hand(4), table: e.table },
    ])
    // Вечер без стола (записи до Р-54) — как раньше
    expect(savedHands({ id: 'A', code: null, startedAt: 1 }, [hand(1)])).toEqual([
      { evening: 'A', code: null, startedAt: 1, number: 1, hand: hand(1) },
    ])
  })
})

describe('что записать из ответа истории', () => {
  it('записанные не пишутся снова; новые и изменённые — пишутся', () => {
    const known = new Map([
      [1, JSON.stringify(hand(1))],
      [2, JSON.stringify(hand(2))],
    ])
    expect(unsavedHands(known, [hand(1), hand(2)])).toEqual([])
    expect(unsavedHands(known, [hand(1), hand(2, 500), hand(3)])).toEqual([hand(2, 500), hand(3)])
    expect(unsavedHands(new Map(), [hand(1)])).toEqual([hand(1)])
  })
})

describe('список прошлых вечеров', () => {
  const a: EveningSummary = { id: 'A-1', code: 'AAAAAA', startedAt: 1, hands: 12 }
  const b: EveningSummary = { id: 'local-B', code: null, startedAt: 2, hands: 3 }

  it('новые сверху', () => {
    expect(byNewest([a, b]).map((e) => e.id)).toEqual(['local-B', 'A-1'])
  })

  it('строка — код комнаты или «на телефоне» и число раздач', () => {
    expect(eveningLine(a)).toBe('Стол AAAAAA · раздач 12')
    expect(eveningLine(b)).toBe('Стол на телефоне · раздач 3')
  })
})
