// Бот покера (#117, Р-38): решение хода — чистая функция. Вход — вид стола глазами бота (viewFor:
// свои карты, стол, банк, ставки, позиция; чужие закрытые — null), выход — допустимый ход по правилам
// src/poker/. Чужие карты бот не читает, даже если ему подать весь стол: только свои и открытые всем.
// Случай — параметром (random): с одним и тем же случаем ответ один
import { buildDeck, type Card, type Variant } from '../poker/cards'
import { publicCards } from '../poker/game'
import type { BetAction } from '../poker/protocol'
import type { TableState } from '../poker/table'
import { handScore } from './allInOdds'
import { actionsView, type ActionsView } from './pokerView'

export type BotLevel = 'novice' | 'amateur' | 'strong'

export const BOT_LEVELS: [BotLevel, string][] = [
  ['novice', 'Новичок'],
  ['amateur', 'Любитель'],
  ['strong', 'Сильный'],
]

// Случай: число 0…1, как Math.random
export type Random = () => number

// Досдач на оценку руки после флопа: против случайных рук соперников
export const BOT_SAMPLES = 60
// Соперников в оценке — не больше стольких: дальше доля почти не меняется, а считать дольше
const MAX_RIVALS = 3

// Повторимый случай по зерну (mulberry32) — для тестов
export function seededRandom(seed: number): Random {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

// Расклад глазами бота
type Spot = {
  preflop: boolean
  s: number // сила: до флопа — по двум старшим картам руки, после — доля банка против случайных рук
  late: number // позиция: 1 — кнопка, меньше — раньше ходит
  toCall: number
  pot: number // всё в банке со ставками улицы
  price: number // доля колла в банке после колла
  bb: number
  currentBet: number
  raised: boolean // до флопа ставку уже подняли выше большого блайнда
  stack: number // фишек за спиной
}

type Intent = { kind: 'fold' } | { kind: 'call' } | { kind: 'raise'; to: number }

const FOLD: Intent = { kind: 'fold' }
const CALL: Intent = { kind: 'call' } // уравнивать нечего — чек
const raiseTo = (to: number): Intent => ({ kind: 'raise', to })

// Ход бота botId; не его ход — null
export function botMove(view: TableState, botId: string, level: BotLevel, random: Random): BetAction | null {
  const hand = view.hand
  const a = actionsView(view, botId)
  if (!hand || !a?.myTurn) return null
  const index = hand.seats.findIndex((s) => s.id === botId)
  const seat = hand.seats[index]
  const cards = hand.cards
  const own = (cards?.hole[botId] ?? []).filter(isCard)
  const board = cards?.board ?? []
  const pot = hand.seats.reduce((sum, s) => sum + s.committed, 0)
  const toCall = a.check ? 0 : a.call
  const rivals = hand.seats.filter((s) => !s.folded && s.id !== botId)
  const preflop = hand.stage === 'preflop'
  let s = 0.5 // карт нет (живые) — середина
  if (cards && own.length >= 2) {
    // Открытые всем карты соперников — вне колоды; закрытые бот не знает
    const dead = rivals.flatMap((r) => publicCards(cards, r.id).filter(isCard))
    s = preflop ? preflopStrength(own) : equityVsRandom(cards.game.variant, own, board, rivals.length, dead, random)
  }
  const x: Spot = {
    preflop,
    s,
    late: lateness(index, hand.button, hand.seats.length),
    toCall,
    pot,
    price: toCall / (pot + toCall),
    bb: hand.bb,
    currentBet: hand.currentBet,
    raised: preflop && hand.currentBet > hand.bb,
    stack: seat.chips,
  }
  return toAction(a, STYLES[level](x, random))
}

// «Новичок»: почти всё уравнивает, пасует редко, повышает только с сильной рукой и не всегда; позицию не замечает
function novice(x: Spot, r: Random): Intent {
  const s = x.s + (r() - 0.5) * 0.3
  if (s > 0.8 && r() < 0.35) return raiseTo(x.preflop ? x.currentBet + 2 * x.bb : x.currentBet + x.pot / 2)
  if (x.toCall === 0) return CALL
  // Пас — слабая рука или ставка на большую часть стека, и то не всегда
  const fold = Math.max(0, 0.35 - s) + Math.max(0, x.toCall / (x.stack + x.toCall) - 0.3)
  return r() < fold ? FOLD : CALL
}

// «Любитель»: играет руки получше, позицию учитывает немного, после флопа сверяет силу с ценой колла
function amateur(x: Spot, r: Random): Intent {
  const s = x.s + (r() - 0.5) * 0.2
  if (x.preflop) {
    if (!x.raised) {
      if (s > 0.5 - 0.1 * x.late) return raiseTo(3 * x.bb)
      return s > 0.25 || x.toCall === 0 ? CALL : FOLD
    }
    if (s > 0.72) return raiseTo(3 * x.currentBet)
    if (s > 0.42 && x.toCall <= x.stack * 0.25) return CALL
    return x.toCall === 0 ? CALL : FOLD
  }
  if (x.toCall === 0) return s > 0.6 || r() < 0.08 ? raiseTo(x.pot / 2) : CALL
  if (s > 0.82) return raiseTo(x.currentBet * 2.5)
  return s >= x.price + 0.05 ? CALL : FOLD
}

// «Сильный»: диапазон рук по позиции, размер ставки — от банка, колл — по цене банка, иногда блеф с позиции
function strong(x: Spot, r: Random): Intent {
  const s = x.s + (r() - 0.5) * 0.1
  if (x.preflop) {
    const need = 0.55 - 0.3 * x.late // ранняя позиция — только лучшие руки, кнопка — шире
    if (!x.raised) {
      // Открытие — 2,5 большого блайнда и по большому за каждого уравнявшего до него
      const open = raiseTo(2.5 * x.bb + Math.max(0, x.pot - 1.5 * x.bb))
      if (s >= need) return open
      if (x.toCall === 0) return CALL
      if (x.late >= 0.75 && s >= need - 0.1 && r() < 0.35) return open // кража блайндов
      return FOLD
    }
    if (s >= Math.max(0.68, need + 0.2)) return raiseTo(3 * x.currentBet)
    if (s >= need + 0.08 && x.toCall <= x.stack * 0.2) return CALL
    return x.toCall === 0 ? CALL : FOLD
  }
  if (x.toCall === 0) {
    if (s > 0.62) return raiseTo((x.pot * 2) / 3)
    if (x.late >= 0.75 && r() < 0.15) return raiseTo(x.pot / 2)
    return CALL
  }
  if (s > 0.8) return raiseTo(x.currentBet + x.pot + x.toCall) // повышение на банк
  return s >= x.price + 0.03 ? CALL : FOLD
}

const STYLES: Record<BotLevel, (x: Spot, r: Random) => Intent> = { novice, amateur, strong }

// Намерение — в допустимый ход по кнопкам хода (actionsView): пас при возможном чеке — чек;
// повысить нельзя — олл-ин, если он есть, иначе колл; сумма — в пределах от минимума до максимума
function toAction(a: ActionsView, intent: Intent): BetAction {
  const passive: BetAction = a.check ? { type: 'check' } : { type: 'call' }
  if (intent.kind === 'fold') return a.check ? { type: 'check' } : { type: 'fold' }
  if (intent.kind === 'call') return passive
  const r = a.raise
  if (!r) return a.allIn !== null ? { type: 'allin' } : passive
  const to = Math.min(r.max, Math.max(r.min, Math.round(intent.to)))
  return to === r.max && r.allIn ? { type: 'allin' } : { type: 'raise', to }
}

// Позиция: кнопка — 1; блайнды — 0,4 (после флопа ходят первыми); остальные — по порядку хода до флопа
function lateness(index: number, button: number, n: number): number {
  const offset = (index - button + n) % n
  if (offset === 0) return 1
  if (n === 2 || offset <= 2) return 0.4
  return (offset - 2) / (n - 2)
}

const RANKS = '23456789TJQKA'
const rankOf = (c: Card) => RANKS.indexOf(c[0]) + 2

// Сила руки до флопа по двум старшим картам — счёт Чена: старшая карта, пара, одной масти, разрыв;
// 0 — 7-2 разной масти, 1 — пара тузов
export function preflopStrength(own: Card[]): number {
  const [c1, c2] = [...own].sort((p, q) => rankOf(q) - rankOf(p))
  const hi = rankOf(c1)
  const lo = rankOf(c2)
  const points = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2)
  let score: number
  if (hi === lo) score = Math.max(5, points(hi) * 2)
  else {
    const gap = hi - lo - 1
    score = points(hi) + (c1[1] === c2[1] ? 2 : 0) - (gap >= 4 ? 5 : [0, 1, 2, 4][gap])
    if (gap <= 1 && hi < 12) score += 1
  }
  return Math.min(1, Math.max(0, (Math.ceil(score) + 1) / 21))
}

