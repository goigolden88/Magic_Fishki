import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SavedHand } from '../calc/evenings'
import type { OwnChart } from '../calc/ownCharts'
import type { Game } from '../model'
import { allHands, chartIds, deleteChart, getGame, getSettings, listCharts, listEvenings, listGames, saveChart } from './db'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const SETTINGS = { defaultRate: 0.25, players: [{ id: 'r1', name: 'Аня' }], quickAmounts: [500], defaultBuyin: 2000, compareWindow: 7 }
const GAME: Game = {
  id: '01A',
  name: 'Пятница',
  date: '2026-10-02',
  rate: 0.5,
  players: [{ id: 'p0', name: 'Аня', regularId: 'r1' }],
  entries: [{ id: 'e0', playerId: 'p0', kind: 'buyin', chips: 1000, at: '2026-10-02T19:00:00.000Z' }],
  closed: true,
  updatedAt: '2026-10-02T23:30:00.000Z',
}
const HAND: SavedHand = {
  evening: 'KQ7MZP-1000',
  code: 'KQ7MZP',
  startedAt: 1000,
  number: 1,
  hand: { number: 1, pots: [{ amount: 100, winners: ['Аня'] }], payouts: { Аня: 100 } },
  mine: ['As', 'Kd'],
}

const chart = (id: string, name: string): OwnChart => ({
  id,
  name,
  base: 'UTG|',
  actions: ['fold', 'raise 2bb'],
  cells: { AA: [0, 1], KK: [0.25, 0.75] },
  updatedAt: '2026-11-14T10:00:00.000Z',
})

beforeEach(async () => {
  await request(indexedDB.deleteDatabase('magic_fishki'))
})

describe('миграция базы 3 → 4: хранилище своих чартов (Р-77)', () => {
  it('игры, настройки и раздачи прошлых вечеров на месте, чартов нет', async () => {
    const req = indexedDB.open('magic_fishki', 3)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('games', { keyPath: 'id' })
      req.result.createObjectStore('settings')
      req.result.createObjectStore('hands', { keyPath: ['evening', 'number'] }).createIndex('evening', 'evening')
    }
    const db = await request(req)
    const tx = db.transaction(['games', 'settings', 'hands'], 'readwrite')
    tx.objectStore('settings').put(SETTINGS, 'settings')
    tx.objectStore('games').put(GAME)
    tx.objectStore('hands').put(HAND)
    await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()))
    db.close()

    expect(await getGame('01A')).toEqual(GAME)
    expect(await listGames()).toEqual([GAME])
    expect(await getSettings()).toEqual(SETTINGS)
    // Версия 5 (#264) ставит раздаче время правки — начало её вечера
    expect(await allHands()).toEqual([{ ...HAND, updatedAt: '1970-01-01T00:00:01.000Z' }])
    expect(await listEvenings()).toEqual([{ id: HAND.evening, code: HAND.code, startedAt: HAND.startedAt, hands: 1 }])
    expect(await listCharts()).toEqual([])
  })
})

describe('свои чарты на телефоне', () => {
  it('записаны — на месте по имени; тот же id — замена с новым временем; удалён — нет', async () => {
    await saveChart(chart('c1', 'Я — UTG'))
    const second = await saveChart(chart('c2', 'Блайнды'))
    expect(second.updatedAt > '2026-11-14T10:00:00.000Z').toBe(true)
    expect((await listCharts()).map((c) => c.name)).toEqual(['Блайнды', 'Я — UTG'])

    await saveChart({ ...chart('c1', 'Атака'), cells: { AA: [0, 1] } })
    const list = await listCharts()
    expect(list.map((c) => [c.id, c.name])).toEqual([
      ['c1', 'Атака'],
      ['c2', 'Блайнды'],
    ])
    expect(list[0].cells).toEqual({ AA: [0, 1] })
    expect((await chartIds()).sort()).toEqual(['c1', 'c2'])

    await deleteChart('c1')
    expect((await listCharts()).map((c) => c.id)).toEqual(['c2'])
  })
})
