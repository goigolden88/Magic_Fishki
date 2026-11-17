// Репозиторий данных и токен синхронизации (#265) — в памяти браузера «Фишек», ключи fishki.sync.*:
// не в IndexedDB, не в общей базе соседних приложений на том же адресе, не в файл-копию и не в репозиторий данных.
// Данные этого устройства: на каждом телефоне и ноутбуке вписываются свои
import { DEFAULT_BRANCH, type ConfigStore, type SyncConfig } from './sync'

export const REPO_KEY = 'fishki.sync.repo'
export const TOKEN_KEY = 'fishki.sync.token'
export const EXPIRES_KEY = 'fishki.sync.tokenExpires'
export const BRANCH_KEY = 'fishki.sync.branch'

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // нет места или запрещено — не запомним: синхронизация останется ненастроенной
  }
}

export const localConfig: ConfigStore = {
  read(): SyncConfig {
    return {
      repo: read(REPO_KEY),
      token: read(TOKEN_KEY),
      branch: read(BRANCH_KEY) || DEFAULT_BRANCH,
      tokenExpires: read(EXPIRES_KEY) || null,
    }
  },

  save(patch) {
    if (patch.repo !== undefined) write(REPO_KEY, patch.repo.trim())
    if (patch.branch !== undefined) write(BRANCH_KEY, patch.branch.trim() === DEFAULT_BRANCH ? '' : patch.branch.trim())
    // Новый токен стирает срок прежнего; срок из той же правки ложится после
    if (patch.token !== undefined) {
      write(TOKEN_KEY, patch.token.trim())
      write(EXPIRES_KEY, '')
    }
    if (patch.tokenExpires !== undefined) write(EXPIRES_KEY, patch.tokenExpires ?? '')
  },

  // «Забыть токен»: токен и его срок; имя репозитория остаётся — вставить новый токен проще
  forgetToken() {
    write(TOKEN_KEY, '')
    write(EXPIRES_KEY, '')
  },
}
