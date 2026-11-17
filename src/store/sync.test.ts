import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBackup, parseBackup, planRestore } from '../calc/backup'
import { savedHands, type Evening, type SavedHand } from '../calc/evenings'
import type { OwnChart } from '../calc/ownCharts'
import type { Game } from '../model'
import type { HistoryHand } from '../poker/history'
import {
  allHands,
  chartIds,
  clearDirty,
  deleteChart,
  deleteDemoGames,
  deleteEvening,
  deleteEvenings,
  deleteGame,
  eveningRecords,
  getGame,
  getSettings,
  handKeys,
  listCharts,
  listDirty,
  listEvenings,
  listGames,
  loadSyncMeta,
  restoreCharts,
  restoreGames,
  restoreHands,
  saveChart,
  saveGame,
  saveHands,
  saveSettings,
  saveSyncMeta,
  type DirtyMark,
  type HandTombstone,
  type Tombstone,
} from './db'

// Синхронизация, шаг 1 (#264): время правки у всех данных, удаление пометкой, список неотправленного

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Записи хранилища как лежат — с пометками удаления; своё соединение и сразу закрыть
async function raw<T>(store: string): Promise<T[]> {
  const db = await request(indexedDB.open('magic_fishki'))
  try {
    return await request(db.transaction(store).objectStore(store).getAll())
  } finally {
    db.close()
  }
}

const sortMarks = (marks: DirtyMark[]) => [...marks].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

function game(id: string, over: Partial<Game> = {}): Game {
  return {
    id,
    name: 'Пятница',
    date: '2026-10-02',
    rate: 0.5,
    players: [{ id: `${id}-p0`, name: 'Аня' }],
    entries: [{ id: `${id}-e0`, playerId: `${id}-p0`, kind: 'buyin', chips: 1000, at: '2026-10-02T19:00:00.000Z' }],
    closed: true,
    updatedAt: '2026-10-02T23:30:00.000Z',
    ...over,
  }
}

const hand = (number: number, amount = 100): HistoryHand => ({ number, pots: [{ amount, winners: ['Аня'] }], payouts: { Аня: amount } })

const chart = (id: string, name: string): OwnChart => ({
  id,
  name,
  base: null,
  actions: ['fold', 'call'],
  cells: { AA: [0, 1] },
  updatedAt: '2026-11-14T10:00:00.000Z',
})

const FRIDAY: Evening = { id: 'KQ7MZP-1000', code: 'KQ7MZP', startedAt: Date.UTC(2026, 9, 23, 19) }
const BOTS: Evening = { id: 'bots-B1', code: null, startedAt: Date.UTC(2026, 9, 24, 19) }

// Восстановление, как его делает экран «Настройки»
async function restore(backup: ReturnType<typeof makeBackup>) {
  const parsed = parseBackup(JSON.stringify(backup), () => 'new')
  if (!parsed.ok) throw new Error(parsed.error)
  const settings = await getSettings()
  const plan = planRestore(
    (await listGames()).map((g) => g.id),
    settings.players,
    parsed.backup,
    await handKeys(),
    await chartIds(),
  )
  await restoreGames(plan.added)
  await restoreHands(plan.hands)
  await restoreCharts(plan.charts)
  return plan
}

beforeEach(async () => {
  await request(indexedDB.deleteDatabase('magic_fishki'))
})

