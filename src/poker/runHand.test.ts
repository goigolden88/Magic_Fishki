import { describe, expect, it } from 'vitest'
import { award, call, check, MODES, newTable, play, raise, start } from './testing'
import type { TableState } from './table'

const toAct = (s: TableState) => (s.hand && s.hand.toAct >= 0 ? s.hand.seats[s.hand.toAct].id : null)

// Сценарий run-hand прототипа: полная раздача хедз-ап по улицам
describe.each(MODES)('полная раздача хедз-ап — %s', (_, roundtrip) => {
  it('улицы, очередь хода и итог 1030 / 970', () => {
    let s = play(newTable(['p0', 'p1']), [start('p0')], roundtrip)
    const hand = s.hand!
    // хедз-ап: кнопка ставит малый и ходит первой до флопа
    expect(hand.seats.map((x) => [x.id, x.bet])).toEqual([
      ['p0', 5],
      ['p1', 10],
    ])
    expect(toAct(s)).toBe('p0')

    s = play(s, [call('p0'), check('p1')], roundtrip)
    expect(s.hand?.stage).toBe('flop')
    expect(toAct(s)).toBe('p1') // после флопа первым — не кнопка

    s = play(s, [check('p1'), check('p0')], roundtrip)
    expect(s.hand?.stage).toBe('turn')

    s = play(s, [check('p1'), raise('p0', 20), call('p1')], roundtrip)
    expect(s.hand?.stage).toBe('river')
    expect(s.hand?.seats.map((x) => x.committed)).toEqual([30, 30])

    s = play(s, [check('p1'), check('p0')], roundtrip)
    expect(s.hand?.stage).toBe('showdown')
    expect(s.hand?.pots).toEqual([{ amount: 60, eligible: ['p0', 'p1'] }])

    s = play(s, [award('p0', [['p0']])], roundtrip)
    expect(s.players.map((p) => p.chips)).toEqual([1030, 970])
    expect(s.lastHand?.payouts).toEqual({ p0: 60 })
  })
})
