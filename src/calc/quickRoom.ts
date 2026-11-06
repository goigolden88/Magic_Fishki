// Новая комната (#127): настройки стола из выбора ведущего — одни у формы «Новая комната» и у «Быстрой комнаты».
// Быстрая — начальные значения формы и стек из закупа по умолчанию «Настроек»
import type { Regular } from '../model'
import type { CardsMode, GameId, Limit } from '../poker/game'
import { isMixShare, type MixShare } from '../poker/mix'
import { isMaxRuns, type MaxRuns } from '../poker/runs'
import { CARD_BACKS, DEFAULT_SETTINGS, FELTS, TURN_MAX_S, TURN_MIN_S, type AutoStart, type Settings } from '../poker/table'
import { tournamentError, type TournamentSettings } from '../poker/tournament'
import { formatNumber } from './format'
import { lookOf, type Look } from './pokerLook'
import { AUTO_START_LABELS } from './pokerTimer'
import { formSettings, tournamentForm } from './tournamentForm'

// «Покер» — игра и лимит стола (#80): холдем и шорт-дек (#81) — без лимита; у омахи — пот-лимит (по умолчанию) или без лимита
export type GameChoice = { game: GameId; limit: Limit }

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
  autoStart: AutoStart
  look: Look
  format: Pick<Settings, 'format' | 'ante' | 'tournament'>
  publicHud: boolean
  // «Микс» (#166): доля «против», при которой смена игры ещё проходит; нет или null — выкл.
  // Только с картами на телефонах: при живых не уходит
  mix?: MixShare | null
  // «Прогнать несколько раз» (#167, Р-58): до скольких раз; нет или 1 — нет. Только с картами на телефонах
  maxRuns?: MaxRuns
}

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

// Настройки стола для запроса create
export function roomSettings(c: RoomChoice): Partial<Settings> {
  return {
    sb: c.sb,
    bb: c.bb,
    startingStack: c.startingStack,
    cards: c.cards,
    ...gameSettings(c.variant),
    turnSeconds: c.turnSeconds,
    autoStart: c.autoStart,
    ...c.look,
    ...c.format,
    publicHud: c.publicHud,
    ...(c.mix && c.cards === 'phones' ? { mix: true, mixAgainst: c.mix } : {}),
    ...(c.maxRuns && c.maxRuns > 1 && c.cards === 'phones' ? { maxRuns: c.maxRuns } : {}),
  }
}

// Своя «Быстрая комната» (Р-62): выбор ведущего в «Настройках» — поля формы без игроков и пароля.
// startingStack null — закуп по умолчанию «Настроек». На телефоне ведущего и в копии; не задана — начальные значения
export type QuickRoom = Omit<RoomChoice, 'startingStack'> & { startingStack: number | null }

export const QUICK_ROOM_DEFAULT: QuickRoom = { ...ROOM_DEFAULTS, startingStack: null, mix: null, maxRuns: 1 }

// Выбор для запроса create: своя или начальная, стек — свой или закуп по умолчанию
export function quickRoomChoice(room: QuickRoom | null, defaultBuyin: number): RoomChoice {
  const r = room ?? QUICK_ROOM_DEFAULT
  return { ...r, startingStack: r.startingStack ?? defaultBuyin }
}

// «Быстрая комната»: своя из «Настроек» или начальные значения формы; стек — свой или закуп по умолчанию
export function quickRoomSettings(defaultBuyin: number, room: QuickRoom | null = null): Partial<Settings> {
  return roomSettings(quickRoomChoice(room, defaultBuyin))
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
// приложение; знает ли её сервер — скажет он сам при создании
export function parseQuickRoom(raw: unknown): QuickRoom | null {
  if (!isRecord(raw)) return null
  const { sb, bb, startingStack, cards, variant, turnSeconds, autoStart, look, format, publicHud, mix, maxRuns } = raw
  if (!isPositive(sb) || !isPositive(bb) || sb > bb) return null
  if (startingStack !== null && (!isPositive(startingStack) || startingStack < bb)) return null
  if (cards !== 'live' && cards !== 'phones') return null
  if (!isRecord(variant) || !GAME_CHOICES.some(([id]) => id === variant.game)) return null
  if (variant.limit !== 'pot' && variant.limit !== 'nolimit') return null
  if (turnSeconds !== null && !(Number.isInteger(turnSeconds) && (turnSeconds as number) >= TURN_MIN_S && (turnSeconds as number) <= TURN_MAX_S)) {
    return null
  }
  if (!AUTO_START_LABELS.some(([mode]) => mode === autoStart)) return null
  if (!isRecord(look) || !(FELTS as readonly unknown[]).includes(look.felt) || !(CARD_BACKS as readonly unknown[]).includes(look.cardBack)) {
    return null
  }
  if (!isRecord(format)) return null
  let f: QuickRoom['format']
  if (format.format === 'cash') {
    if (!Number.isSafeInteger(format.ante) || (format.ante as number) < 0) return null
    f = { format: 'cash', ante: format.ante as number }
  } else if (format.format === 'tournament') {
    if (tournamentError(format.tournament) !== null) return null
    f = { format: 'tournament', tournament: format.tournament as TournamentSettings }
  } else return null
  if (typeof publicHud !== 'boolean') return null
  if (mix !== undefined && mix !== null && !isMixShare(mix)) return null
  if (maxRuns !== undefined && !isMaxRuns(maxRuns)) return null
  return {
    sb,
    bb,
    startingStack,
    cards,
    variant: { game: variant.game as GameId, limit: variant.limit },
    turnSeconds: turnSeconds as number | null,
    autoStart: autoStart as AutoStart,
    look: { felt: look.felt as Look['felt'], cardBack: look.cardBack as Look['cardBack'] },
    format: f,
    publicHud,
    mix: mix ?? null,
    maxRuns: maxRuns ?? 1,
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

// Подпись под кнопкой: «Холдем · кэш · карты на телефонах · блайнды 5/10 · стек 1 000»;
// у омахи — с лимитом, с таймером — «ход 30 с»
export function quickRoomLine(s: Partial<Settings>): string {
  const name = GAME_CHOICES.find(([id]) => id === (s.game ?? 'holdem'))?.[1] ?? 'Холдем'
  const game = s.game === 'omaha' ? `${name} ${s.limit === 'nolimit' ? 'без лимита' : 'пот-лимит'}` : name
  return [
    game,
    s.format === 'tournament' ? 'турнир' : 'кэш',
    s.cards === 'phones' ? 'карты на телефонах' : 'живые карты',
    `блайнды ${formatNumber(s.sb ?? DEFAULT_SETTINGS.sb)}/${formatNumber(s.bb ?? DEFAULT_SETTINGS.bb)}`,
    `стек ${formatNumber(s.startingStack ?? DEFAULT_SETTINGS.startingStack)}`,
    ...(typeof s.turnSeconds === 'number' ? [`ход ${s.turnSeconds} с`] : []),
  ].join(' · ')
}

// Ведущий быстрой комнаты — постоянный, кем телефон был за столом в прошлый раз; не знает — null, тогда форма
export function quickRoomHost(players: Regular[], me: string): Regular | null {
  return players.find((r) => r.id === me) ?? null
}
