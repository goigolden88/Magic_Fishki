import { afterEach, describe, expect, it, vi } from 'vitest'
import { startBotTable } from '../calc/botTable'
import { startLocalTable, type LocalTable } from '../calc/localTable'

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

// Новая загрузка страницы: модуль читает память заново
async function reload() {
  vi.resetModules()
  return import('./pokerStorage')
}

function table(): LocalTable {
  let n = 0
  const r = startLocalTable(
    [
      { name: 'Аня', regularId: null },
      { name: 'Боря', regularId: null },
    ],
    { sb: 5, bb: 10, startingStack: 1000 },
    0,
    () => `id${++n}`,
  )
  if (!r.ok) throw new Error(r.error)
  return r.local
}

afterEach(() => vi.unstubAllGlobals())

describe('стол на этом телефоне в памяти устройства', () => {
  it('сохранён — после перезапуска на месте; стёрт — нет', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    let s = await reload()
    expect(s.loadLocalTable()).toBeNull()
    const local = table()
    expect(s.saveLocalTable(local)).toBe(true)

    s = await reload()
    expect(s.loadLocalTable()).toEqual(local)
    s.saveLocalTable({ ...local, gameId: 'g1' })
    s = await reload()
    expect(s.loadLocalTable()?.gameId).toBe('g1')

    s.clearLocalTable()
    expect(s.loadLocalTable()).toBeNull()
    s = await reload()
    expect(s.loadLocalTable()).toBeNull()
    expect(storage.data.size).toBe(0)
  })

  it('память браузера недоступна — стол живёт в странице, проверка говорит «нет»', async () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    const s = await reload()
    expect(s.storageWorks()).toBe(false)
    const local = table()
    expect(s.saveLocalTable(local)).toBe(false)
    expect(s.loadLocalTable()).toEqual(local)
    s.clearLocalTable()
    expect(s.loadLocalTable()).toBeNull()
  })

  it('стол против ботов — свой ключ: со столом на этом телефоне не мешают друг другу; без памяти — живёт в странице', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    let s = await reload()
    expect(s.loadBotTable()).toBeNull()
    const local = table()
    const r = startBotTable({ bots: 2, level: 'strong', open: true, sb: 5, bb: 10, startingStack: 1000 }, 0, (() => {
      let n = 0
      return () => `b${++n}`
    })())
    if (!r.ok) throw new Error(r.error)
    expect(s.saveLocalTable(local)).toBe(true)
    expect(s.saveBotTable(r.bots)).toBe(true)
    expect([...storage.data.keys()].sort()).toEqual(['fishki.poker.bots', 'fishki.poker.local'])

    s = await reload()
    expect(s.loadBotTable()).toEqual(r.bots)
    expect(s.loadLocalTable()).toEqual(local)
    s.clearBotTable()
    s = await reload()
    expect(s.loadBotTable()).toBeNull()
    expect(s.loadLocalTable()).toEqual(local)

    vi.stubGlobal('localStorage', fakeStorage(true))
    s = await reload()
    expect(s.saveBotTable(r.bots)).toBe(false)
    expect(s.loadBotTable()).toEqual(r.bots)
  })

  it('«Карты всегда открыты»: сначала выключено, включённое помнится, выключенное следов не оставляет', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    let s = await reload()
    expect(s.loadOpenCards()).toBe(false)
    s.saveOpenCards(true)
    s = await reload()
    expect(s.loadOpenCards()).toBe(true)
    s.saveOpenCards(false)
    s = await reload()
    expect(s.loadOpenCards()).toBe(false)
    expect(storage.data.size).toBe(0)
  })

  it('«Карты всегда открыты»: память браузера недоступна — выключено', async () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    let s = await reload()
    s.saveOpenCards(true)
    s = await reload()
    expect(s.loadOpenCards()).toBe(false)
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('запрещено', 'SecurityError')
      },
    })
    s = await reload()
    expect(s.loadOpenCards()).toBe(false)
  })

  it('память работает — проверка говорит «да» и следов не оставляет', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const s = await reload()
    expect(s.storageWorks()).toBe(true)
    expect(storage.data.size).toBe(0)
  })
})
