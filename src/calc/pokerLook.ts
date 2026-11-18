// Вид стола (#77): сукно и рубашка карт — выбор ведущего из готовых. Экран рисует их классами
// на обёртке стола: felt-<сукно> и back-<рубашка>. У столов до #77 полей нет — зелёное и классика
import { isAvatarId, OWN_AVATAR, type AvatarChoice } from '../poker/avatar'
import type { CardBack, Felt, Settings } from '../poker/table'

export const FELT_LABELS: [Felt, string][] = [
  ['green', 'Зелёное'],
  ['blue', 'Синее'],
  ['burgundy', 'Бордовое'],
  ['graphite', 'Графит'],
]

export const CARD_BACK_LABELS: [CardBack, string][] = [
  ['classic', 'Классика'],
  ['blue', 'Синяя'],
  ['green', 'Зелёная'],
  ['geo', 'Гео'],
]

export type Look = { felt: Felt; cardBack: CardBack }

export function lookOf(settings: Partial<Settings>): Look {
  return { felt: settings.felt ?? 'green', cardBack: settings.cardBack ?? 'classic' }
}

// Личный «Вид стола» (Р-61, #170): выбор этого телефона поверх выбора ведущего — сукно, рубашка и колода.
// Новые сукна и рубашки — только здесь: ведущему остаются прежние четыре, их проверяет сервер.
// null — «Как у стола» (выбор ведущего); колода — «Две масти цветом» или «Четыре цвета»,
// null у колоды — не выбрана на этом телефоне: четыре цвета (#192), а восстановление из копии может её дописать
export type MyFelt = Felt | 'navy' | 'black'
// 'own' — своя рубашка картинкой с устройства (#220): не в MY_BACK_LABELS — «Своя» видна, только пока картинка есть
export type MyBack = CardBack | 'chip' | 'dark' | 'own'
export const OWN_BACK = 'own'
export type Deck = 'two' | 'four'
// Лицо карт (#219): «Крупное» — ранг и масть строкой по центру белой карты, «Классическое» — индекс в углу и масть
// по центру, «Цветное» — карта залита цветом масти, белые ранг и масть. null или нет поля (записи до #219) — «Крупное»
export type Face = 'big' | 'classic' | 'color'
// Аватарка (#298): рисунок из набора, 'own' — своя картинка с устройства, null или нет поля (записи до #298) —
// по умолчанию, по имени
export type MyLook = {
  felt: MyFelt | null
  cardBack: MyBack | null
  deck: Deck | null
  face?: Face | null
  avatar?: AvatarChoice | null
}

export const MY_LOOK_DEFAULT: MyLook = { felt: null, cardBack: null, deck: null, face: null }
export const DECK_DEFAULT: Deck = 'four'
export const FACE_DEFAULT: Face = 'big'

// Колода, которой рисуются карты: своя или, если не выбрана, по умолчанию
export function deckOf(mine: MyLook): Deck {
  return mine.deck ?? DECK_DEFAULT
}

// Лицо, которым рисуются карты: своё или, если не выбрано, «Крупное»
export function faceOf(mine: MyLook): Face {
  return mine.face ?? FACE_DEFAULT
}

export const MY_FELT_LABELS: [MyFelt, string][] = [
  ...FELT_LABELS,
  ['navy', 'Тёмно-синее'],
  ['black', 'Чёрное'],
]

export const MY_BACK_LABELS: [MyBack, string][] = [
  ...CARD_BACK_LABELS,
  ['chip', 'Фишка'],
  ['dark', 'Тёмная'],
]

export const DECK_LABELS: [Deck, string][] = [
  ['two', 'Две масти цветом'],
  ['four', 'Четыре цвета'],
]

export const FACE_LABELS: [Face, string][] = [
  ['big', 'Крупное'],
  ['classic', 'Классическое'],
  ['color', 'Цветное'],
]

function oneOf<T extends string>(labels: [T, string][], v: unknown): T | null {
  return labels.some(([id]) => id === v) ? (v as T) : null
}

