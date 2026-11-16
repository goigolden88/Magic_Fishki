// Единственный вход в IndexedDB. База magic_fishki: хранилища games (ключ id), settings (одна запись)
// и hands — раздачи прошлых вечеров покера (ключ [evening, number], #114), charts — свои чарты тренажёра (ключ id, #215).
import { eveningSummaries, isBotsEvening, type EveningCounts, type EveningSummary, type SavedHand } from '../calc/evenings'
import { byName, type OwnChart } from '../calc/ownCharts'
import { linkRegulars, regularsFromNames, settingsWithDefaults, type Game, type Regular, type Settings } from '../model'
import type { HistoryHand } from '../poker/history'
import { ulid } from '../ulid'

const DB_NAME = 'magic_fishki'
const DB_VERSION = 4
const SETTINGS_KEY = 'settings'
const HANDS = 'hands'
const CHARTS = 'charts'
const BY_EVENING = 'evening'

let opening: Promise<IDBDatabase> | null = null

// Миграции — по шагам от старой версии к новой; записи прежних версий не теряются
function migrate(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('games', { keyPath: 'id' })
    db.createObjectStore('settings')
  }
  if (oldVersion < 2) toRegularIds(tx)
  // Версия 3 (Р-37): только новое хранилище раздач; игры и настройки не трогаются
  if (oldVersion < 3) {
    const hands = db.createObjectStore(HANDS, { keyPath: ['evening', 'number'] })
    hands.createIndex(BY_EVENING, 'evening')
  }
  // Версия 4 (Р-77): только новое хранилище своих чартов; прежние записи не трогаются
  if (oldVersion < 4) db.createObjectStore(CHARTS, { keyPath: 'id' })
}

// Версия 2 (Р-12): постоянные игроки — из строк в { id, name } с новыми id в прежнем порядке;
// участникам сохранённых игр с точно тем же именем — regularId. Остальное в играх не меняется
function toRegularIds(tx: IDBTransaction): void {
  const settings = tx.objectStore('settings')
  const read = settings.get(SETTINGS_KEY)
  read.onsuccess = () => {
    const stored: unknown = read.result
    let regulars: Regular[] = []
    if (typeof stored === 'object' && stored !== null && 'players' in stored && Array.isArray(stored.players)) {
      const names = stored.players.filter((p): p is string => typeof p === 'string')
      regulars = regularsFromNames(names, () => ulid())
      settings.put({ ...stored, players: regulars }, SETTINGS_KEY)
    }
    const cursor = tx.objectStore('games').openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) return
      const game = c.value as Game
      const players = linkRegulars(game.players, regulars)
      if (players.some((p, i) => p !== game.players[i])) c.update({ ...game, players })
      c.continue()
    }
  }
}

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => migrate(req.result, req.transaction!, e.oldVersion)
    req.onsuccess = () => {
      const db = req.result
      // Открылась новая версия в другой вкладке — уступаем ей базу
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      resolve(db)
    }
    req.onerror = () => {
      opening = null
      reject(req.error)
    }
  })
  return opening
}

