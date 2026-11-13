import {
  GAME_MODES,
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
import type { SavedHand } from './evenings'
import { parseLabels, parseNotes, type NoteLabels, type PlayerNotes } from './playerNotes'
import { MY_LOOK_DEFAULT, parseMyLook, type MyLook } from './pokerLook'
import { parseQuickBets, type QuickBets } from './quickBets'
import { parseQuickRoom, type QuickRoom } from './quickRoom'
import { parseDockSize, parseTableSize, type DockSize } from './tableFit'

// Файл-копия (Р-11): все игры без демо и настройки, с пометкой приложения и версии формата.
// Формат 2 (Р-12): постоянные игроки — { id, name }, у участников — regularId; формат 1 — игроки строками.
// Формат 3 (Р-54): ещё раздачи прошлых вечеров покера — записи хранилища hands как есть; у 1 и 2 раздач нет.
// Формат 4 (Р-56): ещё заметки об игроках и переименованные подписи цветов; у 1–3 их нет.
// Формат 5 (Р-61): ещё личный «Вид стола» — сукно, рубашка, колода; у 1–4 его нет — «Как у стола».
// Формат 6 (Р-62): ещё покер-рум телефона — своя «Быстрая комната», показ в ББ, быстрые ставки; у 1–5 их нет — не заданы.
// С Р-63 в нём же — размер стола и панели ставок на широком окне; формат прежний: поля необязательные.
// С #192 колода вида может быть null — не выбрана (четыре цвета); старое приложение читает её как «две масти»
export const BACKUP_APP = 'magic_fishki'
export const BACKUP_FORMAT = 6

export type Backup = {
  app: typeof BACKUP_APP
  format: typeof BACKUP_FORMAT
  savedAt: string // ISO 8601
  games: Game[]
  settings: Settings
  hands: SavedHand[]
  notes: PlayerNotes
  noteLabels: NoteLabels
  look: MyLook
  poker: PokerPrefs
}

// Покер-рум телефона (Р-62): null — не задано, начальные значения.
// Размер стола и панели ставок на широком окне (Р-63) — tableSize и dockSize, в том же формате 6:
// у копий без них — не заданы, а старое приложение их просто не читает
export type PokerPrefs = {
  quickRoom: QuickRoom | null
  bigBlinds: boolean | null
  quickBets: QuickBets | null
  tableSize: number | null
  dockSize: DockSize | null
}

export const POKER_PREFS_NONE: PokerPrefs = { quickRoom: null, bigBlinds: null, quickBets: null, tableSize: null, dockSize: null }

// Значение не читается — не задано: копия из-за него не отвергается (как вид стола)
export function parsePokerPrefs(raw: unknown): PokerPrefs {
  if (!isObject(raw)) return POKER_PREFS_NONE
  return {
    quickRoom: parseQuickRoom(raw.quickRoom),
    bigBlinds: typeof raw.bigBlinds === 'boolean' ? raw.bigBlinds : null,
    quickBets: parseQuickBets(raw.quickBets),
    tableSize: parseTableSize(raw.tableSize),
    dockSize: parseDockSize(raw.dockSize),
  }
}

// Восстановление: из копии — то, что здесь не задано; своё не перезаписывается
export function mergePokerPrefs(local: PokerPrefs, backup: PokerPrefs): PokerPrefs {
  return {
    quickRoom: local.quickRoom ?? backup.quickRoom,
    bigBlinds: local.bigBlinds ?? backup.bigBlinds,
    quickBets: local.quickBets ?? backup.quickBets,
    tableSize: local.tableSize ?? backup.tableSize,
    dockSize: local.dockSize ?? backup.dockSize,
  }
}

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; error: string }

export type RestorePlan = {
  added: Game[] // игр нет по id — записать как есть
  existing: number // игры с тем же id уже есть — не трогаются
  players: Regular[] // постоянные игроки после восстановления
  hands: SavedHand[] // раздач нет по «вечер + номер» — записать как есть; записанные не трогаются
}