// Доля банка против случайных рук rivals соперников: досдать стол и руки из остатка колоды BOT_SAMPLES раз
function equityVsRandom(variant: Variant, own: Card[], board: Card[], rivals: number, dead: Card[], random: Random): number {
  const n = Math.min(Math.max(1, rivals), MAX_RIVALS)
  const known = new Set([...own, ...board, ...dead])
  const rest = buildDeck(variant).filter((c) => !known.has(c))
  const needBoard = 5 - board.length
  const need = needBoard + n * own.length
  if (need > rest.length) return 0.5
  let share = 0
  for (let k = 0; k < BOT_SAMPLES; k++) {
    // Частичное тасование: первые need карт остатка — новые
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(random() * (rest.length - i))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    const full = [...board, ...rest.slice(0, needBoard)]
    const mine = handScore(variant, own, full)
    let tied = 1
    let lost = false
    for (let p = 0; p < n && !lost; p++) {
      const from = needBoard + p * own.length
      const d = mine - handScore(variant, rest.slice(from, from + own.length), full)
      if (d < 0) lost = true
      else if (d === 0) tied++
    }
    if (!lost) share += 1 / tied
  }
  return share / BOT_SAMPLES
}

function isCard(c: Card | null): c is Card {
  return typeof c === 'string'
}
