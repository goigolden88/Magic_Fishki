// Единственный вход в IndexedDB. База magic_fishki: хранилища games (ключ id) и settings (одна запись).
import { linkRegulars, regularsFromNames, settingsWithDefaults, type Game, type Regular, type Settings } from '../model'
import { ulid } from '../ulid'

const DB_NAME = 'magic_fishki'
const DB_VERSION = 2
const SETTINGS_KEY = 'settings'

let opening: Promise<IDBDatabase> | null = null

// Миграции — по шагам от старой версии к новой; записи прежних версий не теряются
function migrate(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('games', { keyPath: 'id' })
    db.createObjectStore('settings')
  }
  if (oldVersion < 2) toRegularIds(tx)
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
  storeName: 'games' | 'settings',
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

// Восстановление из файла-копии (Р-11): игры пишутся как есть, со своим updatedAt; одной транзакцией —
// либо все, либо ни одной. Игры с тем же id уже отсеяны (calc/backup.ts, planRestore).
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

export async function getSettings(): Promise<Settings> {
  const stored = await run<Partial<Settings> | undefined>('settings', 'readonly', (s) => s.get(SETTINGS_KEY))
  return settingsWithDefaults(stored)
}

export async function saveSettings(settings: Settings): Promise<void> {
  await run('settings', 'readwrite', (s) => s.put(settings, SETTINGS_KEY))
}
