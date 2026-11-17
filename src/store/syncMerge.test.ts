import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Game } from '../model'
import {
  deleteGame,
  eveningRecords,
  forgetRecords,
  getGame,
  getSettings,
  listDirty,
  listGames,
  mergeRemote,
  onChange,
  saveGame,
  saveHands,
  saveSettings,
  syncSnapshot,
  type ChangeOrigin,
} from './db'

// Синхронизация, шаг 2 (#265): слияние пришедшего с другого устройства, «нет в репо — значит удалено», событие изменения

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const DAY = 24 * 60 * 60 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

function game(id: string, over: Partial<Game> = {}): Game {
  return { id, name: 'Пятница', date: '2026-10-02', rate: 0.5, players: [], entries: [], updatedAt: '2026-10-02T23:30:00.000Z', ...over }
}

beforeEach(async () => {
  await request(indexedDB.deleteDatabase('magic_fishki'))
})

describe('mergeRemote', () => {
  it('поздний updatedAt побеждает; ранний — мимо; отметок «не отправлено» слияние не ставит', async () => {
    const saved = await saveGame(game('g1', { name: 'Здесь' }))
    const later = iso(Date.parse(saved.updatedAt) + 1000)
    const earlier = iso(Date.parse(saved.updatedAt) - 1000)
    expect(await mergeRemote('games', [{ ...game('g1', { name: 'Раньше' }), updatedAt: earlier }])).toBe(0)
    expect((await getGame('g1'))?.name).toBe('Здесь')
    expect(await mergeRemote('games', [{ ...game('g1', { name: 'Там' }), updatedAt: later }, game('g2')])).toBe(2)
    expect((await getGame('g1'))?.name).toBe('Там')
    expect((await listGames()).map((g) => g.id).sort()).toEqual(['g1', 'g2'])
    expect((await listDirty()).map((m) => m.key)).toEqual(['g1'])
  })

  it('пришедшая метка удаления — вместо записи, только ключ, deleted и время', async () => {
    await saveGame(game('g1'))
    const at = new Date(Date.now() + 1000).toISOString()
    await mergeRemote('games', [{ id: 'g1', deleted: true, updatedAt: at, name: 'лишнее' }])
    expect(await getGame('g1')).toBeUndefined()
    expect((await syncSnapshot()).games).toEqual([{ id: 'g1', deleted: true, updatedAt: at }])
  })

  it('метка старше 30 дней не пишется, но позже здешней записи — стирает её совсем', async () => {
    const now = Date.now()
    const old = iso(now - 31 * DAY)
    await mergeRemote('games', [{ id: 'gone', deleted: true, updatedAt: old }], now)
    expect((await syncSnapshot()).games).toEqual([])

    await mergeRemote('games', [game('g1', { updatedAt: iso(now - 40 * DAY) })], now)
    await mergeRemote('games', [{ id: 'g1', deleted: true, updatedAt: old }], now)
    expect((await syncSnapshot()).games).toEqual([])
  })

  it('раздачи — по [evening, number]; настройки без времени правки уступают пришедшим', async () => {
    await mergeRemote('hands', [
      { evening: 'local-1', number: 2, code: null, startedAt: 1, hand: { number: 2 }, updatedAt: iso(1000) },
      { evening: 'local-1', number: 1, code: null, startedAt: 1, hand: { number: 1 }, updatedAt: iso(1000) },
    ])
    expect((await eveningRecords('local-1')).map((h) => h.number)).toEqual([1, 2])

    await mergeRemote('settings', [{ defaultRate: 2, players: [], quickAmounts: [100], defaultBuyin: 500, compareWindow: 5, updatedAt: iso(1000) }])
    expect((await getSettings()).defaultRate).toBe(2)
    await saveSettings({ ...(await getSettings()), defaultRate: 3 })
    await mergeRemote('settings', [{ defaultRate: 4, updatedAt: iso(2000) }])
    expect((await getSettings()).defaultRate).toBe(3)
  })

  it('демо-игры не уходят и не перезаписываются', async () => {
    await saveGame(game('d1', { demo: true }))
    expect((await syncSnapshot()).games).toEqual([])
    await mergeRemote('games', [game('d1', { name: 'Чужое', updatedAt: iso(Date.now() + DAY) }), game('d2', { demo: true })])
    expect((await getGame('d1'))?.name).toBe('Пятница')
    expect(await getGame('d2')).toBeUndefined()
  })
})

describe('forgetRecords', () => {
  it('стирает совсем — кроме правленного здесь (в dirty)', async () => {
    await mergeRemote('games', [game('g1'), game('g2')])
    await saveGame(game('g3'))
    expect(await forgetRecords([{ store: 'games', key: 'g1' }, { store: 'games', key: 'g3' }])).toBe(1)
    expect((await listGames()).map((g) => g.id).sort()).toEqual(['g2', 'g3'])
    expect((await syncSnapshot()).games.map((g) => g.id).sort()).toEqual(['g2', 'g3'])
  })

  it('раздачи — по [evening, number]', async () => {
    await mergeRemote('hands', [{ evening: 'local-1', number: 1, code: null, startedAt: 1, hand: { number: 1 }, updatedAt: iso(1000) }])
    expect(await forgetRecords([{ store: 'hands', key: ['local-1', 1] }])).toBe(1)
    expect(await eveningRecords('local-1')).toEqual([])
  })
})

describe('событие изменения', () => {
  it('правка здесь — local, влитое и стёртое синхронизацией — remote, снятие отметок — без события', async () => {
    const seen: ChangeOrigin[] = []
    const off = onChange((origin) => seen.push(origin))
    await saveGame(game('g1'))
    await saveHands([{ evening: 'local-1', number: 1, code: null, startedAt: 1, hand: { number: 1, pots: [], payouts: {} } }])
    await mergeRemote('games', [game('g2')])
    await forgetRecords([{ store: 'games', key: 'g2' }])
    await deleteGame('g1')
    off()
    await saveGame(game('g9'))
    expect(seen).toEqual(['local', 'local', 'remote', 'remote', 'local'])
  })
})
