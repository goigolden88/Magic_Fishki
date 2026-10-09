// Модель данных — по docs/02-Архитектура.md

export type EntryKind = 'buyin' | 'rebuy' | 'cashout'

export type Player = { id: string; name: string }

export type Entry = {
  id: string
  playerId: string
  kind: EntryKind
  chips: number // целое, > 0
  at: string // ISO 8601, ставится само
}

export type Game = {
  id: string // ULID
  name: string // по умолчанию — дата
  date: string // YYYY-MM-DD, день игры
  rate: number // рублей за фишку: 0.5 — фишка по 50 копеек
  players: Player[]
  entries: Entry[]
  closed?: boolean // игра закрыта: записи не правятся без «Открыть снова»
  demo?: boolean // демо-данные — удаляются одной кнопкой
  updatedAt: string // ISO 8601
}

export type Settings = {
  defaultRate: number // курс новой игры
  players: string[] // постоянные игроки: при новой игре отмечены (Р-07)
  quickAmounts: number[] // быстрые суммы фишек у «Закуп», «Докуп», «Выход» (Р-07)
}

export const DEFAULT_RATE = 0.5
export const DEFAULT_QUICK_AMOUNTS = [500, 1000, 2000]

// Запись settings прежних версий может не иметь новых полей — нет поля, значит умолчание
export function settingsWithDefaults(stored?: Partial<Settings>): Settings {
  return {
    defaultRate: typeof stored?.defaultRate === 'number' ? stored.defaultRate : DEFAULT_RATE,
    players: Array.isArray(stored?.players) ? [...stored.players] : [],
    quickAmounts: Array.isArray(stored?.quickAmounts) ? [...stored.quickAmounts] : [...DEFAULT_QUICK_AMOUNTS],
  }
}

// Список из настроек → участники новой игры: у каждого свой id, имя — копией,
// так что правка постоянных игроков прошлые игры не трогает
export function playersFromNames(names: string[], makeId: () => string): Player[] {
  return names.map((name) => ({ id: makeId(), name }))
}

// Сдвиг элемента на шаг вверх (−1) или вниз (+1); за край — список как был
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}
