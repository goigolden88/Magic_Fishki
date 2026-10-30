import { describe, expect, it } from 'vitest'
import type { HistoryHand } from '../poker/history'
import { createTable, type TableState } from '../poker/table'
import { byNewest, eveningLine, localEvening, roomEvening, savedHands, unsavedHands, type EveningSummary } from './evenings'

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
    expect(roomEvening('KQ7MZP', table(1000))).toEqual({ id: 'KQ7MZP-1000', code: 'KQ7MZP', startedAt: 1000 })
    expect(roomEvening('KQ7MZP', table(2000)).id).not.toBe(roomEvening('KQ7MZP', table(1000)).id)
  })

  it('стол на телефоне — по своему id, без кода', () => {
    expect(localEvening('01X', table(5000))).toEqual({ id: 'local-01X', code: null, startedAt: 5000 })
  })

  it('записи раздач — с вечером и номером', () => {
    const e = roomEvening('KQ7MZP', table(1000))
    expect(savedHands(e, [hand(3)])).toEqual([{ evening: 'KQ7MZP-1000', code: 'KQ7MZP', startedAt: 1000, number: 3, hand: hand(3) }])
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