describe('миграция базы 4 → 5 (#264)', () => {
  it('игры, настройки, раздачи и чарты на месте; у раздач — время правки из начала вечера; неотправленного нет', async () => {
    const SETTINGS = { defaultRate: 0.25, players: [{ id: 'r1', name: 'Аня' }], quickAmounts: [500], defaultBuyin: 2000, compareWindow: 7 }
    const GAME = game('01A')
    const HANDS: SavedHand[] = [
      ...savedHands(FRIDAY, [hand(1), hand(2)], new Map([[1, ['As', 'Kd']]])),
      ...savedHands(BOTS, [hand(1)]),
    ]
    const CHART = chart('c1', 'UTG')

    const req = indexedDB.open('magic_fishki', 4)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('games', { keyPath: 'id' })
      req.result.createObjectStore('settings')
      req.result.createObjectStore('hands', { keyPath: ['evening', 'number'] }).createIndex('evening', 'evening')
      req.result.createObjectStore('charts', { keyPath: 'id' })
    }
    const db = await request(req)
    const tx = db.transaction(['games', 'settings', 'hands', 'charts'], 'readwrite')
    tx.objectStore('settings').put(SETTINGS, 'settings')
    tx.objectStore('games').put(GAME)
    for (const h of HANDS) tx.objectStore('hands').put(h)
    tx.objectStore('charts').put(CHART)
    await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()))
    db.close()

    expect(await listGames()).toEqual([GAME])
    expect(await getSettings()).toEqual(SETTINGS)
    expect(await listCharts()).toEqual([CHART])
    const hands = await allHands()
    expect(hands).toEqual(
      HANDS.map((h) => ({ ...h, updatedAt: new Date(h.startedAt).toISOString() })).sort((a, b) =>
        a.evening === b.evening ? a.number - b.number : a.evening < b.evening ? -1 : 1,
      ),
    )
    expect((await eveningRecords(FRIDAY.id))[0].mine).toEqual(['As', 'Kd'])
    expect((await listEvenings()).map((e) => [e.id, e.hands])).toEqual([
      [BOTS.id, 1],
      [FRIDAY.id, 2],
    ])
    expect(await listDirty()).toEqual([])
    expect(await loadSyncMeta('commit')).toBeUndefined()
  })
})

describe('каждая запись — отметка «не отправлено» (#264)', () => {
  it('игра, настройки, раздачи, чарт; вторая правка отметку не множит; отправленное снимается', async () => {
    await saveGame(game('01A'))
    await saveGame(game('01A', { name: 'Суббота' }))
    await saveSettings(await getSettings())
    await saveHands(savedHands(FRIDAY, [hand(1), hand(2)]))
    await saveChart(chart('c1', 'UTG'))

    const marks = sortMarks(await listDirty())
    expect(marks).toEqual(
      sortMarks([
        { store: 'games', key: '01A' },
        { store: 'settings', key: 'settings' },
        { store: 'hands', key: [FRIDAY.id, 1] },
        { store: 'hands', key: [FRIDAY.id, 2] },
        { store: 'charts', key: 'c1' },
      ]),
    )
    await clearDirty(marks.filter((m) => m.store !== 'charts'))
    expect(await listDirty()).toEqual([{ store: 'charts', key: 'c1' }])
  })

  it('настройки: в записи — время правки, экраны его не видят', async () => {
    const before = new Date().toISOString()
    const settings = { ...(await getSettings()), defaultRate: 1 }
    await saveSettings(settings)
    expect(await getSettings()).toEqual(settings)
    const [stored] = await raw<{ updatedAt: string }>('settings')
    expect(stored.updatedAt >= before).toBe(true)
  })

  it('раздача: «Показать» — новое время; та же самая второй раз — не переписывается', async () => {
    await saveHands(savedHands(FRIDAY, [hand(1)]))
    const [first] = await allHands()
    await clearDirty(await listDirty())

    await saveHands(savedHands(FRIDAY, [hand(1)]))
    expect(await allHands()).toEqual([first])
    expect(await listDirty()).toEqual([])

    await new Promise((r) => setTimeout(r, 5))
    await saveHands(savedHands(FRIDAY, [hand(1, 500)]))
    const [shown] = await allHands()
    expect(shown.hand).toEqual(hand(1, 500))
    expect(shown.updatedAt! > first.updatedAt!).toBe(true)
    expect(await listDirty()).toEqual([{ store: 'hands', key: [FRIDAY.id, 1] }])
  })

  it('память синхронизации — по имени', async () => {
    await saveSyncMeta('commit', 'abc123')
    await saveSyncMeta('files', { 'games.json': 'f1' })
    expect(await loadSyncMeta('commit')).toBe('abc123')
    expect(await loadSyncMeta('files')).toEqual({ 'games.json': 'f1' })
    expect(await listDirty()).toEqual([])
  })
})

