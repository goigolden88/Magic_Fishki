// Единственный вход в IndexedDB. База magic_fishki: хранилища games (ключ id) и settings (одна запись).
import { settingsWithDefaults, type Game, type Settings } from '../model'

const DB_NAME = 'magic_fishki'
const DB_VERSION = 1
const SETTINGS_KEY = 'settings'

let opening: Promise<IDBDatabase> | null = null

// Миграции — по шагам от старой версии к новой; записи прежних версий не теряются
function migrate(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('games', { keyPath: 'id' })
    db.createObjectStore('settings')
  }
}

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => migrate(req.result, e.oldVersion)
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
