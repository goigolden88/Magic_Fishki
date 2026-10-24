import { describe, expect, it } from 'vitest'
import { allin, award, call, check, MODES, newTable, play, raise, start } from './testing'
import type { TableState } from './table'

const chips = (s: TableState, id: string) => s.players.find((p) => p.id === id)?.chips

// Сценарий sidepots прототипа, часть B: короткий олл-ин — основной и побочный банк разным игрокам.
// Силу руки движок не знает: победителей отмечает ведущий (p0)
describe.each(MODES)('побочный банк — %s', (_, roundtrip) => {
  const table = () => newTable(['p0', 'p1', 'p2'], {}, { p0: 300 })
  const betting = [
    start('p0'), // кнопка p0, малый p1, большой p2, первым ходит p0
    allin('p0'), // 300
    raise('p1', 600),
    call('p2'), // флоп: p1 и p2 с фишками
    check('p1'),
    check('p2'),
    check('p1'),
    check('p2'),
    check('p1'),
    check('p2'), // ривер закрыт
  ]

  it('торги закрыты — основной банк на троих, побочный на двоих, раздача ждёт ведущего', () => {
    const s = play(table(), betting, roundtrip)
    expect(s.hand?.stage).toBe('showdown')
    expect(s.hand?.pots).toEqual([
      { amount: 900, eligible: ['p0', 'p1', 'p2'] },
      { amount: 600, eligible: ['p1', 'p2'] },
    ])
    expect(chips(s, 'p0')).toBe(300) // стеки не тронуты, пока ведущий не отметит
  })

  it('ведущий отдал основной p0, побочный p1 — стеки 900 / 1000 / 400', () => {
    const s = play(table(), [...betting, award('p0', [['p0'], ['p1']])], roundtrip)
    expect(s.hand).toBeNull()
    expect([chips(s, 'p0'), chips(s, 'p1'), chips(s, 'p2')]).toEqual([900, 1000, 400])
    expect(s.lastHand?.pots).toEqual([
      { amount: 900, winners: ['p0'] },
      { amount: 600, winners: ['p1'] },
    ])
    expect(s.players.reduce((sum, p) => sum + p.chips, 0)).toBe(2300)
  })
})