describe('удаление — меткой вместо записи (#264, #301)', () => {
  it('игра: пропадает из списков и копии; в базе — только метка: id, deleted, новое время; отметка', async () => {
    await saveGame(game('01A'))
    await saveGame(game('01B'))
    await clearDirty(await listDirty())
    const before = new Date().toISOString()

    await deleteGame('01A')
    expect((await listGames()).map((g) => g.id)).toEqual(['01B'])
    expect(await getGame('01A')).toBeUndefined()
    const backup = makeBackup(await listGames(), await getSettings(), before)
    expect(backup.games.map((g) => g.id)).toEqual(['01B'])

    const stored = (await raw<Tombstone>('games')).find((g) => g.id === '01A')!
    expect(stored).toEqual({ id: '01A', deleted: true, updatedAt: stored.updatedAt })
    expect(stored.updatedAt >= before).toBe(true)
    expect(await listDirty()).toEqual([{ store: 'games', key: '01A' }])

    // Второй раз — ничего нового
    await clearDirty(await listDirty())
    await deleteGame('01A')
    await deleteGame('нет-такой')
    expect(await listDirty()).toEqual([])
  })

  it('вечер и вечера пачкой: пропадают из «Прошлых вечеров», копии и ключей; повтор — ноль', async () => {
    await saveHands(savedHands(FRIDAY, [hand(1), hand(2)]))
    await saveHands(savedHands(BOTS, [hand(1)]))
    await clearDirty(await listDirty())

    await deleteEvening(FRIDAY.id)
    expect((await listEvenings()).map((e) => e.id)).toEqual([BOTS.id])
    expect(await eveningRecords(FRIDAY.id)).toEqual([])
    expect(await handKeys()).toEqual([[BOTS.id, 1]])
    expect((await allHands()).map((h) => h.evening)).toEqual([BOTS.id])
    expect(sortMarks(await listDirty())).toEqual(
      sortMarks([
        { store: 'hands', key: [FRIDAY.id, 1] },
        { store: 'hands', key: [FRIDAY.id, 2] },
      ]),
    )
    // У раздач удалённого вечера — только ключ, deleted и время правки: карт, ходов, имён нет
    const stored = await raw<SavedHand | HandTombstone>('hands')
    expect(stored.map((h) => Object.keys(h).sort())).toEqual([
      ['deleted', 'evening', 'number', 'updatedAt'],
      ['deleted', 'evening', 'number', 'updatedAt'],
      ['code', 'evening', 'hand', 'number', 'startedAt', 'updatedAt'],
    ])
    expect(stored.slice(0, 2).map((h) => [h.evening, h.number, 'deleted' in h && h.deleted])).toEqual([
      [FRIDAY.id, 1, true],
      [FRIDAY.id, 2, true],
    ])

    expect(await deleteEvenings(false)).toEqual({ evenings: 1, hands: 1 })
    expect(await deleteEvenings(false)).toEqual({ evenings: 0, hands: 0 })
    expect(await listEvenings()).toEqual([])
    expect(await raw<SavedHand>('hands')).toHaveLength(3)

    // Стол с ботами ещё идёт — раздача удалённого вечера пишется заново
    await saveHands(savedHands(BOTS, [hand(2)]))
    expect((await listEvenings()).map((e) => [e.id, e.hands])).toEqual([[BOTS.id, 1]])
  })

  it('чарт: пропадает из «Моих чартов» и ключей; в базе — только метка', async () => {
    await saveChart(chart('c1', 'UTG'))
    await saveChart(chart('c2', 'BTN'))
    await deleteChart('c1')
    expect((await listCharts()).map((c) => c.id)).toEqual(['c2'])
    expect(await chartIds()).toEqual(['c2'])
    const stored = (await raw<OwnChart | Tombstone>('charts')).find((c) => c.id === 'c1')!
    expect(stored).toEqual({ id: 'c1', deleted: true, updatedAt: stored.updatedAt })
  })
})

