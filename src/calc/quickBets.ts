// Быстрые ставки панели хода (Р-62): после флопа — доли банка, до флопа — множители большого блайнда.
// Свои кнопки — на этом телефоне и в копии. Правил не меняют: сумма вне min…max — кнопки нет,
// олл-ин — своей кнопкой; пот-лимит — «Банк» превращается в «Пот» до предела банка
import { formatNumber } from './format'

// pot — проценты банка (33 и 67 — ровно треть и две трети); pre — десятые большого блайнда (25 — 2,5 ББ)
export type QuickBets = { pot: number[]; pre: number[] }

export const QUICK_BETS_DEFAULT: QuickBets = { pot: [33, 50, 75, 100], pre: [25, 30, 40] }

export const QUICK_BETS_MAX = 5 // кнопок в ряду, каждого вида
export const POT_PCT_MIN = 10
export const POT_PCT_MAX = 300
export const PRE_TENTHS_MIN = 20 // 2 ББ — меньше минимального рейза не бывает
export const PRE_TENTHS_MAX = 200 // 20 ББ

const POT_NAMES: Record<number, string> = { 25: '¼', 33: '⅓', 50: '½', 67: '⅔', 75: '¾' }

// 50 → «½ банка», 100 → «Банк», 150 → «150 % банка»
export function potBetLabel(pct: number): string {
  if (pct === 100) return 'Банк'
  return `${POT_NAMES[pct] ?? `${pct} %`} банка`
}

// 25 → «2,5 ББ», 30 → «3 ББ»
export function preBetLabel(tenths: number): string {
  return `${tenthsText(tenths)} ББ`
}

function tenthsText(tenths: number): string {
  const rest = tenths % 10
  return `${formatNumber(Math.trunc(tenths / 10))}${rest ? `,${rest}` : ''}`
}

function share(pct: number): number {
  return pct === 33 ? 1 / 3 : pct === 67 ? 2 / 3 : pct / 100
}

// Ввод доли: «33», «50 %» → проценты; вне POT_PCT_MIN…POT_PCT_MAX или не целое — null
export function parsePotPct(text: string): number | null {
  const clean = text.replace(/[\s %]/g, '')
  if (!/^\d+$/.test(clean)) return null
  const n = Number(clean)
  return n >= POT_PCT_MIN && n <= POT_PCT_MAX ? n : null
}

// Ввод множителя: «2,5», «3» → десятые; больше одного знака после запятой или вне предела — null
export function parsePreTenths(text: string): number | null {
  const clean = text.replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d)?$/.test(clean)) return null
  const n = Math.round(Number(clean) * 10)
  return n >= PRE_TENTHS_MIN && n <= PRE_TENTHS_MAX ? n : null
}

// Добавить кнопку: список — по возрастанию, без повторов и не длиннее QUICK_BETS_MAX
export function addBet(list: number[], value: number): number[] {
  if (list.includes(value) || list.length >= QUICK_BETS_MAX) return list
  return [...list, value].sort((a, b) => a - b)
}

export function isDefaultBets(b: QuickBets): boolean {
  return same(b.pot, QUICK_BETS_DEFAULT.pot) && same(b.pre, QUICK_BETS_DEFAULT.pre)
}

function same(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// Из памяти телефона или копии; не похоже — null. Пустой список — можно: тогда остаются «Мин» и олл-ин
export function parseQuickBets(raw: unknown): QuickBets | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { pot, pre } = raw as Record<string, unknown>
  const pots = listOf(pot, POT_PCT_MIN, POT_PCT_MAX)
  const pres = listOf(pre, PRE_TENTHS_MIN, PRE_TENTHS_MAX)
  return pots && pres ? { pot: pots, pre: pres } : null
}

function listOf(x: unknown, min: number, max: number): number[] | null {
  if (!Array.isArray(x) || x.length > QUICK_BETS_MAX) return null
  if (!x.every((n) => Number.isInteger(n) && n >= min && n <= max)) return null
  const list = [...new Set(x as number[])].sort((a, b) => a - b)
  return list
}

// Где стоит игрок: до какой ставки улицы можно (min…max), сколько в банке и доставить на колл
export type RaiseSpot = {
  preflop: boolean
  currentBet: number
  toCall: number
  pot: number // всё в банке со ставками улицы, до моего колла
  min: number
  max: number
  potTop: boolean // пот-лимит, а предел банка меньше стека
  bb: number // большой блайнд этой раздачи
}

export type QuickRaise = { label: string; to: number }

// Кнопки: «Мин», затем свои — до флопа N ББ, после — доля банка после колла поверх ставки улицы.
// Сумма меньше минимума или не меньше max — кнопки нет (max — олл-ин или «Пот»); одинаковые суммы — одна кнопка.
// Пот-лимит, предел меньше стека: «Пот» до предела — до флопа всегда, после — когда среди своих есть «Банк»
export function quickRaises(s: RaiseSpot, bets: QuickBets = QUICK_BETS_DEFAULT): QuickRaise[] {
  const afterCall = s.pot + s.toCall
  const options: QuickRaise[] = [{ label: 'Мин', to: s.min }]
  if (s.preflop) {
    for (const m of bets.pre) options.push({ label: preBetLabel(m), to: Math.round((s.bb * m) / 10) })
  } else {
    for (const p of bets.pot) {
      if (p === 100 && s.potTop) continue
      options.push({ label: potBetLabel(p), to: s.currentBet + Math.floor(afterCall * share(p)) })
    }
  }
  const out: QuickRaise[] = []
  for (const o of options) {
    if (o.to >= s.min && o.to < s.max && !out.some((x) => x.to === o.to)) out.push(o)
  }
  if (s.potTop && (s.preflop || bets.pot.includes(100))) out.push({ label: 'Пот', to: s.max })
  return out
}
