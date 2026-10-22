import type { LastBackup } from '../calc/backup'

// Когда эта копия отдана последней — состояние устройства, а не данные игр: в localStorage, не в IndexedDB и не в копию
const LAST_BACKUP_KEY = 'fishki.lastBackup'

export function loadLastBackup(): LastBackup | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAST_BACKUP_KEY) ?? 'null')
    if (parsed && typeof parsed === 'object') {
      const { at, date } = parsed as Record<string, unknown>
      if (typeof at === 'string' && typeof date === 'string') return { at, date }
    }
    return null
  } catch {
    return null
  }
}

export function saveLastBackup(last: LastBackup) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(last))
  } catch {
    // нет места или запрещено — просто не запомним
  }
}
