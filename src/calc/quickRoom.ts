// Новая комната (#127): настройки стола из выбора ведущего — одни у формы «Новая комната» и у «Быстрой комнаты».
// Быстрая — начальные значения формы и стек из закупа по умолчанию «Настроек»
import type { Regular } from '../model'
import type { CardsMode, GameId, Limit } from '../poker/game'
import { isMixShare, type MixShare } from '../poker/mix'
import { isOwnGameId, OWN_GAMES_MAX, seatsFor, type OwnGame, type TableGameId } from '../poker/ownGame'
import { isMaxRuns, type MaxRuns } from '../poker/runs'
import {
  CARD_BACKS,
  DEFAULT_SETTINGS,
  FELTS,
  MUCK_MODES,
  TIME_BANK_PRESETS,
  TURN_MAX_S,
  TURN_MIN_S,
  type AutoStart,
  type MuckMode,
  type Settings,
} from '../poker/table'
import { tournamentError, type TournamentSettings } from '../poker/tournament'
import { formatNumber } from './format'
import { lookOf, type Look } from './pokerLook'
import { AUTO_START_LABELS } from './pokerTimer'
import { formSettings, tournamentForm, type FormatSettings } from './tournamentForm'

// «Покер» — игра и лимит стола (#80): холдем и шорт-дек (#81) — без лимита; у омахи — пот-лимит (по умолчанию) или без лимита.
// Своя игра (#224) — её id, лимит — из её описания
export type GameChoice = { game: TableGameId; limit: Limit }

export const GAME_CHOICES: [GameId, string][] = [
  ['holdem', 'Холдем'],
  ['omaha', 'Омаха'],
  ['shortdeck', 'Шорт-дек'],
]

export const DEFAULT_GAME: GameChoice = { game: 'holdem', limit: 'pot' }

// В настройки стола: лимит — только у омахи
export function gameSettings(c: GameChoice): Pick<Settings, 'game' | 'limit'> {
  return c.game === 'omaha' ? { game: c.game, limit: c.limit } : { game: c.game }
}

// Выбор ведущего в форме — уже разобранный
export type RoomChoice = {
  sb: number
  bb: number
  startingStack: number
  cards: CardsMode
  variant: GameChoice
  turnSeconds: number | null
  // Запас времени (#223), секунд; нет или null — выкл. Только со временем на ход: без него не уходит
  timeBank?: number | null
  autoStart: AutoStart
  look: Look
  format: FormatSettings // кэш — с анте и страддлом (#222), турнир — со структурой
  publicHud: boolean
  // «Ход раздачи по касанию банка» (#258): false — выкл; нет поля — вкл
  liveHand?: boolean
  // «Микс» (#166): доля «против», при которой смена игры ещё проходит; нет или null — выкл.
  // Только с картами на телефонах: при живых не уходит
  mix?: MixShare | null
  // «Прогнать несколько раз» (#167, Р-58): до скольких раз; нет или 1 — нет. Только с картами на телефонах
  maxRuns?: MaxRuns
  // Вскрытие (#279): 'auto' — «Мак сам»; нет поля — все открывают. Только с картами на телефонах
  muck?: MuckMode
}

// «Вскрытие: Все открывают · Мак сам» (#279) — выбор ведущего; сначала — все открывают. «Мак по выбору» встанет рядом
export const MUCK_CHOICES: [MuckMode | null, string][] = [
  [null, 'Все открывают'],
  ['auto', 'Мак сам'],
]

// «Прогнать несколько раз: нет / до двух / до трёх» — выбор ведущего; сначала — нет
export const MAX_RUNS_CHOICES: [MaxRuns, string][] = [
  [1, 'Нет'],
  [2, 'До двух'],
  [3, 'До трёх'],
]

// В описании стола: «прогон до двух раз»; нет — null
export function runsText(s: Partial<Settings>): string | null {
  const max = s.cards === 'phones' ? (s.maxRuns ?? 1) : 1
  return max === 2 ? 'прогон до двух раз' : max === 3 ? 'прогон до трёх раз' : null
}

