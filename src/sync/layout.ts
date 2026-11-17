// Раскладка репозитория данных «Фишек» (#265) — своя, не ядра семьи: какие записи в каком файле.
//   games/<год>.json        — игры учёта по году `date`; метка удаления — по году её `updatedAt` (дня у неё нет)
//   hands/<вечер>.json      — раздачи вечера одним файлом (ключ — [evening, number])
//   charts.json             — свои чарты тренажёра
//   settings.json           — запись настроек (одна)
//   prefs.json              — ключи памяти браузера из копии: { key, value, updatedAt }, value null — стёрт
//   README.md               — для человека: что это и что руками не править; есть — не трогаем
// Файл — { app, kind, format, records }, записи по ключу: одинаковые данные — одинаковый отпечаток.
// Метки удаления (#301) едут в файлы; старше TOMBSTONE_DAYS — нет: тем же проходом они уходят и из репозитория.
// Демо-игры (Р-04) не едут никогда
import { TOMBSTONE_DAYS } from '../store/db'

export const README_PATH = 'README.md'
export const APP = 'magic_fishki'
// Версия формата файлов репозитория. Файл новее — не читаем и не пишем поверх: «обнови приложение»
export const SYNC_FORMAT = 1

export type SyncStore = 'games' | 'settings' | 'hands' | 'charts' | 'prefs'
// Записи, которые бывают удалены меткой и стираются правилом «нет в репо — значит удалено»
export type RecordStore = 'games' | 'hands' | 'charts'

// Запись как есть: от неё синхронизации нужны только ключ и updatedAt; deleted — метка (#301)
export type SyncRecord = { updatedAt: string; deleted?: true; [field: string]: unknown }
export type PrefRecord = { key: string; value: string | null; updatedAt: string }

export type SyncData = {
  games: SyncRecord[]
  settings: SyncRecord | null
  hands: SyncRecord[]
  charts: SyncRecord[]
  prefs: PrefRecord[]
}

export type RepoFile = { path: string; content: string }

const DAY_MS = 24 * 60 * 60 * 1000
const SINGLE: Record<string, SyncStore> = { 'charts.json': 'charts', 'settings.json': 'settings', 'prefs.json': 'prefs' }

// Чей это путь; null — не наш файл (README, положенное руками): не читается и не трогается
export function storeOf(path: string): SyncStore | null {
  if (SINGLE[path]) return SINGLE[path]
  if (/^games\/\d{4}\.json$/.test(path)) return 'games'
  if (/^hands\/[^/]+\.json$/.test(path)) return 'hands'
  return null
}

// Ключ записи строкой — для сравнения: у раздачи — [evening, number] JSON-ом, у настроек — 'settings'
export function recordKey(store: SyncStore, record: Record<string, unknown>): string | null {
  if (store === 'settings') return 'settings'
  if (store === 'prefs') return typeof record.key === 'string' ? record.key : null
  if (store === 'hands') {
    const { evening, number } = record
    return typeof evening === 'string' && typeof number === 'number' ? JSON.stringify([evening, number]) : null
  }
  return typeof record.id === 'string' ? record.id : null
}

function yearOf(record: SyncRecord): string {
  const date = typeof record.date === 'string' && !record.deleted ? record.date : record.updatedAt
  const year = /^\d{4}/.exec(date)?.[0]
  return year ?? '0000'
}

// Файл записи
export function pathOf(store: SyncStore, record: SyncRecord): string {
  if (store === 'games') return `games/${yearOf(record)}.json`
  if (store === 'hands') return `hands/${encodeURIComponent(String(record.evening))}.json`
  return `${store}.json`
}

// Метка удаления старше TOMBSTONE_DAYS (по её updatedAt) — её больше нет нигде
export function expiredMark(record: { deleted?: unknown; updatedAt: unknown }, at: number): boolean {
  return record.deleted === true && typeof record.updatedAt === 'string' && at - Date.parse(record.updatedAt) > TOMBSTONE_DAYS * DAY_MS
}

function fileText(kind: SyncStore, records: readonly object[]): string {
  return `${JSON.stringify({ app: APP, kind, format: SYNC_FORMAT, records }, null, 1)}\n`
}

// Файлы из базы целиком. Пустой вечер и пустой год файла не дают — такой файл синхронизация удаляет из репозитория
export function buildFiles(data: SyncData, at: number): RepoFile[] {
  const groups = new Map<string, { kind: SyncStore; records: { key: string; record: object }[] }>()
  const add = (store: SyncStore, record: SyncRecord | PrefRecord) => {
    const key = recordKey(store, record)
    if (key === null) return
    const path = store === 'prefs' ? 'prefs.json' : pathOf(store, record as SyncRecord)
    const group = groups.get(path) ?? { kind: store, records: [] }
    group.records.push({ key, record })
    groups.set(path, group)
  }
  for (const store of ['games', 'hands', 'charts'] as const) {
    for (const record of data[store]) {
      if (record.demo === true || expiredMark(record, at)) continue
      add(store, record)
    }
  }
  if (data.settings) add('settings', data.settings)
  for (const pref of data.prefs) add('prefs', pref)

  const files: RepoFile[] = []
  // Чарты и ключи браузера — файлом всегда, даже пустым: так видно, что их нет, а не что файл потерялся
  for (const [path, kind] of [['charts.json', 'charts'], ['prefs.json', 'prefs']] as const) {
    if (!groups.has(path)) groups.set(path, { kind, records: [] })
  }
  for (const [path, group] of groups) {
    const sorted = [...group.records].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    files.push({ path, content: fileText(group.kind, sorted.map((r) => r.record)) })
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1))
}

// Файл с сервера → записи. Чужой, битый или новее нашего формата — ошибка: проход обрывается до записи
export function parseFile(path: string, text: string): { store: SyncStore; records: SyncRecord[] } {
  const store = storeOf(path)
  if (store === null) throw new Error(`Файл ${path} — не «Фишек»`)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Файл ${path} в репозитории данных испорчен: не JSON. Поправили руками?`)
  }
  const file = parsed as { app?: unknown; kind?: unknown; format?: unknown; records?: unknown }
  if (!file || typeof file !== 'object' || file.app !== APP || file.kind !== store || !Array.isArray(file.records)) {
    throw new Error(`Файл ${path} в репозитории данных — не «Фишек» или испорчен`)
  }
  if (typeof file.format !== 'number' || file.format > SYNC_FORMAT) {
    throw new Error(
      `Файл ${path} записан более новой версией «Фишек». Обнови приложение на этом устройстве, иначе синхронизация затрёт то, чего не понимает.`,
    )
  }
  // Запись без ключа или без времени правки — мимо: слить её не по чему
  const records = file.records.filter(
    (r): r is SyncRecord =>
      typeof r === 'object' && r !== null && typeof (r as SyncRecord).updatedAt === 'string' && recordKey(store, r as SyncRecord) !== null,
  )
  return { store, records }
}

export function readmeFile(): RepoFile {
  return {
    path: README_PATH,
    content: [
      '# Данные «Фишек»',
      '',
      'Приватный репозиторий данных приложения «Фишки»: игры учёта, раздачи прошлых вечеров, свои чарты,',
      'настройки и заметки. Приложение само отправляет сюда правки и забирает их на другие устройства.',
      '',
      'Руками файлы не правьте: правка может потеряться при следующей синхронизации или помешать ей.',
      'Репозиторий должен оставаться приватным — здесь всё, что записано в приложении.',
      '',
    ].join('\n'),
  }
}
