// Экран «Тренажёр» (#213, Р-73): ввод сторон и борда → вход счёта rangeEquity, ответ — словами и числами экрана.
// Сам счёт и запись диапазона текстом — rangeEquity и rangeText (#212), здесь их только зовут
import { SUITS, type Card } from '../poker/cards'
import type { Street } from '../poker/hand'
import { formatNumber, pluralForm } from './format'
import { STAGE_LABELS } from './pokerView'
import type { EquitySide, RangeEquity } from './rangeEquity'
import { CLASSES, RANKS_DOWN, RANGE_SIZE } from './rangeText'

export const TRAINER_SIDES_MIN = 2
export const TRAINER_SIDES_MAX = 6
export const HAND_CARDS = 2
export const BOARD_MAX = 5
// Вес касания сетки: сначала 100 %
export const TRAINER_WEIGHTS = [1, 0.75, 0.5, 0.25, 0]
// Сочетаний карт у класса: пара — 6, одномастные — 4, разномастные — 12; всего рук — 1326
export const ALL_COMBOS = 1326

// Вкладка «Чарты» (#214): слова о наборе — у экрана и в справке (HELP_VALUES); сами чарты — charts.ts, грузятся
// отдельно, а эти строки — здесь, в основном пакете со справкой
export const CHARTS_GAME = '6-макс, 100 ББ'
export const CHARTS_ROUNDING = 'доли округлены до 25 % (у пар — до 1/6)'

// Колода выбора карт: ряд — масть, в ряду — от туза до двойки
export const TRAINER_DECK: Card[][] = SUITS.map((s) => [...RANKS_DOWN].map((r) => r + s))

export type SideMode = 'hand' | 'range'
// Сторона на экране: и рука, и диапазон хранятся — переключение «Рука» / «Диапазон» их не стирает
export type TrainerSide = { mode: SideMode; cards: Card[]; range: number[] }

// Число одной цифрой после запятой, без «,0»: 18,1 · 100 · 0,5
function short(n: number): string {
  const tenths = Math.round(n * 10)
  return tenths % 10 === 0 ? formatNumber(tenths / 10) : (tenths / 10).toFixed(1).replace('.', ',')
}

export const weightLabel = (w: number): string => `${formatNumber(Math.round(w * 100))} %`

function combosOf(cls: string): number {
  if (cls.length === 2) return 6
  return cls.endsWith('s') ? 4 : 12
}

const CLASS_COMBOS = CLASSES.map(combosOf)

// Размер диапазона: сочетаний с весом и доля от всех рук, в процентах
export function rangeSize(weights: number[]): { combos: number; percent: number } {
  let combos = 0
  for (let i = 0; i < RANGE_SIZE; i++) combos += (weights[i] ?? 0) * CLASS_COMBOS[i]
  return { combos, percent: (combos * 100) / ALL_COMBOS }
}

// «18,1 % рук · 240 сочетаний»
export function rangeSizeText(weights: number[]): string {
  const { combos, percent } = rangeSize(weights)
  const whole = Math.abs(combos - Math.round(combos)) < 1e-9
  const word = whole ? pluralForm(Math.round(combos), 'сочетание', 'сочетания', 'сочетаний') : 'сочетания'
  return `${short(percent)} % рук · ${short(combos)} ${word}`
}

// Доля от 0 до 1 → «62,3 %»
export const shareText = (x: number): string => `${(Math.round(x * 1000) / 10).toFixed(1).replace('.', ',')} %`

// Карты, занятые другими: всеми сторонами в «Руке», кроме стороны skip, и бордом, если skip — не борд
export function takenCards(sides: TrainerSide[], board: Card[], skip: number | 'board'): Set<Card> {
  const out = new Set<Card>(skip === 'board' ? [] : board)
  sides.forEach((s, i) => {
    if (i !== skip && s.mode === 'hand') s.cards.forEach((c) => out.add(c))
  })
  return out
}

// Касание карты колоды: выбранная — снимается; иначе добавляется, а полный ряд меняет последнюю
export function pickCard(cards: Card[], card: Card, max: number): Card[] {
  if (cards.includes(card)) return cards.filter((c) => c !== card)
  if (cards.length < max) return [...cards, card]
  return [...cards.slice(0, max - 1), card]
}

// Вход счёта: всё заполнено — стороны rangeEquity; иначе — что не так, словами
export function trainerInput(sides: TrainerSide[], board: Card[]): { sides: EquitySide[] } | { reason: string } {
  if (board.length > 0 && board.length < 3) {
    const left = 3 - board.length
    return { reason: `Флоп — три карты: на борд ещё ${left} ${pluralForm(left, 'карту', 'карты', 'карт')}` }
  }
  const out: EquitySide[] = []
  for (let i = 0; i < sides.length; i++) {
    const s = sides[i]
    if (s.mode === 'hand') {
      if (s.cards.length < HAND_CARDS) {
        const left = HAND_CARDS - s.cards.length
        return { reason: `Сторона ${i + 1}: выберите ещё ${left} ${pluralForm(left, 'карту', 'карты', 'карт')}` }
      }
      out.push({ cards: s.cards })
    } else {
      if (!s.range.some((w) => w > 0)) return { reason: `Сторона ${i + 1}: пустой диапазон` }
      out.push({ range: s.range })
    }
  }
  return { sides: out }
}

// Карт борда к улице — как в истории раздач (BOARD_AT в pokerView)
export const STREET_CARDS: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 }
const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']

// Улицы раздачи из истории (#273): те, до которых дошёл полный борд, и борд к каждой — его первые 0 / 3 / 4 / 5 карт.
// Борд из 1–2 карт улиц не даёт — только префлоп
export function streetBoards(full: Card[]): { street: Street; label: string; board: Card[] }[] {
  return STREETS.filter((s) => s === 'preflop' || STREET_CARDS[s] <= full.length).map((street) => ({
    street,
    label: STAGE_LABELS[street],
    board: full.slice(0, STREET_CARDS[street]),
  }))
}

// Строка над итогом: выборка — «≈, 20 000 досдач», перебор — «точно, N досдач»; на ривере досдач нет
export function runsText(result: Extract<RangeEquity, { ok: true }>, boardCards: number): string {
  if (result.exact && boardCards === BOARD_MAX) return 'точно, без досдачи'
  const n = formatNumber(result.runs)
  const word = pluralForm(result.runs, 'досдача', 'досдачи', 'досдач')
  return result.exact ? `точно, ${n} ${word}` : `≈, ${n} ${word}`
}

// Под долей банка: «победа 60,1 % · ничья 4,4 %»
export const winTieText = (win: number, tie: number): string => `победа ${shareText(win)} · ничья ${shareText(tie)}`