// «Сменить игру, если против не больше …» — выбор ведущего; сначала — половины
export const MIX_SHARE_CHOICES: [MixShare, string][] = [
  ['third', 'трети'],
  ['half', 'половины'],
  ['twothirds', 'двух третей'],
]

const cashForm = formSettings(tournamentForm(0))

// Начальные значения формы, кроме стека — он из «Настроек». Р-35: карты — на телефонах;
// DEFAULT_SETTINGS.cards остаётся живыми для столов без поля. HUD (#79) — каждый только свою
export const ROOM_DEFAULTS: Omit<RoomChoice, 'startingStack'> = {
  sb: DEFAULT_SETTINGS.sb,
  bb: DEFAULT_SETTINGS.bb,
  cards: 'phones',
  variant: DEFAULT_GAME,
  turnSeconds: DEFAULT_SETTINGS.turnSeconds ?? null,
  autoStart: DEFAULT_SETTINGS.autoStart ?? 'off',
  look: lookOf(DEFAULT_SETTINGS),
  format: cashForm.ok ? cashForm.settings : { format: 'cash', ante: 0 },
  publicHud: false,
}

// Игра «Покера» с оглядкой на свои игры (#224, #225): своя — только с картами на телефонах и пока она есть
// на телефоне (own); иначе — холдем
export function roomGameChoice(cards: CardsMode, variant: GameChoice, own: OwnGame[]): GameChoice {
  if (!isOwnGameId(variant.game)) return variant
  return cards === 'phones' && own.some((g) => g.id === variant.game) ? variant : DEFAULT_GAME
}

// Свои игры в комнату (#224, Р-85): только карты на телефонах; с «Миксом» — все свои (выбранная — первой), иначе —
// выбранная. Выбранной уже нет на телефоне (own) — ни одной
export function roomOwnGames(c: Pick<RoomChoice, 'cards' | 'variant' | 'mix'>, own: OwnGame[]): OwnGame[] {
  if (c.cards !== 'phones') return []
  const chosen = isOwnGameId(c.variant.game) ? own.find((g) => g.id === c.variant.game) : undefined
  const mixed = c.mix ? own.filter((g) => g !== chosen) : []
  return [...(chosen ? [chosen] : []), ...mixed].slice(0, OWN_GAMES_MAX)
}

// Мест за столом — меньшее из обычного и того, на сколько хватит карт каждой своей игры (seatsFor)
export function roomMaxSeats(games: OwnGame[]): number {
  return Math.min(DEFAULT_SETTINGS.maxSeats, ...games.map(seatsFor))
}

// Строка в форме комнаты (#225): «За столом не больше 6 — из-за „Омаха-7“»; мест обычное число — null
export function ownSeatsNote(games: OwnGame[]): string | null {
  const seats = roomMaxSeats(games)
  if (seats >= DEFAULT_SETTINGS.maxSeats) return null
  const tight = games.find((g) => seatsFor(g) === seats)
  return tight ? `За столом не больше ${seats} — из-за „${tight.name}“` : null
}

function ownSettings(c: RoomChoice, own: OwnGame[]): Partial<Settings> {
  const variant = roomGameChoice(c.cards, c.variant, own)
  const games = roomOwnGames(c, own)
  if (games.length === 0) return gameSettings(variant)
  return { ...gameSettings(variant), games, maxSeats: roomMaxSeats(games) }
}