describe('восстановление из копии возвращает удалённое (#264)', () => {
  it('игра, вечер и чарт с тем же ключом встают обратно: пометки нет, время — сейчас; живые не трогаются', async () => {
    await saveGame(game('01A'))
    const kept = await saveGame(game('01B'))
    await saveHands(savedHands(FRIDAY, [hand(1)], new Map([[1, ['As', 'Kd']]])))
    await saveChart(chart('c1', 'UTG'))
    const backup = makeBackup(await listGames(), await getSettings(), 'x', await allHands(), {}, {}, undefined, undefined, await listCharts())

    await deleteGame('01A')
    await deleteEvening(FRIDAY.id)
    await deleteChart('c1')
    await saveGame({ ...kept, name: 'Своя правка' })
    await clearDirty(await listDirty())
    await new Promise((r) => setTimeout(r, 5))
    const restoredAt = new Date().toISOString()

    const plan = await restore(backup)
    expect(plan.added.map((g) => g.id)).toEqual(['01A'])
    expect(plan.existing).toBe(1)

    const back = (await getGame('01A'))!
    expect(back).toEqual({ ...backup.games.find((g) => g.id === '01A'), updatedAt: back.updatedAt })
    expect(back.updatedAt >= restoredAt).toBe(true)
    expect((await getGame('01B'))?.name).toBe('Своя правка')

    const [h] = await eveningRecords(FRIDAY.id)
    expect(h).toEqual({ ...backup.hands[0], updatedAt: h.updatedAt })
    expect(h.mine).toEqual(['As', 'Kd'])
    expect(h.updatedAt! >= restoredAt).toBe(true)

    const [c] = await listCharts()
    expect(c).toEqual({ ...chart('c1', 'UTG'), updatedAt: c.updatedAt })
    expect(c.updatedAt >= restoredAt).toBe(true)

    expect(sortMarks(await listDirty())).toEqual(
      sortMarks([
        { store: 'games', key: '01A' },
        { store: 'hands', key: [FRIDAY.id, 1] },
        { store: 'charts', key: 'c1' },
      ]),
    )
  })

  it('раздача из копии до #264 — без времени правки: ставится начало вечера', async () => {
    const [old] = savedHands(FRIDAY, [hand(1)])
    await restoreHands([old])
    expect((await allHands())[0].updatedAt).toBe(new Date(FRIDAY.startedAt).toISOString())
  })
})

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString()

type V5 = { games?: unknown[]; hands?: unknown[]; charts?: unknown[]; dirty?: DirtyMark[]; syncMeta?: Record<string, unknown> }

// База версии 5 — как её оставило приложение после #264, с записями как есть; приложение откроет её следующим чтением
async function openV5(data: V5): Promise<void> {
  const req = indexedDB.open('magic_fishki', 5)
  req.onupgradeneeded = () => {
    req.result.createObjectStore('games', { keyPath: 'id' })
    req.result.createObjectStore('settings')
    req.result.createObjectStore('hands', { keyPath: ['evening', 'number'] }).createIndex('evening', 'evening')
    req.result.createObjectStore('charts', { keyPath: 'id' })
    req.result.createObjectStore('dirty', { keyPath: ['store', 'key'] })
    req.result.createObjectStore('syncMeta')
  }
  const db = await request(req)
  const tx = db.transaction(['games', 'hands', 'charts', 'dirty', 'syncMeta'], 'readwrite')
  for (const g of data.games ?? []) tx.objectStore('games').put(g)
  for (const h of data.hands ?? []) tx.objectStore('hands').put(h)
  for (const c of data.charts ?? []) tx.objectStore('charts').put(c)
  for (const m of data.dirty ?? []) tx.objectStore('dirty').put(m)
  for (const [k, v] of Object.entries(data.syncMeta ?? {})) tx.objectStore('syncMeta').put(v, k)
  await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()))
  db.close()
}

const ids = async (store: string) => (await raw<{ id: string }>(store)).map((r) => r.id)

