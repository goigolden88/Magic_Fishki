// Редактор своей игры (#225, Р-85): «Настройки» → «Свои игры». Поля — кнопками, кроме названия; описание
// проверяет ownGameError (#224) — та же проверка, что у сервера комнат. Здесь — разбор формы, подписи и список
import { pluralForm } from './format'
import type { Limit } from '../poker/game'
import {
  OWN_BOARD_MAX,
  OWN_GAMES_MAX,
  OWN_ROUNDS_MAX,
  ownGameError,
  seatsFor,
  upOf,
  type OwnGame,
  type OwnGameId,
  type OwnOrder,
} from '../poker/ownGame'

// Форма — описание без id: id даёт экран при первом «Сохранить»
export type OwnGameForm = Omit<OwnGame, 'id'>

// Новая игра: пустое название, две карты, все закрытые, любые из руки, 52 карты, стол «3, 1, 1» (флоп, тёрн, ривер),
// без лимита
export const OWN_GAME_NEW: OwnGameForm = {
  name: '',
  hole: 2,
  up: 0,
  fromHand: 'any',
  deck: 52,
  order: 'standard',
  board: [3, 1, 1],
  limit: 'nolimit',
}

// Кнопки полей «Колода», «Старшинство», «Лимит» — подписи и для справки
export const OWN_DECK_LABELS: [OwnGameForm['deck'], string][] = [
  [52, '52 карты'],
  [36, '36 карт'],
]

export const OWN_ORDER_LABELS: [OwnOrder, string][] = [
  ['standard', 'Обычное'],
  ['shortdeck', 'Как в шорт-деке'],
]

export const OWN_LIMIT_LABELS: [Limit, string][] = [
  ['nolimit', 'Без лимита'],
  ['pot', 'Пот-лимит'],
]

// id для проверки формы, пока игра не сохранена
const DRAFT_ID: OwnGameId = 'own-draft'

export function ownGameFormOf(game: OwnGame): OwnGameForm {
  const { id: _id, ...form } = game
  return { ...form, board: [...form.board] }
}

// Описание из формы: название — без пробелов по краям; открытых 0 — без поля up (как у игр до #226: такое
// описание прочтут и старые телефоны)
export function ownGameOf(form: OwnGameForm, id: OwnGameId): OwnGame {
  const { up, ...rest } = form
  return { id, ...rest, ...(up ? { up } : {}), name: form.name.trim(), board: [...form.board] }
}

// Под каким полем строка ошибки: остальные поля — кнопками, неверными они не бывают
export type OwnField = 'name' | 'fromHand' | 'board'

// Почему «Сохранить» неактивна: строка ownGameError и поле, под которым её показать; всё верно — null
export function ownFormError(form: OwnGameForm): { field: OwnField; text: string } | null {
  const text = ownGameError(ownGameOf(form, DRAFT_ID))
  if (text === null) return null
  if (ownGameError(ownGameOf({ ...OWN_GAME_NEW, name: form.name }, DRAFT_ID)) !== null) return { field: 'name', text }
  // С «любыми» из руки ошибки нет — дело в «ровно N»; иначе — в картах стола
  const boardOk = ownGameError(ownGameOf({ ...form, fromHand: 'any' }, DRAFT_ID)) === null
  return { field: boardOk ? 'fromHand' : 'board', text }
}

export function boardCount(form: Pick<OwnGameForm, 'board'>): number {
  return form.board.reduce((a, b) => a + b, 0)
}

// «Ровно N»: кнопки от 1 до меньшего из карт на руках и 5
export function fromHandChoices(form: Pick<OwnGameForm, 'hole'>): number[] {
  return Array.from({ length: Math.min(form.hole, 5) }, (_, i) => i + 1)
}

// «Ровно N» при этом столе: рука — пять карт, со стола ровно 5 − N
export function fromHandAllowed(form: Pick<OwnGameForm, 'board'>, n: number): boolean {
  return boardCount(form) >= 5 - n
}

