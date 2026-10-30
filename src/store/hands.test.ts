import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { savedHands, type Evening } from '../calc/evenings'
import type { Game } from '../model'
import type { HistoryHand } from '../poker/history'
import { deleteEvening, eveningHands, getGame, getSettings, listEvenings, listGames, saveHands } from './db'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Раздача: кто сколько взял; record — карты на телефонах, hidden — карты взявшего без вскрытия
function hand(number: number, winner = 'Аня', shown = false): HistoryHand {
  return {
    number,
    pots: [{ amount: 100 * number, winners: [winner] }],
    payouts: { [winner]: 100 * number },
    ...(shown ? { record: { ...RECORD, shown: { a: ['As', null] } } } : {}),
  }
}

const RECORD = {
  game: { id: 'holdem', holeCards: 2, deck: 'full', handRule: 'any' },
  sb: 5,
  bb: 10,
  seats: [],
  button: 0,
  board: [],
  log: [],
  shown: {},
  hands: {},
  hidden: null,
} as unknown as NonNullable<HistoryHand['record']>

const FRIDAY: Evening = { id: 'KQ7MZP-1000', code: 'KQ7MZP', startedAt: Date.UTC(2026, 9, 23, 19) }
const SATURDAY: Evening = { id: 'local-01X', code: null, startedAt: Date.UTC(2026, 9, 24, 19) }

beforeEach(async () => {
  await request(indexedDB.deleteDatabase('magic_fishki'))
})

describe('миграция базы 2 → 3: хранилище раздач (#114)', () => {
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

  it('игры и настройки на месте, новое хранилище пустое', async () => {
    const req = indexedDB.open('magic_fishki', 2)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('games', { keyPath: 'id' })
      req.result.createObjectStore('settings')
    }
    const db = await request(req)
    const tx = db.transaction(['games', 'settings'], 'readwrite')
    tx.objectStore('settings').put(SETTINGS, 'settings')
    tx.objectStore('games').put(GAME)
    await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()))
    db.close()

    expect(await getGame('01A')).toEqual(GAME)
    expect(await listGames()).toEqual([GAME])
    expect(await getSettings()).toEqual(SETTINGS)
    expect(await listEvenings()).toEqual([])
  })
})

describe('раздачи прошлых вечеров', () => {
  it('та же раздача второй раз — одна запись; после «Показать» — новая запись вместо старой', async () => {
    await saveHands(savedHands(FRIDAY, [hand(1), hand(2)]))
    await saveHands(savedHands(FRIDAY, [hand(1), hand(2), hand(3)]))
    await saveHands(savedHands(FRIDAY, [hand(2, 'Аня', true)]))

    expect(await eveningHands(FRIDAY.id)).toEqual([hand(1), hand(2, 'Аня', true), hand(3)])
    expect(await listEvenings()).toEqual([{ ...FRIDAY, hands: 3 }])
  })

  it('вечера — новые сверху, у каждого своё число раздач; номера раздач у разных вечеров не мешают', async () => {
    await saveHands(savedHands(FRIDAY, [hand(1), hand(2)]))
    await saveHands(savedHands(SATURDAY, [hand(1, 'Боря')]))

    expect(await listEvenings()).toEqual([
      { ...SATURDAY, hands: 1 },
      { ...FRIDAY, hands: 2 },
    ])
    expect(await eveningHands(SATURDAY.id)).toEqual([hand(1, 'Боря')])
  })

  it('«Удалить» вечер — стираются его раздачи, и только они; игры не трогаются', async () => {
    await saveHands(savedHands(FRIDAY, [hand(1), hand(2)]))
    await saveHands(savedHands(SATURDAY, [hand(1)]))

    await deleteEvening(FRIDAY.id)

    expect(await eveningHands(FRIDAY.id)).toEqual([])
    expect(await listEvenings()).toEqual([{ ...SATURDAY, hands: 1 }])
    expect(await listGames()).toEqual([])
  })

  it('пусто — вечеров нет', async () => {
    await saveHands([])
    expect(await listEvenings()).toEqual([])
  })
})
