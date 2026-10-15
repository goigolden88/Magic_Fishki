// Модель данных — по docs/02-Архитектура.md

export type EntryKind = 'buyin' | 'rebuy' | 'cashout'

// Участник игры; имя — копия, правка постоянных его не трогает (Р-07).
// regularId — id постоянного игрока, если это он (Р-12); нет — гость
export type Player = { id: string; name: string; regularId?: string }

// Постоянный игрок — один человек во всех играх: id не меняется при переименовании (Р-12)
export type Regular = { id: string; name: string }

export type Entry = {
  id: string
  playerId: string
  kind: EntryKind
  chips: number // целое, > 0
  at: string // ISO 8601, ставится само
}

// Доля участника в раунде казино: плюс — выиграл, минус — проиграл
export type CasinoAmount = { playerId: string; kopecks: number } // целое, не 0

// Раунд казино (Р-13): сумма долей — ноль
export type CasinoRound = {
  id: string
  amounts: CasinoAmount[]
  at: string // ISO 8601, ставится само
}

export type Game = {
  id: string // ULID
  name: string // по умолчанию — дата
  date: string // YYYY-MM-DD, день игры
  rate: number // рублей за фишку: 0.5 — фишка по 50 копеек
  players: Player[]
  entries: Entry[]
  casino?: CasinoRound[] // раунды казино (Р-13); нет — казино не было
  closed?: boolean // игра закрыта: записи не правятся без «Открыть снова»
  demo?: boolean // демо-данные — удаляются одной кнопкой
  updatedAt: string // ISO 8601
}

export type Settings = {
  defaultRate: number // курс новой игры
  players: Regular[] // постоянные игроки: при новой игре отмечены (Р-07, Р-12)
  quickAmounts: number[] // быстрые суммы фишек у «Закуп», «Докуп», «Выход» (Р-07)
  defaultBuyin: number // закуп по умолчанию: при новой игре — вопрос «Записать всем закуп по N?» (Р-09)
}

export const DEFAULT_RATE = 0.5
export const DEFAULT_QUICK_AMOUNTS = [500, 1000, 2000]
export const DEFAULT_BUYIN = 1000

// Запись settings прежних версий может не иметь новых полей — нет поля, значит умолчание
export function settingsWithDefaults(stored?: Partial<Settings>): Settings {
  return {
    defaultRate: typeof stored?.defaultRate === 'number' ? stored.defaultRate : DEFAULT_RATE,
    players: Array.isArray(stored?.players) ? stored.players.map((r) => ({ ...r })) : [],
    quickAmounts: Array.isArray(stored?.quickAmounts) ? [...stored.quickAmounts] : [...DEFAULT_QUICK_AMOUNTS],
    defaultBuyin: typeof stored?.defaultBuyin === 'number' ? stored.defaultBuyin : DEFAULT_BUYIN,
  }
}

// Постоянные игроки прежних версий — строки (база версии 1, копия формата 1): каждому — новый id, порядок тот же
export function regularsFromNames(names: string[], makeId: () => string): Regular[] {
  return names.map((name) => ({ id: makeId(), name }))
}

// Связь с постоянным игроком — по точному совпадению имени (Р-12). У кого связь уже есть
// или имени нет среди постоянных (гость) — как был; остальные поля участника не меняются
export function linkRegulars(players: Player[], regulars: Regular[]): Player[] {
  const byName = new Map<string, string>()
  for (const r of regulars) if (!byName.has(r.name)) byName.set(r.name, r.id)
  return players.map((p) => {
    const regularId = p.regularId === undefined ? byName.get(p.name) : undefined
    return regularId === undefined ? p : { ...p, regularId }
  })
}

// Участник, добавленный в игру по имени: имя постоянного — связь с ним, иначе гость
export function playerByName(name: string, regulars: Regular[], id: string): Player {
  return linkRegulars([{ id, name }], regulars)[0]
}

// Отмеченные постоянные → участники новой игры: у каждого свой id, имя — копией,
// так что правка постоянных игроков прошлые игры не трогает; связь — по id постоянного
export function playersFromRegulars(regulars: Regular[], makeId: () => string): Player[] {
  return regulars.map((r) => ({ id: makeId(), name: r.name, regularId: r.id }))
}

export type NewGame = {
  name: string
  date: string // YYYY-MM-DD
  rate: number
  players: Regular[] // отмеченные постоянные игроки
  buyin: number | null // «Да» на «Записать всем закуп?» — сумма; «Нет» — null (Р-09)
  now: string // ISO 8601: время закупов и updatedAt
}

// Новая игра; с закупом — каждому участнику одна запись buyin на эту сумму
export function createGame(input: NewGame, makeId: () => string): Game {
  const id = makeId()
  const players = playersFromRegulars(input.players, makeId)
  const { buyin } = input
  const entries: Entry[] =
    buyin === null ? [] : players.map((p) => ({ id: makeId(), playerId: p.id, kind: 'buyin', chips: buyin, at: input.now }))
  return {
    id,
    name: input.name,
    date: input.date,
    rate: input.rate,
    players,
    entries,
    updatedAt: input.now,
  }
}

// Сдвиг элемента на шаг вверх (−1) или вниз (+1); за край — список как был
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}
