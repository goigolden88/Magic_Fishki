import { parseBotTable, type BotTable } from '../calc/botTable'
import { parseLocalTable, type LocalTable } from '../calc/localTable'
import { serverBase, type SavedSeat } from '../calc/pokerLink'
import { parseLabels, parseNotes, type NoteLabels, type PlayerNotes } from '../calc/playerNotes'
import { isDefaultLook, MY_LOOK_DEFAULT, parseMyLook, type MyLook } from '../calc/pokerLook'
import { parseQuickBets, QUICK_BETS_DEFAULT, type QuickBets } from '../calc/quickBets'
import { parseQuickRoom, type QuickRoom } from '../calc/quickRoom'
import { parseDockSize, parseTableSize, tableFitVars, type DockSize } from '../calc/tableFit'
import type { CSSProperties } from 'react'

// Покер онлайн: пароль компании, свой адрес сервера, места в комнатах, «кто я» ведущего, записанные итоги,
// звук «ваш ход», «карты всегда открыты», «анимация карт», стол на этом телефоне и стол против ботов — данные этого устройства,
// а не игр: в localStorage, не в IndexedDB и не в копию (Р-19, Р-21, Р-38).
// Заметки об игроках и подписи их цветов (Р-56), личный «Вид стола» (Р-61), своя «Быстрая комната», показ в ББ
// и быстрые ставки (Р-62), размер стола и панели ставок (Р-63) — тоже в localStorage, но в копию идут
const PASSWORD_KEY = 'fishki.poker.password'
const SERVER_KEY = 'fishki.poker.server'
const SEATS_KEY = 'fishki.poker.seats'
const ME_KEY = 'fishki.poker.me'
const GAMES_KEY = 'fishki.poker.games'
const LOCAL_KEY = 'fishki.poker.local'
const BOTS_KEY = 'fishki.poker.bots'
const CHECK_KEY = 'fishki.poker.check'
const SOUND_KEY = 'fishki.poker.sound'
const OPEN_KEY = 'fishki.poker.open'
const ANIM_KEY = 'fishki.poker.anim'
const NOTES_KEY = 'fishki.poker.notes'
const LABELS_KEY = 'fishki.poker.noteLabels'
const LOOK_KEY = 'fishki.poker.look'
const QUICK_ROOM_KEY = 'fishki.poker.quickRoom'
const BB_KEY = 'fishki.poker.bigBlinds'
const BETS_KEY = 'fishki.poker.quickBets'
const TABLE_SIZE_KEY = 'fishki.poker.tableSize'
const DOCK_SIZE_KEY = 'fishki.poker.dockSize'

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
    // нет места или запрещено — просто не запомним
  }
}

export const loadPassword = () => read(PASSWORD_KEY)
export const savePassword = (password: string) => write(PASSWORD_KEY, password)

// Свой адрес сервера; пусто — постоянный
export const loadServer = () => read(SERVER_KEY)
export const saveServer = (server: string) => write(SERVER_KEY, server.trim())

// Звук «ваш ход» на этом устройстве (#75); сначала — включён
export const loadTurnSound = () => read(SOUND_KEY) !== 'off'
export const saveTurnSound = (on: boolean) => write(SOUND_KEY, on ? '' : 'off')

// «Карты всегда открыты» на этом устройстве (#86): свои карты лицом без пальца; сначала — выключено
export const loadOpenCards = () => read(OPEN_KEY) === 'on'
export const saveOpenCards = (on: boolean) => write(OPEN_KEY, on ? 'on' : '')

// «Анимация карт» на этом устройстве (#133): раздача прилетает к местам по одной — за столом покера и казино.
// Свой выбор человека главнее; не выбирал — включена, а при системном «Уменьшить движение» — выключена
export function loadCardAnim(): boolean {
  const own = read(ANIM_KEY)
  if (own === 'on') return true
  if (own === 'off') return false
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}
export const saveCardAnim = (on: boolean) => write(ANIM_KEY, on ? 'on' : 'off')

// Кто из постоянных — ведущий на этом телефоне: отмечен в новой комнате сразу
export const loadMe = () => read(ME_KEY)
export const saveMe = (regularId: string) => write(ME_KEY, regularId)

