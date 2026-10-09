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

export type Settings = { defaultRate: number } // курс новой игры

export const DEFAULT_RATE = 0.5