describe('миграция базы 5 → 6 (#301)', () => {
  it('помеченное удалённым сжимается до меток; живые записи и отметки не трогаются', async () => {
    const at = daysAgo(1)
    const [friday] = savedHands(FRIDAY, [hand(1)], new Map([[1, ['As', 'Kd']]]))
    const [bots] = savedHands(BOTS, [hand(1)])
    const live = { ...friday, updatedAt: daysAgo(40) }
    const DIRTY: DirtyMark[] = [
      { store: 'games', key: '01B' },
      { store: 'hands', key: [BOTS.id, 1] },
    ]
    await openV5({
      games: [game('01A'), { ...game('01B'), deleted: true, updatedAt: at }],
      hands: [live, { ...bots, deleted: true, updatedAt: at }],
      charts: [chart('c1', 'UTG'), { ...chart('c2', 'BTN'), deleted: true, updatedAt: at }],
      dirty: DIRTY,
    })

    expect(await listGames()).toEqual([game('01A')])
    expect(await allHands()).toEqual([live])
    expect(await listCharts()).toEqual([chart('c1', 'UTG')])
    expect(await raw('games')).toEqual([game('01A'), { id: '01B', deleted: true, updatedAt: at }])
    expect(await raw('hands')).toEqual([live, { evening: BOTS.id, number: 1, deleted: true, updatedAt: at }])
    expect(await raw('charts')).toEqual([chart('c1', 'UTG'), { id: 'c2', deleted: true, updatedAt: at }])
    expect(sortMarks(await listDirty())).toEqual(sortMarks(DIRTY))
  })
})

describe('метка живёт 30 дней (#301)', () => {
  it('синхронизация не подключалась: метка 31 дня стирается вместе с отметкой, 29 дней — остаётся; живые старые — на месте', async () => {
    await openV5({
      games: [
        game('01A'),
        { id: 'old', deleted: true, updatedAt: daysAgo(31) },
        { id: 'new', deleted: true, updatedAt: daysAgo(29) },
      ],
      hands: [
        { evening: FRIDAY.id, number: 1, deleted: true, updatedAt: daysAgo(31) },
        { evening: FRIDAY.id, number: 2, deleted: true, updatedAt: daysAgo(29) },
      ],
      charts: [{ id: 'old', deleted: true, updatedAt: daysAgo(31) }],
      dirty: [
        { store: 'games', key: 'old' },
        { store: 'games', key: 'new' },
        { store: 'hands', key: [FRIDAY.id, 1] },
        { store: 'charts', key: 'old' },
        { store: 'settings', key: 'settings' },
      ],
    })

    expect(await listGames()).toEqual([game('01A')])
    expect(await ids('games')).toEqual(['01A', 'new'])
    expect((await raw<HandTombstone>('hands')).map((h) => h.number)).toEqual([2])
    expect(await raw('charts')).toEqual([])
    expect(sortMarks(await listDirty())).toEqual(
      sortMarks([
        { store: 'games', key: 'new' },
        { store: 'settings', key: 'settings' },
      ]),
    )
  })

  it('синхронизация подключалась: метка 31 дня в «не отправлено» остаётся, отправленная — стирается; отметок не прибавилось', async () => {
    const DIRTY: DirtyMark[] = [
      { store: 'games', key: 'unsent' },
      { store: 'hands', key: [FRIDAY.id, 1] },
    ]
    await openV5({
      games: [
        { id: 'unsent', deleted: true, updatedAt: daysAgo(31) },
        { id: 'sent', deleted: true, updatedAt: daysAgo(31) },
        { id: 'fresh', deleted: true, updatedAt: daysAgo(29) },
      ],
      hands: [
        { evening: FRIDAY.id, number: 1, deleted: true, updatedAt: daysAgo(31) },
        { evening: FRIDAY.id, number: 2, deleted: true, updatedAt: daysAgo(31) },
      ],
      charts: [{ id: 'sent', deleted: true, updatedAt: daysAgo(31) }],
      dirty: DIRTY,
      syncMeta: { commit: 'abc123' },
    })

    expect(await listGames()).toEqual([])
    expect((await ids('games')).sort()).toEqual(['fresh', 'unsent'])
    expect((await raw<HandTombstone>('hands')).map((h) => h.number)).toEqual([1])
    expect(await raw('charts')).toEqual([])
    expect(sortMarks(await listDirty())).toEqual(sortMarks(DIRTY))
    expect(await loadSyncMeta('commit')).toBe('abc123')
  })

  it('восстановление из копии после стирания метки возвращает запись целиком', async () => {
    await saveGame(game('01A'))
    await saveHands(savedHands(FRIDAY, [hand(1)], new Map([[1, ['As', 'Kd']]])))
    await saveChart(chart('c1', 'UTG'))
    const backup = makeBackup(await listGames(), await getSettings(), 'x', await allHands(), {}, {}, undefined, undefined, await listCharts())

    await request(indexedDB.deleteDatabase('magic_fishki'))
    await openV5({
      games: [{ id: '01A', deleted: true, updatedAt: daysAgo(31) }],
      hands: [{ evening: FRIDAY.id, number: 1, deleted: true, updatedAt: daysAgo(31) }],
      charts: [{ id: 'c1', deleted: true, updatedAt: daysAgo(31) }],
    })
    expect(await listGames()).toEqual([])
    expect(await raw('games')).toEqual([])
    expect(await raw('hands')).toEqual([])
    expect(await raw('charts')).toEqual([])

    const plan = await restore(backup)
    expect(plan.added.map((g) => g.id)).toEqual(['01A'])
    expect(await listGames()).toEqual(backup.games)
    expect(await allHands()).toEqual(backup.hands)
    expect(await listCharts()).toEqual(backup.charts)
  })
})

