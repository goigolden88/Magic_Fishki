import {
  linkRegulars,
  regularsFromNames,
  settingsWithDefaults,
  type CasinoAmount,
  type CasinoRound,
  type Entry,
  type Game,
  type Player,
  type Regular,
  type Settings,
} from '../model'

// Файл-копия (Р-11): все игры без демо и настройки, с пометкой приложения и версии формата.
// Формат 2 (Р-12): постоянные игроки — { id, name }, у участников — regularId; формат 1 — игроки строками
export const BACKUP_APP = 'magic_fishki'
export const BACKUP_FORMAT = 2

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
  players: Regular[] // постоянные игроки после восстановления
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

// Последняя отданная копия на этом устройстве: момент (ISO) и день по часам телефона (YYYY-MM-DD)
export type LastBackup = { at: string; date: string }

// После числа: «1 день», «3 дня», «5 дней», «21 день»
function daysWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней'
}

// Дней между двумя днями YYYY-MM-DD, по календарю
function daysBetween(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return Date.UTC(y, m - 1, day)
  }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}

// Игры после копии — заведённые или изменённые позже неё, без демо (в копию они не идут)
export function gamesSinceBackup(games: Game[], last: LastBackup): number {
  return games.filter((g) => !g.demo && g.updatedAt > last.at).length
}

// «Последняя копия — 12 дней назад · игр после неё: 3»; копии не было — «ещё не делали»
export function lastBackupText(last: LastBackup | null, games: Game[], today: string): string {
  if (last === null) return 'Копию на этом устройстве ещё не делали'
  const days = Math.max(0, daysBetween(last.date, today))
  const when = days === 0 ? 'сегодня' : days === 1 ? 'вчера' : `${days} ${daysWord(days)} назад`
  return `Последняя копия — ${when} · игр после неё: ${gamesSinceBackup(games, last)}`
}

const ENTRY_KINDS = new Set(['buyin', 'rebuy', 'cashout'])

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isText(v: unknown): v is string {
  return typeof v === 'string'
}

function isRegular(v: unknown): v is Regular {
  return isObject(v) && isText(v.id) && v.id !== '' && isText(v.name)
}

function isPlayer(v: unknown): v is Player {
  return isObject(v) && (v.regularId === undefined || (isText(v.regularId) && v.regularId !== '')) && isRegular(v)
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

function isCasinoAmount(v: unknown): v is CasinoAmount {
  return isObject(v) && isText(v.playerId) && Number.isSafeInteger(v.kopecks) && v.kopecks !== 0
}

// Раунд казино (Р-13): доли — целые копейки, в сумме ноль
function isCasinoRound(v: unknown): v is CasinoRound {
  return (
    isObject(v) &&
    isText(v.id) &&
    v.id !== '' &&
    isText(v.at) &&
    Array.isArray(v.amounts) &&
    v.amounts.every(isCasinoAmount) &&
    v.amounts.reduce((s: number, a: CasinoAmount) => s + a.kopecks, 0) === 0
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
    (v.casino === undefined || (Array.isArray(v.casino) && v.casino.every(isCasinoRound))) &&
    (v.closed === undefined || typeof v.closed === 'boolean') &&
    (v.demo === undefined || typeof v.demo === 'boolean') &&
    isText(v.updatedAt)
  )
}

// Текст файла → копия или понятная ошибка; .json и .txt разбираются одинаково.
// Копия формата 1 приводится к формату 2: постоянным — новые id, участникам — связь по точному имени (Р-12)
export function parseBackup(text: string, makeId: () => string): ParsedBackup {
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
  const oldFormat = data.format === 1
  if (
    !isObject(settings) ||
    !Array.isArray(settings.players) ||
    !settings.players.every(oldFormat ? isText : isRegular)
  ) {
    return { ok: false, error: 'Копия повреждена: нет настроек' }
  }
  let games = data.games as Game[]
  let players = settings.players as Regular[]
  if (oldFormat) {
    const names: string[] = []
    for (const raw of settings.players as string[]) {
      const name = raw.trim()
      if (name !== '' && !names.includes(name)) names.push(name)
    }
    players = regularsFromNames(names, makeId)
    games = games.map((g) => ({ ...g, players: linkRegulars(g.players, players) }))
  }
  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      savedAt: isText(data.savedAt) ? data.savedAt : '',
      games,
      settings: settingsWithDefaults({ ...settings, players } as Partial<Settings>),
    },
  }
}

// Восстановление ничего не перезаписывает: игры, которых нет по id, добавляются; с тем же id — как были.
// Постоянные игроки из копии: тот же id — уже есть, остаётся свой; то же имя — один человек, связи
// в добавленных играх переводятся на здешний id; иначе дописываются в конец со своим id.
// Прочие настройки не применяются.
export function planRestore(existingIds: Iterable<string>, regulars: Regular[], backup: Backup): RestorePlan {
  const players = [...regulars]
  const ids = new Set(players.map((r) => r.id))
  const sameAs = new Map<string, string>() // id постоянного в копии → id постоянного здесь с тем же именем
  for (const r of backup.settings.players) {
    const name = r.name.trim()
    if (name === '' || ids.has(r.id)) continue
    const same = players.find((p) => p.name === name)
    if (same) {
      sameAs.set(r.id, same.id)
    } else {
      players.push({ id: r.id, name })
      ids.add(r.id)
    }
  }
  const relink = (game: Game): Game =>
    sameAs.size === 0
      ? game
      : {
          ...game,
          players: game.players.map((p) => {
            const id = p.regularId === undefined ? undefined : sameAs.get(p.regularId)
            return id === undefined ? p : { ...p, regularId: id }
          }),
        }

  const seen = new Set(existingIds)
  const added: Game[] = []
  let existing = 0
  for (const game of backup.games) {
    if (seen.has(game.id)) {
      existing++
      continue
    }
    seen.add(game.id)
    added.push(relink(game))
  }
  return { added, existing, players }
}
