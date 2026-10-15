import { settingsWithDefaults, type Entry, type Game, type Player, type Settings } from '../model'

// Файл-копия (Р-11): все игры без демо и настройки, с пометкой приложения и версии формата
export const BACKUP_APP = 'magic_fishki'
export const BACKUP_FORMAT = 1

export type Backup = {
  app: typeof BACKUP_APP
  format: typeof BACKUP_FORMAT
  savedAt: string // ISO 8601
  games: Game[]
  settings: Settings
}

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; error: string }

export type RestorePlan = {
  added: Game[] // игр нет по id — записать как есть
  existing: number // игры с тем же id уже есть — не трогаются
  players: string[] // постоянные игроки после восстановления
}

// Демо-игры в копию не идут (Р-04)
export function makeBackup(games: Game[], settings: Settings, now: string): Backup {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    savedAt: now,
    games: games.filter((g) => !g.demo),
    settings,
  }
}

// 2026-10-14 → fishki-2026-10-14.json; для «Поделиться» — .txt (Chrome на Android не делится .json)
export function backupFileName(date: string, ext: 'json' | 'txt' = 'json'): string {
  return `fishki-${date}.${ext}`
}

export function backupText(backup: Backup): string {
  return JSON.stringify(backup, null, 2)
}

const ENTRY_KINDS = new Set(['buyin', 'rebuy', 'cashout'])

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isText(v: unknown): v is string {
  return typeof v === 'string'
}

function isPlayer(v: unknown): v is Player {
  return isObject(v) && isText(v.id) && v.id !== '' && isText(v.name)
}

function isEntry(v: unknown): v is Entry {
  return (
    isObject(v) &&
    isText(v.id) &&
    v.id !== '' &&
    isText(v.playerId) &&
    isText(v.kind) &&
    ENTRY_KINDS.has(v.kind) &&
    Number.isInteger(v.chips) &&
    (v.chips as number) > 0 &&
    isText(v.at)
  )
}

function isGame(v: unknown): v is Game {
  return (
    isObject(v) &&
    isText(v.id) &&
    v.id !== '' &&
    isText(v.name) &&
    isText(v.date) &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
    typeof v.rate === 'number' &&
    Number.isFinite(v.rate) &&
    v.rate > 0 &&
    Array.isArray(v.players) &&
    v.players.every(isPlayer) &&
    Array.isArray(v.entries) &&
    v.entries.every(isEntry) &&
    (v.closed === undefined || typeof v.closed === 'boolean') &&
    (v.demo === undefined || typeof v.demo === 'boolean') &&
    isText(v.updatedAt)
  )
}

// Текст файла → копия или понятная ошибка; .json и .txt разбираются одинаково
export function parseBackup(text: string): ParsedBackup {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return { ok: false, error: 'Файл не читается: это не копия «Фишек» или он повреждён' }
  }
  if (!isObject(data) || data.app !== BACKUP_APP) {
    return { ok: false, error: 'Это не копия «Фишек»' }
  }
  if (typeof data.format !== 'number' || !Number.isInteger(data.format) || data.format < 1) {
    return { ok: false, error: 'Копия повреждена: не указана версия' }
  }
  if (data.format > BACKUP_FORMAT) {
    return { ok: false, error: 'Копия из более новой версии «Фишек» — обновите приложение' }
  }
  if (!Array.isArray(data.games)) {
    return { ok: false, error: 'Копия повреждена: нет списка игр' }
  }
  const bad = data.games.findIndex((g) => !isGame(g))
  if (bad >= 0) {
    return { ok: false, error: `Копия повреждена: игра № ${bad + 1} не читается` }
  }
  const settings = data.settings
  if (!isObject(settings) || !Array.isArray(settings.players) || !settings.players.every(isText)) {
    return { ok: false, error: 'Копия повреждена: нет настроек' }
  }
  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      savedAt: isText(data.savedAt) ? data.savedAt : '',
      games: data.games as Game[],
      settings: settingsWithDefaults(settings as Partial<Settings>),
    },
  }
}

// Восстановление ничего не перезаписывает: игры, которых нет по id, добавляются; с тем же id — как были.
// Постоянные игроки из копии дописываются в конец без повторов по имени; прочие настройки не применяются.
export function planRestore(existingIds: Iterable<string>, players: string[], backup: Backup): RestorePlan {
  const seen = new Set(existingIds)
  const added: Game[] = []
  let existing = 0
  for (const game of backup.games) {
    if (seen.has(game.id)) {
      existing++
      continue
    }
    seen.add(game.id)
    added.push(game)
  }
  const names = [...players]
  for (const raw of backup.settings.players) {
    const name = raw.trim()
    if (name !== '' && !names.includes(name)) names.push(name)
  }
  return { added, existing, players: names }
}
