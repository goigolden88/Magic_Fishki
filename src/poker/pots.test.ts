import { describe, expect, it } from 'vitest'
import { buildPots, splitPot } from './pots'

// Сценарий sidepots прототипа, часть A: построение банков
describe('buildPots', () => {
  it('без олл-инов — один банк на троих', () => {
    const pots = buildPots([
      { id: 'a', committed: 100, folded: false },
      { id: 'b', committed: 100, folded: false },
      { id: 'c', committed: 100, folded: false },
    ])
    expect(pots).toEqual([{ amount: 300, eligible: ['a', 'b', 'c'] }])
  })

  it('короткий олл-ин — основной на троих и побочный на двоих', () => {
    const pots = buildPots([
      { id: 'a', committed: 100, folded: false },
      { id: 'b', committed: 200, folded: false },
      { id: 'c', committed: 200, folded: false },
    ])
    expect(pots).toEqual([
      { amount: 300, eligible: ['a', 'b', 'c'] },
      { amount: 200, eligible: ['b', 'c'] },
    ])
  })

  it('непокрытая часть ставки — отдельным слоем с одним претендентом', () => {
    const pots = buildPots([
      { id: 'a', committed: 500, folded: false },
      { id: 'b', committed: 200, folded: false },
    ])
    expect(pots).toEqual([
      { amount: 400, eligible: ['a', 'b'] },
      { amount: 300, eligible: ['a'] },
    ])
  })

  it('фишки сбросившего остаются в банке, но он не претендует', () => {
    const pots = buildPots([
      { id: 'a', committed: 50, folded: true },
      { id: 'b', committed: 200, folded: false },
      { id: 'c', committed: 200, folded: false },
    ])
    expect(pots).toEqual([{ amount: 450, eligible: ['b', 'c'] }])
  })

  it('слой, где все сбросили, — к соседнему банку', () => {
    const pots = buildPots([
      { id: 'a', committed: 300, folded: true },
      { id: 'b', committed: 100, folded: false },
      { id: 'c', committed: 100, folded: false },
    ])
    expect(pots).toEqual([{ amount: 500, eligible: ['b', 'c'] }])
  })
})

describe('splitPot', () => {
  it('поровну', () => {
    expect(splitPot(300, ['a', 'b'])).toEqual({ a: 150, b: 150 })
  })

  it('нечётная фишка — первому в списке', () => {
    expect(splitPot(301, ['b', 'a'])).toEqual({ b: 151, a: 150 })
    expect(splitPot(302, ['c', 'a', 'b'])).toEqual({ c: 101, a: 101, b: 100 })
  })
})
