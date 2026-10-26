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

// Классы обёртки стола: сукно и рубашка карт внутри неё
export function lookClass(settings: Partial<Settings>): string {
  const { felt, cardBack } = lookOf(settings)
  return `table-look felt-${felt} back-${cardBack}`
}
