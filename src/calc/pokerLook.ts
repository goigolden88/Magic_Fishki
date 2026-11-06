// Вид стола (#77): сукно и рубашка карт — выбор ведущего из готовых. Экран рисует их классами
// на обёртке стола: felt-<сукно> и back-<рубашка>. У столов до #77 полей нет — зелёное и классика
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
// null — «Как у стола» (выбор ведущего); колода — «Две масти цветом» или «Четыре цвета»
export type MyFelt = Felt | 'navy' | 'black'
export type MyBack = CardBack | 'chip' | 'dark'
export type Deck = 'two' | 'four'
export type MyLook = { felt: MyFelt | null; cardBack: MyBack | null; deck: Deck }

export const MY_LOOK_DEFAULT: MyLook = { felt: null, cardBack: null, deck: 'two' }

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

function oneOf<T extends string>(labels: [T, string][], v: unknown): T | null {
  return labels.some(([id]) => id === v) ? (v as T) : null
}

// Из памяти телефона или копии: не из готовых или нет поля — «Как у стола» и две масти цветом
export function parseMyLook(raw: unknown): MyLook {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    felt: oneOf(MY_FELT_LABELS, o.felt),
    cardBack: oneOf(MY_BACK_LABELS, o.cardBack),
    deck: oneOf(DECK_LABELS, o.deck) ?? 'two',
  }
}

export function isDefaultLook(mine: MyLook): boolean {
  return mine.felt === null && mine.cardBack === null && mine.deck === 'two'
}

// Восстановление из копии: выбор копии — там, где на этом телефоне ничего не выбрано; свой — не перезаписывается
export function mergeMyLook(local: MyLook, backup: MyLook): MyLook {
  return {
    felt: local.felt ?? backup.felt,
    cardBack: local.cardBack ?? backup.cardBack,
    deck: local.deck === 'two' ? backup.deck : local.deck,
  }
}

// Классы обёртки стола: сукно и рубашка карт внутри неё; свой выбор телефона — поверх выбора ведущего
export function lookClass(settings: Partial<Settings>, mine: MyLook = MY_LOOK_DEFAULT): string {
  const table = lookOf(settings)
  return `table-look felt-${mine.felt ?? table.felt} back-${mine.cardBack ?? table.cardBack}`
}

// Цвет масти на лице карты: две масти цветом — черви и бубны красные (класс red);
// четыре цвета — класс по масти: пики чёрные, черви красные, бубны синие, трефы зелёные
export function suitClass(card: string, deck: Deck): string {
  const suit = card[1]
  if (deck === 'four') return `suit-${suit}`
  return suit === 'h' || suit === 'd' ? 'red' : ''
}
