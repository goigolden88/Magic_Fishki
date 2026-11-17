// Копия из FamilyCore@d9e5ec6 (Я-06), правится здесь
import { describe, expect, it } from 'vitest'
import { latestChange, unseenChanges, type Change } from './changes'

// Из `src/changes.test.ts` «Делу Время» с d86f0aa — часть про механику.
// Проверки самого списка (id подряд, даты, пустые строки) остаются
// у приложения: список его (`src/changes.test.ts`).

describe('что показать после обновления', () => {
  const list: Change[] = [
    { id: 1, date: '2026-09-11', lines: ['первое'] },
    { id: 2, date: '2026-09-20', lines: ['второе'] },
    { id: 3, date: '2026-10-01', lines: ['третье'] },
  ]

  it('свежая установка: ничего не показывать, всё отметить прочитанным', () => {
    expect(unseenChanges(list, null, true)).toEqual({ show: [], markSeen: 3 })
  })

  it('обновилась копия без ключа, данные есть: только последняя запись', () => {
    expect(unseenChanges(list, null, false)).toEqual({ show: [list[2]], markSeen: null })
  })

  it('ключ есть: всё новее прочитанного', () => {
    expect(unseenChanges(list, 1, false).show.map((change) => change.id)).toEqual([2, 3])
    expect(unseenChanges(list, 1, true).show.map((change) => change.id)).toEqual([2, 3])
  })

  it('всё прочитано — ничего', () => {
    expect(unseenChanges(list, 3, false)).toEqual({ show: [], markSeen: null })
  })

  it('«Понятно» пишет последний id; пустой список — ноль', () => {
    expect(latestChange(list)).toBe(3)
    expect(latestChange([])).toBe(0)
  })
})