// Места по кодам комнат: с ним возврат на своё место без выбора. Сервер комнаты (#83) — необязательное поле:
// места, запомненные раньше, его не имеют и читаются как были
export function loadSeats(): Record<string, SavedSeat> {
  try {
    const parsed: unknown = JSON.parse(read(SEATS_KEY) || '{}')
    const out: Record<string, SavedSeat> = {}
    if (parsed && typeof parsed === 'object') {
      for (const [code, seat] of Object.entries(parsed as Record<string, unknown>)) {
        const { playerId, token, server } = (seat ?? {}) as Record<string, unknown>
        if (typeof playerId !== 'string' || typeof token !== 'string') continue
        const base = typeof server === 'string' && server.trim() ? serverBase(server) : null
        out[code] = base ? { playerId, token, server: base } : { playerId, token }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function loadSeat(code: string): SavedSeat | null {
  return loadSeats()[code] ?? null
}

export function saveSeat(code: string, seat: SavedSeat | null) {
  const seats = loadSeats()
  if (seat) seats[code] = seat
  else delete seats[code]
  write(SEATS_KEY, Object.keys(seats).length ? JSON.stringify(seats) : '')
}

// Итог какого стола уже записан игрой: «код/место» → id игры. Повторное «Закончить игру»
// второй игры не пишет. Место — потому что код освобождается и достаётся новой комнате
const GAMES_KEPT = 20

function loadGames(): [string, string][] {
  try {
    const parsed: unknown = JSON.parse(read(GAMES_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string')
      : []
  } catch {
    return []
  }
}

export function loadRecordedGame(code: string, playerId: string): string | null {
  return loadGames().find(([key]) => key === `${code}/${playerId}`)?.[1] ?? null
}

export function saveRecordedGame(code: string, playerId: string, gameId: string) {
  const key = `${code}/${playerId}`
  const games = [...loadGames().filter(([k]) => k !== key), [key, gameId] as [string, string]].slice(-GAMES_KEPT)
  write(GAMES_KEY, JSON.stringify(games))
}

// Стол на этом телефоне (Р-21): один на устройстве, весь стол целиком — после каждого изменения.
// Копия — и в памяти страницы: без памяти браузера (приватный режим) стол живёт до закрытия
let localTable: LocalTable | null | undefined // undefined — ещё не читали

export function loadLocalTable(): LocalTable | null {
  if (localTable === undefined) localTable = parseLocalTable(read(LOCAL_KEY))
  return localTable
}

// false — память браузера не приняла: после закрытия стол пропадёт
export function saveLocalTable(local: LocalTable): boolean {
  localTable = local
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local))
    return true
  } catch {
    return false
  }
}

export function clearLocalTable() {
  localTable = null
  write(LOCAL_KEY, '')
}

// Стол против ботов (#117, Р-38): свой ключ — со «Столом на этом телефоне» не мешают друг другу.
// Так же: весь стол после каждого хода, копия — в памяти страницы
let botTable: BotTable | null | undefined // undefined — ещё не читали

export function loadBotTable(): BotTable | null {
  if (botTable === undefined) botTable = parseBotTable(read(BOTS_KEY))
  return botTable
}

// false — память браузера не приняла: после закрытия стол пропадёт
export function saveBotTable(bots: BotTable): boolean {
  botTable = bots
  try {
    localStorage.setItem(BOTS_KEY, JSON.stringify(bots))
    return true
  } catch {
    return false
  }
}

export function clearBotTable() {
  botTable = null
  write(BOTS_KEY, '')
}

// Заметки об игроках и подписи цветов (Р-56): копия — в памяти страницы, экраны подписаны на перемены —
// заметка, поправленная за столом, сразу видна у всех мест с этим именем
export type NotesState = { notes: PlayerNotes; labels: NoteLabels }

let notesState: NotesState | undefined // undefined — ещё не читали
const notesListeners = new Set<() => void>()

function parseStored<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  try {
    return parse(JSON.parse(read(key) || '{}'))
  } catch {
    return null
  }
}

export function loadNotes(): NotesState {
  notesState ??= {
    notes: parseStored(NOTES_KEY, parseNotes) ?? {},
    labels: parseStored(LABELS_KEY, parseLabels) ?? {},
  }
  return notesState
}

export function saveNotes(next: NotesState) {
  notesState = next
  write(NOTES_KEY, Object.keys(next.notes).length ? JSON.stringify(next.notes) : '')
  write(LABELS_KEY, Object.keys(next.labels).length ? JSON.stringify(next.labels) : '')
  for (const listener of notesListeners) listener()
}

export function subscribeNotes(listener: () => void): () => void {
  notesListeners.add(listener)
  return () => notesListeners.delete(listener)
}

// Личный «Вид стола» (Р-61): сукно, рубашка, колода — на этом телефоне, в копию идёт.
// Копия — в памяти страницы: каждая карта на экране спрашивает колоду, память браузера читается раз
let myLook: MyLook | undefined // undefined — ещё не читали

export function loadMyLook(): MyLook {
  myLook ??= parseStored(LOOK_KEY, parseMyLook) ?? MY_LOOK_DEFAULT
  return myLook
}

export function saveMyLook(next: MyLook) {
  myLook = next
  write(LOOK_KEY, isDefaultLook(next) ? '' : JSON.stringify(next))
}

// Покер-рум на этом телефоне (Р-62): своя «Быстрая комната», суммы за столом в больших блайндах, свои быстрые ставки.
// В копию идут. null — не задано здесь: начальные значения, а восстановление из копии может их дописать
export function loadQuickRoom(): QuickRoom | null {
  return parseStored(QUICK_ROOM_KEY, parseQuickRoom)
}

export function saveQuickRoom(room: QuickRoom | null) {
  write(QUICK_ROOM_KEY, room ? JSON.stringify(room) : '')
}

// «Стеки и ставки в больших блайндах»: только показ за столом. Копия в памяти страницы — спрашивает каждое место.
// Одна настройка на галочку в «Настройках» и касание своего места за столом (Р-64): подписчики узнают о смене
let bigBlinds: boolean | null | undefined // undefined — ещё не читали
const bigBlindsListeners = new Set<() => void>()

export function loadBigBlindsChoice(): boolean | null {
  if (bigBlinds === undefined) {
    const raw = read(BB_KEY)
    bigBlinds = raw === 'on' ? true : raw === 'off' ? false : null
  }
  return bigBlinds
}

export const loadBigBlinds = () => loadBigBlindsChoice() === true

export function saveBigBlinds(on: boolean) {
  bigBlinds = on
  write(BB_KEY, on ? 'on' : 'off')
  for (const listener of bigBlindsListeners) listener()
}

export function subscribeBigBlinds(listener: () => void): () => void {
  bigBlindsListeners.add(listener)
  return () => bigBlindsListeners.delete(listener)
}

// Свои быстрые ставки: копия в памяти страницы — стол спрашивает их при каждой перемене
let quickBets: QuickBets | null | undefined // undefined — ещё не читали

export function loadQuickBetsChoice(): QuickBets | null {
  if (quickBets === undefined) quickBets = parseStored(BETS_KEY, parseQuickBets)
  return quickBets
}

export const loadQuickBets = (): QuickBets => loadQuickBetsChoice() ?? QUICK_BETS_DEFAULT

// null — «Сбросить»: снова начальные
export function saveQuickBets(bets: QuickBets | null) {
  quickBets = bets
  write(BETS_KEY, bets ? JSON.stringify(bets) : '')
}

// Размер стола и панели ставок на широком окне (Р-63): свой выбор этого устройства, в копию идёт.
// null — не задано: стол во всё место, панель «Средняя». Копия в памяти страницы — стол спрашивает при каждой перемене
let tableSize: number | null | undefined // undefined — ещё не читали
let dockSize: DockSize | null | undefined

export function loadTableSizeChoice(): number | null {
  if (tableSize === undefined) {
    const raw = read(TABLE_SIZE_KEY)
    tableSize = raw ? parseTableSize(Number(raw)) : null
  }
  return tableSize
}

export function saveTableSize(size: number | null) {
  tableSize = size
  write(TABLE_SIZE_KEY, size === null ? '' : String(size))
}

export function loadDockSizeChoice(): DockSize | null {
  if (dockSize === undefined) dockSize = parseDockSize(read(DOCK_SIZE_KEY))
  return dockSize
}

export function saveDockSize(size: DockSize | null) {
  dockSize = size
  write(DOCK_SIZE_KEY, size ?? '')
}

// Переменные CSS обёртки стола: размер стола и панели (действуют только на широком окне — styles.css)
export const tableFitStyle = (): CSSProperties => tableFitVars(loadTableSizeChoice(), loadDockSizeChoice()) as CSSProperties

// Память браузера работает: записать и прочитать
export function storageWorks(): boolean {
  try {
    localStorage.setItem(CHECK_KEY, '1')
    const back = localStorage.getItem(CHECK_KEY)
    localStorage.removeItem(CHECK_KEY)
    return back === '1'
  } catch {
    return false
  }
}