describe('демо-игры не синхронизируются (Р-04, #264)', () => {
  it('добавление, правка и удаление демо — без отметок; удалённая демо стирается совсем', async () => {
    await restoreGames([game('D1', { demo: true }), game('D2', { demo: true })])
    await saveGame(game('D1', { demo: true, name: 'Правка' }))
    await deleteGame('D2')
    expect(await listDirty()).toEqual([])
    expect((await raw<Game>('games')).map((g) => g.id)).toEqual(['D1'])
    expect(await deleteDemoGames()).toBe(1)
    expect(await raw<Game>('games')).toEqual([])
    expect(await listDirty()).toEqual([])
  })
})

// Память браузера: обычная, как в pokerStorage.test.ts
function fakeStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

describe('ключи памяти браузера, что в копии (#264)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('запись ставит время правки в fishki.sync.stamps и отметку; то же значение — ничего; прочие ключи — без отметок', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    vi.resetModules()
    const s = await import('../screens/pokerStorage')
    const db = await import('./db')
    const before = new Date().toISOString()

    s.saveBigBlinds(true)
    s.saveNotes({ notes: { Аня: { color: 'green', text: 'фиш' } }, labels: {} })
    await vi.waitFor(async () => expect(await db.listDirty()).toHaveLength(2))
    expect(sortMarks(await db.listDirty())).toEqual(
      sortMarks([
        { store: 'local', key: 'fishki.poker.bigBlinds' },
        { store: 'local', key: 'fishki.poker.notes' },
      ]),
    )
    const stamps = s.loadSyncStamps()
    expect(Object.keys(stamps).sort()).toEqual(['fishki.poker.bigBlinds', 'fishki.poker.notes'])
    expect(stamps['fishki.poker.bigBlinds'] >= before).toBe(true)
    expect(JSON.parse(storage.data.get('fishki.sync.stamps')!)).toEqual(stamps)

    // То же значение — правки нет; устройственное (пароль, звук) — не синхронизируется
    await db.clearDirty(await db.listDirty())
    s.saveBigBlinds(true)
    s.savePassword('секрет')
    s.saveTurnSound(false)
    s.saveHudDetailed(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(await db.listDirty()).toEqual([])
    expect(s.loadSyncStamps()).toEqual(stamps)

    // Стирание — тоже правка
    s.saveNotes({ notes: {}, labels: {} })
    await vi.waitFor(async () => expect(await db.listDirty()).toEqual([{ store: 'local', key: 'fishki.poker.notes' }]))
    expect(storage.data.has('fishki.poker.notes')).toBe(false)
  })
})
