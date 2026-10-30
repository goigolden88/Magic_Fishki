// Новая комната (#127): настройки стола из выбора ведущего — одни у формы «Новая комната» и у «Быстрой комнаты».
// Быстрая — начальные значения формы и стек из закупа по умолчанию «Настроек»
import type { Regular } from '../model'
import type { CardsMode, GameId, Limit } from '../poker/game'
import { DEFAULT_SETTINGS, type AutoStart, type Settings } from '../poker/table'
import { formatNumber } from './format'
import { lookOf, type Look } from './pokerLook'
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
}

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
  }
}

// «Быстрая комната»: начальные значения формы, стек — закуп по умолчанию
export function quickRoomSettings(defaultBuyin: number): Partial<Settings> {
  return roomSettings({ ...ROOM_DEFAULTS, startingStack: defaultBuyin })
}

// Подпись под кнопкой: «Холдем · кэш · карты на телефонах · блайнды 5/10 · стек 1 000»
export function quickRoomLine(s: Partial<Settings>): string {
  const game = GAME_CHOICES.find(([id]) => id === (s.game ?? 'holdem'))?.[1] ?? 'Холдем'
  return [
    game,
    s.format === 'tournament' ? 'турнир' : 'кэш',
    s.cards === 'phones' ? 'карты на телефонах' : 'живые карты',
    `блайнды ${formatNumber(s.sb ?? DEFAULT_SETTINGS.sb)}/${formatNumber(s.bb ?? DEFAULT_SETTINGS.bb)}`,
    `стек ${formatNumber(s.startingStack ?? DEFAULT_SETTINGS.startingStack)}`,
  ].join(' · ')
}

// Ведущий быстрой комнаты — постоянный, кем телефон был за столом в прошлый раз; не знает — null, тогда форма
export function quickRoomHost(players: Regular[], me: string): Regular | null {
  return players.find((r) => r.id === me) ?? null
}