// Настройки стола для запроса create; own — свои игры телефона (#224)
export function roomSettings(c: RoomChoice, own: OwnGame[] = []): Partial<Settings> {
  return {
    sb: c.sb,
    bb: c.bb,
    startingStack: c.startingStack,
    cards: c.cards,
    ...ownSettings(c, own),
    turnSeconds: c.turnSeconds,
    ...(c.timeBank && c.turnSeconds !== null ? { timeBank: c.timeBank } : {}),
    autoStart: c.autoStart,
    ...c.look,
    ...c.format,
    publicHud: c.publicHud,
    ...(c.liveHand === false ? { liveHand: false } : {}),
    ...(c.mix && c.cards === 'phones' ? { mix: true, mixAgainst: c.mix } : {}),
    ...(c.maxRuns && c.maxRuns > 1 && c.cards === 'phones' ? { maxRuns: c.maxRuns } : {}),
    ...(c.muck && c.cards === 'phones' ? { muck: c.muck } : {}),
  }
}

// Своя «Быстрая комната» (Р-62): выбор ведущего в «Настройках» — поля формы без игроков и пароля.
// startingStack null — закуп по умолчанию «Настроек». На телефоне ведущего и в копии; не задана — начальные значения
export type QuickRoom = Omit<RoomChoice, 'startingStack'> & { startingStack: number | null }

export const QUICK_ROOM_DEFAULT: QuickRoom = { ...ROOM_DEFAULTS, startingStack: null, mix: null, maxRuns: 1, timeBank: null }

// Выбор для запроса create: своя или начальная, стек — свой или закуп по умолчанию
export function quickRoomChoice(room: QuickRoom | null, defaultBuyin: number): RoomChoice {
  const r = room ?? QUICK_ROOM_DEFAULT
  return { ...r, startingStack: r.startingStack ?? defaultBuyin }
}

// «Быстрая комната»: своя из «Настроек» или начальные значения формы; стек — свой или закуп по умолчанию.
// own — свои игры телефона (#224): выбранной там нет — холдем
export function quickRoomSettings(defaultBuyin: number, room: QuickRoom | null = null, own: OwnGame[] = []): Partial<Settings> {
  return roomSettings(quickRoomChoice(room, defaultBuyin), own)
}

// Сохранить в «Настройках» нельзя: блайнды — как проверяет форма, стек — не меньше большого блайнда
export function quickRoomError(c: Pick<RoomChoice, 'sb' | 'bb' | 'startingStack'>): string | null {
  if (!isPositive(c.sb) || !isPositive(c.bb) || c.sb > c.bb) return 'Блайнды — целые числа больше нуля, малый не больше большого'
  if (!isPositive(c.startingStack)) return 'Стек — целое число фишек больше нуля'
  if (c.startingStack < c.bb) return 'Стек — не меньше большого блайнда'
  return null
}

function isPositive(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x > 0
}