async function run<T>(
  storeName: 'games' | 'settings' | typeof HANDS | typeof CHARTS,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const req = fn(tx.objectStore(storeName))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// Новые сверху: по дню игры, в один день — по времени создания (ULID растёт со временем)
export async function listGames(): Promise<Game[]> {
  const games = await run<Game[]>('games', 'readonly', (s) => s.getAll())
  return games.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

export async function getGame(id: string): Promise<Game | undefined> {
  return run<Game | undefined>('games', 'readonly', (s) => s.get(id))
}

export async function saveGame(game: Game): Promise<Game> {
  const saved = { ...game, updatedAt: new Date().toISOString() }
  await run('games', 'readwrite', (s) => s.put(saved))
  return saved
}

// Восстановление из файла-копии (Р-11) и демо-игры (Р-04): игры пишутся как есть, со своим updatedAt;
// одной транзакцией — либо все, либо ни одной. Игры с тем же id уже отсеяны (calc/backup.ts, planRestore).
export async function restoreGames(games: Game[]): Promise<void> {
  if (games.length === 0) return
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('games', 'readwrite')
    const store = tx.objectStore('games')
    for (const game of games) store.put(game)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// Окончательно: синхронизации нет, игру не вернуть (Р-09)
export async function deleteGame(id: string): Promise<void> {
  await run('games', 'readwrite', (s) => s.delete(id))
}

// «Удалить демо-данные» (Р-04): одной транзакцией — все игры с demo: true и только они. Вернёт, сколько удалено
export async function deleteDemoGames(): Promise<number> {
  const db = await open()
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction('games', 'readwrite')
    let deleted = 0
    const cursor = tx.objectStore('games').openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) return
      if ((c.value as Game).demo === true) {
        c.delete()
        deleted += 1
      }
      c.continue()
    }
    tx.oncomplete = () => resolve(deleted)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function getSettings(): Promise<Settings> {
  const stored = await run<Partial<Settings> | undefined>('settings', 'readonly', (s) => s.get(SETTINGS_KEY))
  return settingsWithDefaults(stored)
}

export async function saveSettings(settings: Settings): Promise<void> {
  await run('settings', 'readwrite', (s) => s.put(settings, SETTINGS_KEY))
}

// Раздачи вечера (#114) — одной транзакцией. Ключ — вечер и номер: та же раздача второй раз
// заменяет запись (после «Показать» — с показанными картами), дублей нет. Свои карты (mine, Р-54)
// у прежней записи остаются, если в новой их нет: телефон, вернувшийся к столу, их уже не видел
export async function saveHands(hands: SavedHand[]): Promise<void> {
  if (hands.length === 0) return
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDS, 'readwrite')
    const store = tx.objectStore(HANDS)
    for (const hand of hands) {
      if (hand.mine) {
        store.put(hand)
        continue
      }
      const old = store.get([hand.evening, hand.number])
      old.onsuccess = () => {
        const mine = (old.result as SavedHand | undefined)?.mine
        store.put(mine ? { ...hand, mine } : hand)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// Все записи раздач — для «Выгрузить все» и копии данных (Р-54)
export async function allHands(): Promise<SavedHand[]> {
  return run<SavedHand[]>(HANDS, 'readonly', (s) => s.getAll())
}

// Записи вечера целиком (со столом и своими картами) — для «Выгрузить», по номерам
export async function eveningRecords(id: string): Promise<SavedHand[]> {
  const saved = await run<SavedHand[]>(HANDS, 'readonly', (s) => s.index(BY_EVENING).getAll(id))
  return saved.sort((a, b) => a.number - b.number)
}

// Ключи записанных раздач «вечер + номер» — восстановлению из копии: что уже есть
export async function handKeys(): Promise<[string, number][]> {
  return run<IDBValidKey[]>(HANDS, 'readonly', (s) => s.getAllKeys()) as Promise<[string, number][]>
}

// Восстановление раздач из копии (Р-54): записи как есть, одной транзакцией. Уже записанные отсеяны (planRestore)
export async function restoreHands(hands: SavedHand[]): Promise<void> {
  if (hands.length === 0) return
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDS, 'readwrite')
    const store = tx.objectStore(HANDS)
    for (const hand of hands) store.put(hand)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// «Прошлые вечера», новые сверху: по первой записи каждого вечера, число его раздач и мой итог за вечер (#242) —
// итог суммой по раздачам, поэтому записи читаются целиком
export async function listEvenings(): Promise<EveningSummary[]> {
  return eveningSummaries(await allHands())
}

// «Удалить» пачкой в «Настройках» (#242): все раздачи вечеров против ботов (onlyBots) или всех прошлых вечеров —
// одной транзакцией. Игры учёта и чарты не трогаются. Вернёт, сколько вечеров и раздач удалено
export async function deleteEvenings(onlyBots: boolean): Promise<EveningCounts> {
  const db = await open()
  return new Promise<EveningCounts>((resolve, reject) => {
    const tx = db.transaction(HANDS, 'readwrite')
    const evenings = new Set<string>()
    let hands = 0
    const cursor = tx.objectStore(HANDS).openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) return
      const evening = (c.value as SavedHand).evening
      if (!onlyBots || isBotsEvening({ id: evening })) {
        c.delete()
        evenings.add(evening)
        hands += 1
      }
      c.continue()
    }
    tx.oncomplete = () => resolve({ evenings: evenings.size, hands })
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// Раздачи вечера по номерам
export async function eveningHands(id: string): Promise<HistoryHand[]> {
  return (await eveningRecords(id)).map((h) => h.hand)
}

// «Мои чарты» (#215, Р-77) — по имени
export async function listCharts(): Promise<OwnChart[]> {
  return byName(await run<OwnChart[]>(CHARTS, 'readonly', (s) => s.getAll()))
}

// Свой чарт: тот же id — заменяет запись (правка, переименование); время правки ставится само
export async function saveChart(chart: OwnChart): Promise<OwnChart> {
  const saved = { ...chart, updatedAt: new Date().toISOString() }
  await run(CHARTS, 'readwrite', (s) => s.put(saved))
  return saved
}

// Окончательно, как удаление игры
export async function deleteChart(id: string): Promise<void> {
  await run(CHARTS, 'readwrite', (s) => s.delete(id))
}

// id своих чартов — восстановлению из копии: что уже есть
export async function chartIds(): Promise<string[]> {
  return run<IDBValidKey[]>(CHARTS, 'readonly', (s) => s.getAllKeys()) as Promise<string[]>
}

// Восстановление чартов из копии (Р-77): записи как есть, одной транзакцией. Чарты с тем же id отсеяны (planRestore)
export async function restoreCharts(charts: OwnChart[]): Promise<void> {
  if (charts.length === 0) return
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHARTS, 'readwrite')
    const store = tx.objectStore(CHARTS)
    for (const chart of charts) store.put(chart)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// «Удалить» у вечера: все его раздачи одной транзакцией. Окончательно, как удаление игры
export async function deleteEvening(id: string): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDS, 'readwrite')
    const cursor = tx.objectStore(HANDS).index(BY_EVENING).openCursor(id)
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) return
      c.delete()
      c.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
