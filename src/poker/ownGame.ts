// Свои игры (#224, Р-85): игра описывается данными — сколько карт на руках, сколько из руки играть,
// колода и старшинство, карты стола по кругам, лимит. Описание превращается в GameDef (ownGameDef):
// дальше стол сдаёт и считает руки так же, как у встроенных. Только карты на телефонах.
// Проверка описания (ownGameError) — общая для телефона и сервера комнат: сервер ей не доверяет вслепую
import { HOLDEM, SHORT_DECK, type Variant } from './cards'
import type { GameDef, GameId, GameRound, Limit } from './game'
import type { Street } from './hand'

// id своей игры — с приставкой: так он не спутается со встроенной (holdem, omaha, shortdeck)
export const OWN_PREFIX = 'own-'
export type OwnGameId = `${typeof OWN_PREFIX}${string}`

// Игра стола: встроенная или своя
export type TableGameId = GameId | OwnGameId

export type OwnGame = {
  id: OwnGameId
  name: string // своё название, до OWN_NAME_MAX знаков
  hole: number // карт на руках, OWN_HOLE_MIN…OWN_HOLE_MAX
  // Из них открытых (#226): видят все за столом; 0…hole − 1 (хотя бы одна закрытая). Нет поля — 0: так пишется и 0,
  // чтобы описание без открытых читали телефоны и копии до #226
  up?: number
  fromHand: 'any' | number // «любые» из руки и стола или «ровно N» из руки (N от 1 до меньшего из hole и 5)
  deck: 52 | 36
  order: OwnOrder // старшинство комбинаций
  board: number[] // карт стола по кругам после раздачи рук: 1–3 круга, в каждом 1–3, всего 3–5
  limit: Limit
  // Хай/лоу (#227): банк пополам старшей руке и лоу «восьмёрка или лучше»; только с колодой 52. Нет поля — без
  // хай/лоу: так пишется и «нет», чтобы описание без хай/лоу читали телефоны и копии до #227
  hiLo?: boolean
}

// Старшинство: обычное или как в шорт-деке (флеш старше фулл-хауса, тройка старше стрита, Р-52)
export type OwnOrder = 'standard' | 'shortdeck'

export const OWN_NAME_MAX = 24
export const OWN_HOLE_MIN = 2
export const OWN_HOLE_MAX = 7
export const OWN_ROUNDS_MAX = 3
export const OWN_ROUND_MAX = 3
export const OWN_BOARD_MIN = 3
export const OWN_BOARD_MAX = 5
// Своих игр за столом — не больше
export const OWN_GAMES_MAX = 8
// Мест за столом — не больше, сколько бы карт ни хватало
export const SEATS_MAX = 10

const FIELDS = ['id', 'name', 'hole', 'up', 'fromHand', 'deck', 'order', 'board', 'limit', 'hiLo']

export const HI_LO_DECK_ERROR = 'Хай/лоу — только с колодой 52: в 36 картах лоу не собрать'
// Круги стола по порядку — имена кругов торгов после раздачи рук
const BOARD_STREETS: Street[] = ['flop', 'turn', 'river']

export function isOwnGameId(id: unknown): id is OwnGameId {
  return typeof id === 'string' && id.startsWith(OWN_PREFIX)
}