// «Из них открытых» (#226): кнопки от 0 до карт на руках − 1 — хотя бы одна закрытая
export function upChoices(form: Pick<OwnGameForm, 'hole'>): number[] {
  return Array.from({ length: form.hole }, (_, i) => i)
}

// Меньше карт на руках — «ровно N» не больше их числа (и не больше 5), открытых — меньше их числа
export function withHole(form: OwnGameForm, hole: number): OwnGameForm {
  const most = Math.min(hole, 5)
  const fromHand = form.fromHand !== 'any' && form.fromHand > most ? most : form.fromHand
  return upOf(form) >= hole ? { ...form, hole, up: hole - 1, fromHand } : { ...form, hole, fromHand }
}

// Колода 36 — старшинство сначала как в шорт-деке, 52 — обычное; дальше его можно сменить
export function withDeck(form: OwnGameForm, deck: OwnGameForm['deck']): OwnGameForm {
  return { ...form, deck, order: deck === 36 ? 'shortdeck' : 'standard' }
}

// «+ круг» — ещё круг в одну карту: кругов не больше OWN_ROUNDS_MAX, карт стола — не больше OWN_BOARD_MAX
export function canAddRound(form: OwnGameForm): boolean {
  return form.board.length < OWN_ROUNDS_MAX && boardCount(form) < OWN_BOARD_MAX
}

export function canRemoveRound(form: OwnGameForm): boolean {
  return form.board.length > 1
}

export function withRound(form: OwnGameForm): OwnGameForm {
  return canAddRound(form) ? { ...form, board: [...form.board, 1] } : form
}

export function withoutRound(form: OwnGameForm): OwnGameForm {
  return canRemoveRound(form) ? { ...form, board: form.board.slice(0, -1) } : form
}

export function withRoundCards(form: OwnGameForm, round: number, cards: number): OwnGameForm {
  return { ...form, board: form.board.map((n, i) => (i === round ? cards : n)) }
}

// «За столом — до 6 игроков» (seatsFor): игроки × карты на руках + карты стола — не больше колоды
export function ownSeatsLine(form: OwnGameForm): string {
  return `За столом — до ${seatsFor(ownGameOf(form, DRAFT_ID))} игроков`
}

// Строка игры в списке и в форме комнаты: «5 карт, ровно 2 из руки · стол 3-1-1 · пот-лимит · до 9 игроков»;
// с открытыми — «3 карты (1 открытая), любые из руки · …»; колода 36 и старшинство — только если они не обычные
export function ownGameLine(form: OwnGameForm): string {
  const up = upOf(form)
  const open = up > 0 ? ` (${up} ${pluralForm(up, 'открытая', 'открытые', 'открытых')})` : ''
  const hand = `${form.hole} ${pluralForm(form.hole, 'карта', 'карты', 'карт')}${open}, ${
    form.fromHand === 'any' ? 'любые из руки' : `ровно ${form.fromHand} из руки`
  }`
  const deck =
    form.deck === 36
      ? form.order === 'shortdeck'
        ? 'колода 36'
        : 'колода 36, обычное старшинство'
      : form.order === 'shortdeck'
        ? 'старшинство как в шорт-деке'
        : null
  return [
    hand,
    `стол ${form.board.join('-')}`,
    ...(deck ? [deck] : []),
    form.limit === 'pot' ? 'пот-лимит' : 'без лимита',
    `до ${seatsFor(ownGameOf(form, DRAFT_ID))} игроков`,
  ].join(' · ')
}

// Своих игр — не больше OWN_GAMES_MAX
export function canAddOwnGame(games: OwnGame[]): boolean {
  return games.length < OWN_GAMES_MAX
}

// Сохранить: та же игра (id) — на своём месте, новая — в конец
export function putOwnGame(games: OwnGame[], game: OwnGame): OwnGame[] {
  return games.some((g) => g.id === game.id) ? games.map((g) => (g.id === game.id ? game : g)) : [...games, game]
}

export function removeOwnGame(games: OwnGame[], id: OwnGameId): OwnGame[] {
  return games.filter((g) => g.id !== id)
}