// Демо-игры в копию не идут (Р-04)
export function makeBackup(
  games: Game[],
  settings: Settings,
  now: string,
  hands: SavedHand[] = [],
  notes: PlayerNotes = {},
  noteLabels: NoteLabels = {},
  look: MyLook = MY_LOOK_DEFAULT,
  poker: PokerPrefs = POKER_PREFS_NONE,
): Backup {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    savedAt: now,
    games: games.filter((g) => !g.demo),
    settings,
    hands,
    notes,
    noteLabels,
    look,
    poker,
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
    (v.mode === undefined || (isText(v.mode) && (GAME_MODES as string[]).includes(v.mode))) &&
    (v.closed === undefined || typeof v.closed === 'boolean') &&
    (v.demo === undefined || typeof v.demo === 'boolean') &&
    isText(v.updatedAt)
  )
}

// Запись раздачи из копии: ключ «вечер + номер» и сама раздача с тем же номером; что внутри
// раздачи — как пришло за столом, экран и выгрузка читают её как есть
function isSavedHand(v: unknown): v is SavedHand {
  return (
    isObject(v) &&
    isText(v.evening) &&
    v.evening !== '' &&
    (v.code === null || isText(v.code)) &&
    typeof v.startedAt === 'number' &&
    Number.isFinite(v.startedAt) &&
    Number.isSafeInteger(v.number) &&
    isObject(v.hand) &&
    v.hand.number === v.number &&
    Array.isArray(v.hand.pots) &&
    isObject(v.hand.payouts) &&
    (v.table === undefined || isObject(v.table)) &&
    (v.mine === undefined || (Array.isArray(v.mine) && v.mine.every(isText)))
  )
}

// Текст файла → копия или понятная ошибка; .json и .txt разбираются одинаково.
// Копия формата 1 приводится к формату 2: постоянным — новые id, участникам — связь по точному имени (Р-12).
// У копий 1 и 2 раздач нет — пустой список (Р-54); у копий 1–3 заметок и подписей нет — пусто (Р-56);
// у копий 1–4 вида стола нет — «Как у стола» (Р-61)
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
  let hands: SavedHand[] = []
  if (data.format >= 3) {
    if (!Array.isArray(data.hands)) return { ok: false, error: 'Копия повреждена: нет списка раздач' }
    const badHand = data.hands.findIndex((h) => !isSavedHand(h))
    if (badHand >= 0) return { ok: false, error: `Копия повреждена: раздача № ${badHand + 1} не читается` }
    hands = data.hands as SavedHand[]
  }
  let notes: PlayerNotes = {}
  let noteLabels: NoteLabels = {}
  if (data.format >= 4) {
    const parsedNotes = parseNotes(data.notes)
    if (parsedNotes === null) return { ok: false, error: 'Копия повреждена: заметки об игроках не читаются' }
    const parsedLabels = parseLabels(data.noteLabels)
    if (parsedLabels === null) return { ok: false, error: 'Копия повреждена: подписи цветов заметок не читаются' }
    notes = parsedNotes
    noteLabels = parsedLabels
  }
  // Вид стола (Р-61): значение не из готовых — «Как у стола», копия из-за него не отвергается
  const look = data.format >= 5 ? parseMyLook(data.look) : MY_LOOK_DEFAULT
  // Покер-рум (Р-62): у копий 1–5 его нет — не задан
  const poker = data.format >= 6 ? parsePokerPrefs(data.poker) : POKER_PREFS_NONE
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
      hands,
      notes,
      noteLabels,
      look,
      poker,
    },
  }
}

// Восстановление ничего не перезаписывает: игры, которых нет по id, добавляются; с тем же id — как были.
// Постоянные игроки из копии: тот же id — уже есть, остаётся свой; то же имя — один человек, связи
// в добавленных играх переводятся на здешний id; иначе дописываются в конец со своим id.
// Прочие настройки не применяются. Раздачи (Р-54): те, что уже есть по «вечер + номер», не трогаются
export function planRestore(
  existingIds: Iterable<string>,
  regulars: Regular[],
  backup: Backup,
  existingHands: Iterable<[string, number]> = [],
): RestorePlan {
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
  const handKey = (evening: string, number: number) => JSON.stringify([evening, number])
  const known = new Set([...existingHands].map(([e, n]) => handKey(e, n)))
  const hands: SavedHand[] = []
  for (const h of backup.hands) {
    const key = handKey(h.evening, h.number)
    if (known.has(key)) continue
    known.add(key)
    hands.push(h)
  }
  return { added, existing, players, hands }
}