// Почему описание не годится; годится — null. Строка — для человека: её показывает и сервер (отказ 400)
export function ownGameError(x: unknown): string | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'Своя игра — не описание игры'
  const g = x as Record<string, unknown>
  const extra = Object.keys(g).find((k) => !FIELDS.includes(k))
  if (extra !== undefined) return `В описании своей игры лишнее поле «${extra}»`
  if (typeof g.id !== 'string' || !/^own-[A-Za-z0-9_-]{1,40}$/.test(g.id)) return 'Своя игра без верного id'
  if (typeof g.name !== 'string' || g.name.trim() === '') return 'У своей игры нет названия'
  if ([...g.name].length > OWN_NAME_MAX) return `Название своей игры — не длиннее ${OWN_NAME_MAX} знаков`
  const name = `„${g.name}“`
  if (!isInt(g.hole) || g.hole < OWN_HOLE_MIN || g.hole > OWN_HOLE_MAX) {
    return `${name}: карт на руках — от ${OWN_HOLE_MIN} до ${OWN_HOLE_MAX}`
  }
  if (g.up !== undefined && (!isInt(g.up) || g.up < 0 || g.up >= g.hole)) {
    return `${name}: открытых карт — от 0 до ${g.hole - 1}, хотя бы одна закрытая`
  }
  if (g.deck !== 52 && g.deck !== 36) return `${name}: колода — 52 или 36 карт`
  if (g.order !== 'standard' && g.order !== 'shortdeck') return `${name}: старшинство — обычное или как в шорт-деке`
  if (g.limit !== 'nolimit' && g.limit !== 'pot') return `${name}: лимит — без лимита или пот-лимит`
  if (g.hiLo !== undefined && typeof g.hiLo !== 'boolean') return `${name}: хай/лоу — да или нет`
  if (g.hiLo === true && g.deck !== 52) return HI_LO_DECK_ERROR
  if (!Array.isArray(g.board) || g.board.length < 1 || g.board.length > OWN_ROUNDS_MAX) {
    return `${name}: кругов карт стола — от 1 до ${OWN_ROUNDS_MAX}`
  }
  if (!g.board.every((n) => isInt(n) && n >= 1 && n <= OWN_ROUND_MAX)) return `${name}: в круге стола — от 1 до ${OWN_ROUND_MAX} карт`
  const board = (g.board as number[]).reduce((a, b) => a + b, 0)
  if (board < OWN_BOARD_MIN || board > OWN_BOARD_MAX) return `${name}: карт стола — от ${OWN_BOARD_MIN} до ${OWN_BOARD_MAX}, а не ${board}`
  if (g.fromHand !== 'any') {
    const most = Math.min(g.hole, 5)
    if (!isInt(g.fromHand) || g.fromHand < 1 || g.fromHand > 5) return `${name}: из руки — любые или ровно от 1 до ${most}`
    if (g.fromHand > g.hole) return `${name}: из руки ровно ${g.fromHand}, а карт на руках ${g.hole}`
    // bestHand берёт со стола ровно 5 − N
    if (board < 5 - g.fromHand) return `${name}: из руки ровно ${g.fromHand} — нужно карт стола ${5 - g.fromHand}, а их ${board}`
  }
  return null
}

// Сколько из карт на руках открытых: нет поля — 0
export function upOf(game: Pick<OwnGame, 'up'>): number {
  return game.up ?? 0
}

// Описание (уже проверенное ownGameError) — в GameDef: раздача рук (сначала закрытые по кругу, затем открытые —
// dealRound), затем круги стола
export function ownGameDef(game: OwnGame): GameDef {
  const variant: Variant = {
    deck: game.deck,
    fromHand: game.fromHand,
    order: game.order === 'shortdeck' ? SHORT_DECK.order : HOLDEM.order,
  }
  const up = upOf(game)
  const rounds: GameRound[] = [
    { street: 'preflop', deal: [{ kind: 'hole', down: game.hole - up, up }] },
    ...game.board.map((count, i) => ({ street: BOARD_STREETS[i], deal: [{ kind: 'board' as const, count }] })),
  ]
  return { id: game.id, name: game.name, variant, rounds, ...(game.hiLo ? { hiLo: true as const } : {}) }
}

// Сколько мест за столом своей игры: игроки × карты на руках + карты стола ≤ колода, но не больше SEATS_MAX
export function seatsFor(game: OwnGame): number {
  const board = game.board.reduce((a, b) => a + b, 0)
  return Math.min(SEATS_MAX, Math.floor((game.deck - board) / game.hole))
}

// Свои игры стола: список до OWN_GAMES_MAX верных описаний без повторов id, и каждой хватает карт на maxSeats
export function ownGamesError(games: unknown, maxSeats: number): string | null {
  if (!Array.isArray(games)) return 'Свои игры — списком'
  if (games.length > OWN_GAMES_MAX) return `Своих игр за столом — не больше ${OWN_GAMES_MAX}`
  const ids = new Set<unknown>()
  for (const g of games) {
    const error = ownGameError(g)
    if (error) return error
    const own = g as OwnGame
    if (ids.has(own.id)) return `Своя игра „${own.name}“ — дважды`
    ids.add(own.id)
    const seats = seatsFor(own)
    if (maxSeats > seats) return `„${own.name}“: за столом не больше ${seats} — карт на всех не хватит`
  }
  return null
}

// Свои игры из памяти телефона или копии (#224): верные описания без повторов id, по порядку; битые — мимо,
// не список — пусто
export function parseOwnGames(raw: unknown): OwnGame[] {
  if (!Array.isArray(raw)) return []
  const out: OwnGame[] = []
  for (const g of raw) {
    if (ownGameError(g) === null && !out.some((o) => o.id === (g as OwnGame).id)) out.push(g as OwnGame)
  }
  return out
}

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x)
}
