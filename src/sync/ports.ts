// Порт синхронизации (#265) поверх своего хранилища: IndexedDB — только через src/store/db.ts,
// ключи памяти браузера — через src/screens/pokerStorage.ts. Демо-игры сюда не попадают (syncSnapshot)
import { THEME_KEY, themeOf } from '../calc/theme'
import { applySyncedPrefs, syncedPrefs } from '../screens/pokerStorage'
import { applyTheme, loadThemeChoice } from '../screens/theme'
import {
  announceRemote,
  clearDirty,
  forgetRecords,
  listDirty,
  loadSyncMeta,
  mergeRemote,
  saveSyncMeta,
  syncSnapshot,
} from '../store/db'
import { nowIso } from './dates'
import type { SyncRecord } from './layout'
import type { Memory, Ports } from './sync'

const MEMORY_KEY = 'tree'
const LAST_AT_KEY = 'lastAt'

function isMemory(value: unknown): value is Memory {
  if (!value || typeof value !== 'object') return false
  const m = value as Memory
  return typeof m.repo === 'string' && typeof m.tree === 'object' && m.tree !== null
}

export const realPorts: Ports = {
  async readAll() {
    const snap = await syncSnapshot()
    return {
      games: snap.games as SyncRecord[],
      settings: snap.settings && typeof snap.settings.updatedAt === 'string' ? (snap.settings as SyncRecord) : null,
      hands: snap.hands as SyncRecord[],
      charts: snap.charts as SyncRecord[],
      prefs: syncedPrefs(),
    }
  },

  // Тип записи здесь не проверить: файл пришёл с сервера, и известно о нём только ключ и updatedAt, на которых
  // держится слияние. Тот же уровень доверия, что у файла-копии
  async merge(store, records) {
    if (store !== 'prefs') return mergeRemote(store, records)
    const applied = applySyncedPrefs(records)
    if (applied.includes(THEME_KEY)) applyTheme(themeOf(loadThemeChoice()))
    if (applied.length > 0) announceRemote()
    return applied.length
  },

  forget: (refs) =>
    forgetRecords(refs.map((r) => ({ store: r.store, key: r.store === 'hands' ? (JSON.parse(r.key) as [string, number]) : r.key }))),

  listDirty,
  clearDirty: (marks) => clearDirty([...marks]),

  async remembered() {
    const value = await loadSyncMeta(MEMORY_KEY)
    return isMemory(value) ? value : null
  },

  async remember(memory) {
    await saveSyncMeta(MEMORY_KEY, memory)
    await saveSyncMeta(LAST_AT_KEY, nowIso())
  },
}

export async function lastSyncAt(): Promise<string | null> {
  const value = await loadSyncMeta(LAST_AT_KEY)
  return typeof value === 'string' ? value : null
}
