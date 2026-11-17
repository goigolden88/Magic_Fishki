import { afterEach, describe, expect, it, vi } from 'vitest'
import { startBotTable } from '../calc/botTable'
import { startLocalTable, type LocalTable } from '../calc/localTable'
import type { OwnGame } from '../poker/ownGame'

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

  it('места в комнатах: старое — без сервера — читается как было, новое помнит сервер (#83)', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    storage.data.set(
      'fishki.poker.seats',
      JSON.stringify({ KQ7MZP: { playerId: 'id1', token: 'tok' }, AB12CD: { playerId: 'id2', token: 't2', server: 'не адрес' } }),
    )
    let s = await reload()
    expect(s.loadSeat('KQ7MZP')).toEqual({ playerId: 'id1', token: 'tok' })
    expect(s.loadSeat('AB12CD')).toEqual({ playerId: 'id2', token: 't2' }) // кривой сервер — как старое место

    s.saveSeat('ZZ99ZZ', { playerId: 'id3', token: 't3', server: 'https://poker.example.dev' })
    s = await reload()
    expect(s.loadSeats()).toEqual({
      KQ7MZP: { playerId: 'id1', token: 'tok' },
      AB12CD: { playerId: 'id2', token: 't2' },
      ZZ99ZZ: { playerId: 'id3', token: 't3', server: 'https://poker.example.dev' },
    })
  })

  it('«Продолжить» (#209): последняя открытая игра; стирается со своим столом, чужой стол её не трогает', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    let s = await reload()
    expect(s.loadLastGame()).toBeNull()

    s.saveLastGame('bots')
    s = await reload()
    expect(s.loadLastGame()?.kind).toBe('bots')
    s.clearLocalTable() // другой стол — запись про ботов остаётся
    expect(s.loadLastGame()?.kind).toBe('bots')
    s.clearBotTable()
    expect(s.loadLastGame()).toBeNull()

    s.saveLastGame('local')
    s.clearLocalTable()
    expect(s.loadLastGame()).toBeNull()

    s.saveSeat('KQ7MZP', { playerId: 'id1', token: 'tok' })
    s.saveLastGame('room', 'KQ7MZP', 'https://poker.example.dev')
    s = await reload()
    expect(s.loadLastGame()).toMatchObject({ kind: 'room', code: 'KQ7MZP', server: 'https://poker.example.dev' })
    s.saveSeat('AB12CD', null) // вышли из другой комнаты
    expect(s.loadLastGame()?.code).toBe('KQ7MZP')
    s.saveSeat('KQ7MZP', { playerId: 'id1', token: 'tok2' }) // пересадили — место есть, запись та же
    expect(s.loadLastGame()?.code).toBe('KQ7MZP')
    s.saveSeat('KQ7MZP', null)
    expect(s.loadLastGame()).toBeNull()
    expect(storage.data.has('fishki.poker.last')).toBe(false)
  })

  it('заметки об игроках (Р-56): помнятся после перезапуска, подписчик узнаёт о правке; пустые — следов нет', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    let s = await reload()
    expect(s.loadNotes()).toEqual({ notes: {}, labels: {} })
    let calls = 0
    const stop = s.subscribeNotes(() => calls++)
    const next = { notes: { Аня: { color: 'green' as const, text: 'фиш' } }, labels: { red: 'агро' } }
    s.saveNotes(next)
    expect(calls).toBe(1)
    expect(s.loadNotes()).toBe(next)
    stop()
    s.saveNotes(next)
    expect(calls).toBe(1)

    s = await reload()
    expect(s.loadNotes()).toEqual(next)
    s.saveNotes({ notes: {}, labels: {} })
    // Самих заметок нет; осталось время их правки (#264) — стирание тоже дойдёт до других устройств
    expect([...storage.data.keys()]).toEqual(['fishki.sync.stamps'])

    storage.data.set('fishki.poker.notes', 'не JSON')
    s = await reload()
    expect(s.loadNotes()).toEqual({ notes: {}, labels: {} })
  })

  it('суммы в ББ (Р-64): переключение за столом и галочка — одна настройка, подписчик узнаёт о смене', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    let s = await reload()
    expect(s.loadBigBlindsChoice()).toBe(null)
    let calls = 0
    const stop = s.subscribeBigBlinds(() => calls++)
    s.saveBigBlinds(!s.loadBigBlinds())
    expect(calls).toBe(1)
    expect(s.loadBigBlinds()).toBe(true)
    s.saveBigBlinds(!s.loadBigBlinds())
    expect(calls).toBe(2)
    expect(s.loadBigBlindsChoice()).toBe(false)
    stop()
    s.saveBigBlinds(true)
    expect(calls).toBe(2)

    s = await reload()
    expect(s.loadBigBlinds()).toBe(true)
    expect(storage.data.get('fishki.poker.bigBlinds')).toBe('on')
  })

  it('свои игры (#224): помнятся после перезапуска; битое значение — пустой список; пустой — следов нет', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    let s = await reload()
    expect(s.loadOwnGames()).toEqual([])
    const games: OwnGame[] = [
      { id: 'own-o6', name: 'Омаха-6', hole: 6, fromHand: 2, deck: 52, order: 'standard', board: [3, 1, 1], limit: 'pot' },
      { id: 'own-s', name: 'Шорт-3', hole: 3, fromHand: 'any', deck: 36, order: 'shortdeck', board: [3, 2], limit: 'nolimit' },
    ]
    s.saveOwnGames(games)
    s = await reload()
    expect(s.loadOwnGames()).toEqual(games)
    expect(JSON.parse(storage.data.get('fishki.poker.ownGames') ?? '')).toEqual(games)

    // Одна описана неверно — мимо, остальные на месте
    storage.data.set('fishki.poker.ownGames', JSON.stringify([games[0], { ...games[1], hole: 9 }]))
    s = await reload()
    expect(s.loadOwnGames()).toEqual([games[0]])
    for (const bad of ['не JSON', '{"a":1}', '"строка"', 'null']) {
      storage.data.set('fishki.poker.ownGames', bad)
      s = await reload()
      expect(s.loadOwnGames()).toEqual([])
    }
    s.saveOwnGames([])
    expect(storage.data.has('fishki.poker.ownGames')).toBe(false)
  })

  it('память работает — проверка говорит «да» и следов не оставляет', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const s = await reload()
    expect(s.storageWorks()).toBe(true)
    expect(storage.data.size).toBe(0)
  })
})
