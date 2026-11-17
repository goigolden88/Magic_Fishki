import { describe, expect, it } from 'vitest'
import { CHANGES } from './changes'

// Проверки самого списка «Что нового» (#261) — как у ядра семьи: механика — в src/calc/changes.test.ts
describe('список «Что нового»', () => {
  it('id подряд с единицы', () => {
    expect(CHANGES.map((change) => change.id)).toEqual(CHANGES.map((_, i) => i + 1))
  })

  it('даты — день YYYY-MM-DD и не убывают', () => {
    for (const change of CHANGES) expect(change.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    for (let i = 1; i < CHANGES.length; i++) expect(CHANGES[i].date >= CHANGES[i - 1].date).toBe(true)
  })

  it('у записи есть строки, пустых нет', () => {
    for (const change of CHANGES) {
      expect(change.lines.length).toBeGreaterThan(0)
      for (const line of change.lines) expect(line.trim()).not.toBe('')
    }
  })
})
