import { describe, expect, it } from 'vitest'
import { allPicked, toggleAll } from './pick'

const ids = ['a', 'b', 'c']

describe('allPicked', () => {
  it('все отмечены', () => {
    expect(allPicked(ids, new Set(ids))).toBe(true)
  })

  it('отмечена часть или никто', () => {
    expect(allPicked(ids, new Set(['a']))).toBe(false)
    expect(allPicked(ids, new Set())).toBe(false)
  })

  it('пустой список — не «все»', () => {
    expect(allPicked([], new Set())).toBe(false)
  })
})

describe('toggleAll', () => {
  it('никто не отмечен — отмечены все', () => {
    expect(toggleAll(ids, new Set())).toEqual(new Set(ids))
  })

  it('отмечена часть — отмечены все, отмеченные остаются', () => {
    expect(toggleAll(ids, new Set(['b']))).toEqual(new Set(ids))
  })

  it('отмечены все — ни одной галочки', () => {
    expect(toggleAll(ids, new Set(ids)).size).toBe(0)
  })

  it('не меняет переданный набор', () => {
    const picked = new Set(['a'])
    toggleAll(ids, picked)
    expect(picked).toEqual(new Set(['a']))
  })
})
