import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadOpenGroups, OPEN_GROUPS_DEFAULT, parseOpenGroups, saveOpenGroups } from './settingsGroups'

// Память браузера: обычная или та, что не принимает записей (приватный режим)
function fakeStorage(broken = false) {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (broken) throw new DOMException('нет места', 'QuotaExceededError')
      data.set(k, v)
    },
    removeItem: (k: string) => void data.delete(k),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('развёрнутые разделы «Настроек» (#234)', () => {
  it('в первый раз развёрнуто только «Оформление»', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    const open = loadOpenGroups()
    expect(open).toEqual(OPEN_GROUPS_DEFAULT)
    expect(Object.entries(open).filter(([, v]) => v)).toEqual([['look', true]])
  })

  it('выбор сохраняется и читается после перезапуска', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    saveOpenGroups({ ...OPEN_GROUPS_DEFAULT, look: false, poker: true })
    expect(storage.data.size).toBe(1)
    expect(loadOpenGroups()).toEqual({ ...OPEN_GROUPS_DEFAULT, look: false, poker: true })
  })

  it('мусор в хранилище — значения по умолчанию', () => {
    for (const raw of ['не json', '[]', 'null', '42', '"look"', '{"look": "да", "poker": 1}']) {
      expect(parseOpenGroups(raw)).toEqual(OPEN_GROUPS_DEFAULT)
    }
  })

  it('годное из записи берётся, неизвестное и негодное — по умолчанию', () => {
    expect(parseOpenGroups('{"demo": true, "look": false, "lishnee": true, "poker": "да"}')).toEqual({
      ...OPEN_GROUPS_DEFAULT,
      demo: true,
      look: false,
    })
  })

  it('память браузера недоступна — по умолчанию, запись не роняет экран', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(() => saveOpenGroups({ ...OPEN_GROUPS_DEFAULT, demo: true })).not.toThrow()
    expect(loadOpenGroups()).toEqual(OPEN_GROUPS_DEFAULT)
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('запрещено', 'SecurityError')
      },
    })
    expect(loadOpenGroups()).toEqual(OPEN_GROUPS_DEFAULT)
  })
})