// Из памяти телефона или копии; не похоже — null (тогда начальные значения). Игра — из тех, что знает
// приложение, или своя (#224): есть ли она ещё на телефоне — решает roomSettings; знает ли её сервер — скажет он сам
export function parseQuickRoom(raw: unknown): QuickRoom | null {
  if (!isRecord(raw)) return null
  const { sb, bb, startingStack, cards, variant, turnSeconds, timeBank, autoStart, look, format, publicHud, liveHand, mix, maxRuns, muck } = raw
  if (!isPositive(sb) || !isPositive(bb) || sb > bb) return null
  if (startingStack !== null && (!isPositive(startingStack) || startingStack < bb)) return null
  if (cards !== 'live' && cards !== 'phones') return null
  if (!isRecord(variant) || !(GAME_CHOICES.some(([id]) => id === variant.game) || isOwnGameId(variant.game))) return null
  if (variant.limit !== 'pot' && variant.limit !== 'nolimit') return null
  if (turnSeconds !== null && !(Number.isInteger(turnSeconds) && (turnSeconds as number) >= TURN_MIN_S && (turnSeconds as number) <= TURN_MAX_S)) {
    return null
  }
  // Запас (#223): у выбора до него поля нет — выкл
  if (timeBank !== undefined && timeBank !== null && !(TIME_BANK_PRESETS as readonly unknown[]).includes(timeBank)) return null
  if (!AUTO_START_LABELS.some(([mode]) => mode === autoStart)) return null
  if (!isRecord(look) || !(FELTS as readonly unknown[]).includes(look.felt) || !(CARD_BACKS as readonly unknown[]).includes(look.cardBack)) {
    return null
  }
  if (!isRecord(format)) return null
  let f: QuickRoom['format']
  if (format.format === 'cash') {
    if (!Number.isSafeInteger(format.ante) || (format.ante as number) < 0) return null
    // Страддл (#222): у выбора до него поля нет — без страддла
    if (format.straddle !== undefined && typeof format.straddle !== 'boolean') return null
    f = { format: 'cash', ante: format.ante as number, ...(format.straddle === true ? { straddle: true } : {}) }
  } else if (format.format === 'tournament') {
    if (tournamentError(format.tournament) !== null) return null
    f = { format: 'tournament', tournament: format.tournament as TournamentSettings }
  } else return null
  if (typeof publicHud !== 'boolean') return null
  // Ход раздачи по касанию банка (#258): у выбора до него поля нет — вкл
  if (liveHand !== undefined && typeof liveHand !== 'boolean') return null
  if (mix !== undefined && mix !== null && !isMixShare(mix)) return null
  if (maxRuns !== undefined && !isMaxRuns(maxRuns)) return null
  // Вскрытие (#279): у выбора до него поля нет — все открывают
  if (muck !== undefined && !(MUCK_MODES as readonly unknown[]).includes(muck)) return null
  return {
    sb,
    bb,
    startingStack,
    cards,
    variant: { game: variant.game as TableGameId, limit: variant.limit },
    turnSeconds: turnSeconds as number | null,
    timeBank: turnSeconds === null ? null : ((timeBank as number | null | undefined) ?? null),
    autoStart: autoStart as AutoStart,
    look: { felt: look.felt as Look['felt'], cardBack: look.cardBack as Look['cardBack'] },
    format: f,
    publicHud,
    ...(liveHand === false ? { liveHand: false } : {}),
    mix: mix ?? null,
    maxRuns: maxRuns ?? 1,
    ...(muck !== undefined ? { muck: muck as MuckMode } : {}),
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

// Подпись под кнопкой: «Холдем · кэш · карты на телефонах · блайнды 5/10 · стек 1 000»;
// у омахи — с лимитом, с таймером — «ход 30 с», с запасом (#223) — ещё «запас 30 с»; своя игра (#224) — названием и лимитом
export function quickRoomLine(s: Partial<Settings>): string {
  const own = isOwnGameId(s.game) ? s.games?.find((g) => g.id === s.game) : undefined
  const name = own?.name ?? GAME_CHOICES.find(([id]) => id === (s.game ?? 'holdem'))?.[1] ?? 'Холдем'
  const limit = own ? own.limit : s.game === 'omaha' ? (s.limit ?? 'pot') : null
  const game = limit ? `${name} ${limit === 'nolimit' ? 'без лимита' : 'пот-лимит'}` : name
  return [
    game,
    s.format === 'tournament' ? 'турнир' : 'кэш',
    s.cards === 'phones' ? 'карты на телефонах' : 'живые карты',
    `блайнды ${formatNumber(s.sb ?? DEFAULT_SETTINGS.sb)}/${formatNumber(s.bb ?? DEFAULT_SETTINGS.bb)}`,
    `стек ${formatNumber(s.startingStack ?? DEFAULT_SETTINGS.startingStack)}`,
    ...(typeof s.turnSeconds === 'number' ? [`ход ${s.turnSeconds} с`] : []),
    ...(typeof s.turnSeconds === 'number' && typeof s.timeBank === 'number' ? [`запас ${s.timeBank} с`] : []),
  ].join(' · ')
}

// Ведущий быстрой комнаты — постоянный, кем телефон был за столом в прошлый раз; не знает — null, тогда форма
export function quickRoomHost(players: Regular[], me: string): Regular | null {
  return players.find((r) => r.id === me) ?? null
}
