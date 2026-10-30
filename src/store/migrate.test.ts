import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { playerTotals } from '../calc/totals'
import { transfers } from '../calc/transfers'
import type { Game } from '../model'
import { getGame, getSettings, listGames, saveSettings } from './db'

// База версии 1 — как её оставило приложение до Р-12: игроки в настройках — строки
const V1_SETTINGS = { defaultRate: 0.25, players: ['Аня', 'Боря', 'Вера'], quickAmounts: [500], defaultBuyin: 2000 }

function game(id: string, date: string, names: string[], rows: [number, number][], over: Partial<Game> = {}): Game {
  const players = names.map((name, i) => ({ id: `${id}-p${i}`, name }))
  const entries = rows.flatMap(([buyin, cashout], i) => [
    { id: `${id}-in${i}`, playerId: `${id}-p${i}`, kind: 'buyin' as const, chips: buyin, at: `${date}T19:00:00.000Z` },
    ...(cashout > 0
      ? [{ id: `${id}-out${i}`, playerId: `${id}-p${i}`, kind: 'cashout' as const, chips: cashout, at: `${date}T23:00:00.000Z` }]
      : []),
  ])
  return { id, name: 'Пятница', date, rate: 0.5, players, entries, closed: true, updatedAt: `${date}T23:30:00.000Z`, ...over }
}

const G1 = game('01A', '2026-10-02', ['Аня', 'Боря', 'Ира'], [[1000, 2500], [1000, 0], [1000, 500]])
const G2 = game('01B', '2026-10-09', ['Вера', 'аня', 'Аня '], [[2000, 1000], [2000, 3000], [500, 500]], { closed: undefined })
const G3 = game('01C', '2026-10-10', ['Гоша'], [[500, 500]], { demo: true })

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Открыть базу версии 1 тем же шагом, что был до Р-12, и записать в неё данные
async function openV1(settings: unknown, games: Game[]): Promise<IDBDatabase> {
  const req = indexedDB.open('magic_fishki', 1)
  req.onupgradeneeded = () => {
    req.result.createObjectStore('games', { keyPath: 'id' })
    req.result.createObjectStore('settings')
  }
  const db = await request(req)
  const tx = db.transaction(['games', 'settings'], 'readwrite')
  if (settings !== undefined) tx.objectStore('settings').put(settings, 'settings')
  for (const g of games) tx.objectStore('games').put(g)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return db
}

// Своё соединение приложение закрывает само (onversionchange в db.ts)
beforeEach(async () => {
  await request(indexedDB.deleteDatabase('magic_fishki'))
})

describe('миграция базы 1 → 2: постоянный игрок — один id во всех играх (Р-12)', () => {
  it('игры с теми же участниками, записями, итогами и переводами; постоянные — те же и в том же порядке', async () => {
    ;(await openV1(V1_SETTINGS, [G1, G2, G3])).close()

    const settings = await getSettings()
    expect(settings).toMatchObject({ defaultRate: 0.25, quickAmounts: [500], defaultBuyin: 2000 })
    expect(settings.players.map((r) => r.name)).toEqual(['Аня', 'Боря', 'Вера'])
    const [anya, borya, vera] = settings.players.map((r) => r.id)
    expect(new Set([anya, borya, vera, '']).size).toBe(4)

    const g1 = await getGame('01A')
    expect(g1).toEqual({
      ...G1,
      players: [
        { id: '01A-p0', name: 'Аня', regularId: anya },
        { id: '01A-p1', name: 'Боря', regularId: borya },
        { id: '01A-p2', name: 'Ира' }, // гость: имени нет среди постоянных
      ],
    })
    // Совпадение — точное: «аня» и «Аня » — гости
    expect((await getGame('01B'))?.players).toEqual([
      { id: '01B-p0', name: 'Вера', regularId: vera },
      { id: '01B-p1', name: 'аня' },
      { id: '01B-p2', name: 'Аня ' },
    ])
    expect(await getGame('01C')).toEqual(G3)

    for (const before of [G1, G2, G3]) {
      const stored = (await getGame(before.id))!
      expect(stored.entries).toEqual(before.entries)
      expect(stored.updatedAt).toBe(before.updatedAt)
      const t = playerTotals(stored.players, stored.entries, stored.rate)
      expect(t).toEqual(playerTotals(before.players, before.entries, before.rate))
      expect(transfers(t, stored.rate)).toEqual(transfers(playerTotals(before.players, before.entries, before.rate), before.rate))
    }
    expect((await listGames()).map((g) => g.id)).toEqual(['01C', '01B', '01A'])
  })

  it('переименование после миграции: id тот же, связь с прошлой игрой остаётся, имя в игре — прежнее', async () => {
    ;(await openV1(V1_SETTINGS, [G1])).close()
    const settings = await getSettings()
    const anya = settings.players[0]
    await saveSettings({ ...settings, players: settings.players.map((r) => (r.id === anya.id ? { ...r, name: 'Анна' } : r)) })

    expect((await getSettings()).players[0]).toEqual({ id: anya.id, name: 'Анна' })
    expect((await getGame('01A'))?.players[0]).toEqual({ id: '01A-p0', name: 'Аня', regularId: anya.id })
  })

  it('пустая база версии 1 — миграция без ошибок', async () => {
    ;(await openV1(undefined, [])).close()
    expect(await getSettings()).toEqual({
      defaultRate: 0.5,
      players: [],
      quickAmounts: [500, 1000, 2000],
      defaultBuyin: 1000,
      compareWindow: 5,
    })
    expect(await listGames()).toEqual([])
  })

  it('настройки самой первой версии без игроков — игры без связей, остальное как было', async () => {
    ;(await openV1({ defaultRate: 0.2 }, [G1])).close()
    expect(await getSettings()).toMatchObject({ defaultRate: 0.2, players: [] })
    expect(await getGame('01A')).toEqual(G1)
  })

  it('базы ещё нет — создаётся сразу последней версии', async () => {
    expect(await listGames()).toEqual([])
    expect((await getSettings()).players).toEqual([])
  })

  it('приложение открыто в другой вкладке на версии 1 — та уступает базу, новая версия открывается', async () => {
    const other = await openV1(V1_SETTINGS, [G1])
    let asked = false
    other.onversionchange = () => {
      asked = true
      other.close()
    }

    const settings = await getSettings()
    expect(asked).toBe(true)
    expect(settings.players.map((r) => r.name)).toEqual(['Аня', 'Боря', 'Вера'])
    expect((await getGame('01A'))?.players[0].regularId).toBe(settings.players[0].id)
  })
})