// Из памяти телефона или копии: не из готовых или нет поля — «Как у стола» и колода не выбрана.
// Записанная колода остаётся как есть: прежние версии писали её всегда, «две масти» в записи — две масти
export function parseMyLook(raw: unknown): MyLook {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return withAvatar(
    {
      felt: oneOf(MY_FELT_LABELS, o.felt),
      cardBack: o.cardBack === OWN_BACK ? OWN_BACK : oneOf(MY_BACK_LABELS, o.cardBack),
      deck: oneOf(DECK_LABELS, o.deck),
      face: oneOf(FACE_LABELS, o.face),
    },
    o.avatar,
  )
}

// Аватарка в виде (#298) — полем, только когда выбрана: «по умолчанию» — поля нет, как в записях до #298
function withAvatar(look: MyLook, avatar: unknown): MyLook {
  const { avatar: _, ...rest } = look
  return avatar === OWN_AVATAR || isAvatarId(avatar) ? { ...rest, avatar } : rest
}

// Вид для копии (#220): своей картинки в копии нет, поэтому и «Своя» в ней — «Как у стола»; так же своя
// аватарка (#298) — «по умолчанию»: в копии только выбор из набора. Остальное как есть
export function backupLook(look: MyLook): MyLook {
  const back = look.cardBack === OWN_BACK ? { ...look, cardBack: null } : look
  return look.avatar === OWN_AVATAR ? withAvatar(back, null) : back
}

// Рубашка, которой рисуются карты: «Своя», а картинки на этом устройстве нет (стёрли память, другой браузер), —
// «Как у стола»
export function drawnBack(mine: MyLook, hasPicture: boolean): MyBack | null {
  return mine.cardBack === OWN_BACK && !hasPicture ? null : mine.cardBack
}

// Ничего не выбрано — записи в памяти телефона нет; выбранная колода, и «две масти» тоже, — запись есть;
// выбранное лицо, и «Крупное» тоже, — запись есть
export function isDefaultLook(mine: MyLook): boolean {
  return (
    mine.felt === null &&
    mine.cardBack === null &&
    mine.deck === null &&
    (mine.face ?? null) === null &&
    (mine.avatar ?? null) === null
  )
}

// Восстановление из копии: выбор копии — там, где на этом телефоне ничего не выбрано; свой — не перезаписывается
export function mergeMyLook(local: MyLook, backup: MyLook): MyLook {
  return withAvatar(
    {
      felt: local.felt ?? backup.felt,
      cardBack: local.cardBack ?? backup.cardBack,
      deck: local.deck ?? backup.deck,
      face: local.face ?? backup.face ?? null,
    },
    local.avatar ?? backup.avatar ?? null,
  )
}

// Аватарка, которой рисуется своё место (#298): «Своя», а картинки на этом устройстве нет — по умолчанию
export function drawnAvatar(mine: MyLook, hasPicture: boolean): AvatarChoice | null {
  const avatar = mine.avatar ?? null
  return avatar === OWN_AVATAR && !hasPicture ? null : avatar
}

// Классы обёртки стола: сукно и рубашка карт внутри неё; свой выбор телефона — поверх выбора ведущего.
// hasPicture — есть ли на устройстве своя картинка рубашки (#220)
export function lookClass(settings: Partial<Settings>, mine: MyLook = MY_LOOK_DEFAULT, hasPicture = false): string {
  const table = lookOf(settings)
  return `table-look felt-${mine.felt ?? table.felt} back-${drawnBack(mine, hasPicture) ?? table.cardBack}`
}

// Цвет масти на лице карты: две масти цветом — черви и бубны красные (класс red);
// четыре цвета — класс по масти: пики чёрные, черви красные, бубны синие, трефы зелёные
export function suitClass(card: string, deck: Deck): string {
  const suit = card[1]
  if (deck === 'four') return `suit-${suit}`
  return suit === 'h' || suit === 'd' ? 'red' : ''
}
