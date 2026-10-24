import { describe, expect, it } from 'vitest'
import { allin, award, call, check, fold, MODES, newTable, play, raise, start } from './testing'
import type { TableState } from './table'

const chips = (s: TableState, id: string) => s.players.find((p) => p.id === id)?.chips

// Сценарий edge прототипа: олл-ин на троих, ничья, сброс без вскрытия
describe.each(MODES)('крайние раздачи — %s', (_, roundtrip) => {
  it('олл-ин префлоп, один сбросил — торги закрыты, банк 610 у p0', () => {
    let s = newTable(['p0', 'p1', 'p2'], {}, { p0: 300 })
    s = play(s, [start('p0')], roundtrip)
    expect(s.hand?.seats[s.hand.toAct].id).toBe('p0') // на троих первым ходит кнопка
    s = play(s, [allin('p0'), call('p1'), fold('p2')], roundtrip)
    // ставить больше некому — карты досдаёт дилер вживую, движок ждёт ведущего
    expect(s.hand?.stage).toBe('showdown')
    expect(s.hand?.pots).toEqual([{ amount: 610, eligible: ['p0', 'p1'] }])
    s = play(s, [award('p0', [['p0']])], roundtrip)
    expect([chips(s, 'p0'), chips(s, 'p1'), chips(s, 'p2')]).toEqual([610, 700, 990])
    expect(s.players.reduce((sum, p) => sum + p.chips, 0)).toBe(2300)
  })

  it('ничья — ведущий отметил двоих, банк пополам', () => {
    const s = play(
      newTable(['p0', 'p1']),
      [
        start('p0'),
        call('p0'), // хедз-ап: кнопка уравнивает
        check('p1'), // флоп
        check('p1'),
        check('p0'), // тёрн
        check('p1'),
        check('p0'), // ривер
        check('p1'),
        check('p0'),
        award('p0', [['p0', 'p1']]),
      ],
      roundtrip,
    )
    expect([chips(s, 'p0'), chips(s, 'p1')]).toEqual([1000, 1000])
  })

  it('сброс — банк без вскрытия, непокрытая часть ставки вернулась', () => {
    let s = play(newTable(['p0', 'p1']), [start('p0'), raise('p0', 30), fold('p1')], roundtrip)
    // остался один — раздача тоже ждёт ведущего
    expect(s.hand?.stage).toBe('showdown')
    expect(s.hand?.returned).toEqual({ playerId: 'p0', amount: 20 })
    expect(s.hand?.pots).toEqual([{ amount: 20, eligible: ['p0'] }])
    s = play(s, [award('p0', [['p0']])], roundtrip)
    expect([chips(s, 'p0'), chips(s, 'p1')]).toEqual([1010, 990])
  })
})
