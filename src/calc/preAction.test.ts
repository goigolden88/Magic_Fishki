import { describe, expect, it } from 'vitest'
import { bet, call, fold, newTable, play, raise, start } from '../poker/testing'
import { activePreAction, preActionMove, showPreActions, streetKey, togglePreAction } from './preAction'
import { actionsView } from './pokerView'

// Три игрока, блайнды 5/10: префлоп первым ходит p0 (кнопка), затем p1 (SB), p2 (BB)
const three = (stacks: Record<string, number> = {}) => newTable(['p0', 'p1', 'p2'], {}, stacks)

describe('ход заранее', () => {
  it('чек можно — оба флажка дают чек', () => {
    // Префлоп: все уравняли, большой блайнд может чекнуть
    const s = play(three(), [start('p0'), call('p0'), call('p1')], false)
    const a = actionsView(s, 'p2')
    expect(a).toMatchObject({ myTurn: true, check: true })
    expect(preActionMove('checkFold', a)).toEqual({ type: 'check' })
    expect(preActionMove('callAny', a)).toEqual({ type: 'check' })
  })

  it('только колл: «Чек/пас» — пас, «Колл любой» — колл', () => {
    const s = play(three(), [start('p0'), raise('p0', 40)], false)
    const a = actionsView(s, 'p1')
    expect(a).toMatchObject({ myTurn: true, check: false, call: 35 })
    expect(preActionMove('checkFold', a)).toEqual({ type: 'fold' })
    expect(preActionMove('callAny', a)).toEqual({ type: 'call' })
  })

  it('колл больше стека — «Колл любой» шлёт колл, сервер ставит остаток: олл-ин', () => {
    const s = play(three({ p1: 100 }), [start('p0'), raise('p0', 300)], false)
    const a = actionsView(s, 'p1')
    expect(a).toMatchObject({ myTurn: true, check: false, call: 95 })
    const move = preActionMove('callAny', a)
    expect(move).toEqual({ type: 'call' })
    const after = play(s, [bet('p1', move!)], false)
    expect(after.hand?.seats.find((x) => x.id === 'p1')).toMatchObject({ chips: 0, allIn: true, bet: 100 })
  })

  it('не мой ход — ничего не шлёт, флажки видны', () => {
    const s = play(three(), [start('p0')], false)
    const a = actionsView(s, 'p1')
    expect(a?.myTurn).toBe(false)
    expect(showPreActions(a)).toBe(true)
    expect(preActionMove('checkFold', a)).toBeNull()
    expect(preActionMove('callAny', a)).toBeNull()
    expect(showPreActions(actionsView(s, 'p0'))).toBe(false) // мой ход — обычные кнопки
  })

  it('сбросил — флажков нет и ход не шлётся', () => {
    const s = play(three(), [start('p0'), fold('p0')], false)
    const a = actionsView(s, 'p0')
    expect(a).toBeNull()
    expect(showPreActions(a)).toBe(false)
    expect(preActionMove('callAny', a)).toBeNull()
  })

  it('олл-ин и между раздачами — флажков нет', () => {
    const allIn = play(three(), [start('p0'), bet('p0', { type: 'allin' })], false)
    expect(showPreActions(actionsView(allIn, 'p0'))).toBe(false)
    expect(showPreActions(actionsView(three(), 'p0'))).toBe(false)
  })

  it('без флажка — ничего не шлёт', () => {
    const s = play(three(), [start('p0')], false)
    expect(preActionMove(null, actionsView(s, 'p0'))).toBeNull()
  })

  it('флажок снимается тапом, отмечен только один', () => {
    expect(togglePreAction(null, 'checkFold')).toBe('checkFold')
    expect(togglePreAction('checkFold', 'checkFold')).toBeNull()
    expect(togglePreAction('checkFold', 'callAny')).toBe('callAny')
  })

  it('на новой улице и между раздачами флажок снят', () => {
    const mark = { kind: 'callAny' as const, street: streetKey(3, 'flop') ?? '' }
    expect(activePreAction(mark, streetKey(3, 'flop'))).toBe('callAny')
    expect(activePreAction(mark, streetKey(3, 'turn'))).toBeNull()
    expect(activePreAction(mark, streetKey(4, 'flop'))).toBeNull()
    expect(activePreAction(mark, streetKey(3, null))).toBeNull()
    expect(activePreAction(null, streetKey(3, 'flop'))).toBeNull()
  })
})
