// Омаха для ботов (#147, Р-46): своя оценка четырёх карт до флопа, сила после флопа по правилу «ровно две
// из руки и три со стола», дро омахи (флеш-дро, натс-дро, «обёртки» стрита), натсы и диапазоны соперников.
// Оценка до флопа — упрощённая, таблицей признаков: пары, одномастность (двойная — выше), связанность,
// старшие карты, «висящая» карта — ниже; доля руки — по выборке рук, одной на все телефоны (своё зерно).
// Диапазон соперника — выборка четырёхкарточных рук: до флопа отбор по тем же правилам, что у холдема
// (preflopWeight), с омаховыми долями рук; после флопа — сужение по каждому ходу (narrow). Своих таблиц
// холдема (botRanges, 169 рук) омаха не трогает. Чужих закрытых карт здесь нет: только свои и открытые всем
import { buildDeck, OMAHA, type Card } from '../poker/cards'
import { handScore } from './allInOdds'
import type { Who } from './botRanges'
import { narrow, POSTFLOP_STREETS, preflopOf, preflopWeight, quantiles, readStyle, type BoardInfo, type HandRead, type Random } from './botRead'

const RANKS = '23456789TJQKA'
const rankOf = (c: Card) => RANKS.indexOf(c[0]) + 2
// Ранг битом; туз — и старший, и младший (A-2-3-4-5)
const bit = (r: number) => (r === 14 ? (1 << 14) | (1 << 1) : 1 << r)

// ——— До флопа ———

// Очки пары по рангу (двойки … тузы)
const PAIR_POINTS = [0, 0, 2, 2, 2, 2, 2, 2, 3, 3.5, 4.5, 5, 6, 7, 9]
// Две карты одной масти — по старшей из них: с тузом — к старшему флешу
const suitedPoints = (top: number) => (top === 14 ? 4 : top === 13 ? 3 : top === 12 ? 2.5 : top >= 10 ? 2 : 1.5)
// Старшие карты: десятка … туз
const highPoints = (r: number) => (r >= 10 ? (r - 9) * 0.4 : 0)

// Очки четырёх карт до флопа: больше — сильнее. A♠A♥K♠Q♥ — около 26, J♠T♥9♠8♥ — 13, K♠K♦7♣2♥ — 6, 2♣7♦9♥K♠ — 1
export function omahaPoints(own: Card[]): number {
  const ranks = own.map(rankOf)
  const count = new Map<number, number>()
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1)
  let points = 0
  // Пары; тройка и каре в руке — карты мешают друг другу
  for (const [r, k] of count) {
    if (k >= 2) points += PAIR_POINTS[r]
    if (k === 3) points -= 4
    if (k === 4) points -= 8
  }
  // Одномастность: две масти по две — дважды; три и четыре одной масти — хуже двух
  const bySuit = new Map<string, number[]>()
  own.forEach((c, i) => bySuit.set(c[1], [...(bySuit.get(c[1]) ?? []), ranks[i]]))
  for (const rs of bySuit.values()) {
    if (rs.length < 2) continue
    points += suitedPoints(Math.max(...rs)) - (rs.length === 3 ? 1.5 : rs.length === 4 ? 3 : 0)
  }
  // Связанность: сколько разных рангов руки в окне из пяти рангов подряд; «линия» из четырёх — лучше всего,
  // младшие стриты — дешевле
  const distinct = [...count.keys()]
  let most = 0
  let low = 0
  for (let l = 1; l <= 10; l++) {
    const w = 0b11111 << l
    const n = distinct.filter((r) => bit(r) & w).length
    if (n >= most) {
      most = n
      low = l
    }
  }
  if (most >= 2) {
    let c = most === 4 ? 7 : most === 3 ? 4 : 1.5
    if (most === 4) {
      const inWindow = distinct.map((r) => (r === 14 && low === 1 ? 1 : r))
      if (Math.max(...inWindow) - Math.min(...inWindow) === 3) c += 1
    }
    points += low + 4 < 9 ? c * 0.7 : c
  }
  for (const r of ranks) points += highPoints(r)
  // «Висящая» карта: без пары, без масти и далеко от остальных
  own.forEach((card, i) => {
    const r = ranks[i]
    if ((count.get(r) ?? 0) > 1 || (bySuit.get(card[1]) ?? []).length > 1) return
    const near = distinct.some((o) => o !== r && (Math.abs(o - r) <= 4 || (o === 14 && r <= 5) || (r === 14 && o <= 5)))
    if (!near) points -= r === 14 ? 0.5 : 2
  })
  return points
}

// Доля рук омахи по очкам — выборкой этого размера: считается один раз, одна на все телефоны (своё зерно)
const TABLE_SIZE = 20_000
let table: Float64Array | null = null

function pointsTable(): Float64Array {
  if (table) return table
  const random = mulberry(147)
  const deck = buildDeck(OMAHA)
  const out = new Float64Array(TABLE_SIZE)
  for (let k = 0; k < TABLE_SIZE; k++) {
    for (let i = 0; i < 4; i++) {
      const j = i + Math.floor(random() * (deck.length - i))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }
    out[k] = omahaPoints(deck.slice(0, 4))
  }
  out.sort()
  table = out
  return out
}

// Верхняя доля руки омахи: какая часть всех четырёхкарточных рук не хуже её (0 — лучшие, 1 — худшие)
export function omahaTop(own: Card[]): number {
  const p = omahaPoints(own)
  const t = pointsTable()
  const below = bound(t, p, false)
  const upTo = bound(t, p, true)
  return (t.length - upTo + (upTo - below) / 2) / t.length
}

// Сколько чисел ряда меньше p (или не больше — orEqual)
function bound(t: Float64Array, p: number, orEqual: boolean): number {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid] < p || (orEqual && t[mid] === p)) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Во сколько раз диапазоны до флопа в омахе шире холдемных той же доли рук: руки в омахе ближе по силе,
// в игру входят чаще (полосы 6-max пот-лимит омахи). Бот берёт свою долю руки, делённую на это число,
// и решает по правилам своего стиля; так же читает и соперника
export const OMAHA_SPREAD: Record<Who, number> = {
  maniac: 1.15,
  station: 1.15,
  nit: 1.5,
  abc: 1.15,
  tag: 1.2,
  lag: 1.2,
  unknown: 1.2,
}

// Блеф-повышение до флопа: двойная одномастная с тузом своей масти (блокер старшего флеша) или «линия»
// из четырёх без пары от восьмёрки
export function omahaBluff(own: Card[]): boolean {
  const aceSuited = own.some((a) => a[0] === 'A' && own.some((b) => b !== a && b[1] === a[1]))
  const suits = new Map<string, number>()
  for (const c of own) suits.set(c[1], (suits.get(c[1]) ?? 0) + 1)
  if (aceSuited && suits.size === 2 && [...suits.values()].every((k) => k === 2)) return true
  const ranks = own.map(rankOf)
  if (new Set(ranks).size < 4) return false
  for (let l = 4; l <= 10; l++) {
    const w = 0b11111 << l
    if (ranks.every((r) => bit(r) & w)) return true
  }
  return false
}

// ——— После флопа ———

export type OmahaDraw = {
  flush: boolean // две своей масти и две на столе
  nutFlush: boolean // и старшая карта этой масти — своя
  outs: number // карт к стриту (две свои и три со стола): 4 — гатшот, 8 — двусторонний, больше — «обёртка»
  straight: 0 | 1 | 2 // 1 — до 7 карт, 2 — от 8
}

const NO_DRAW: OmahaDraw = { flush: false, nutFlush: false, outs: 0, straight: 0 }

// Дро на флопе и тёрне — по правилу омахи: к флешу нужно две своих масти и три на столе, к стриту — две свои
export function omahaDraw(own: Card[], board: Card[]): OmahaDraw {
  if (board.length < 3 || board.length >= 5) return NO_DRAW
  let flush = false
  let nutFlush = false
  for (const s of 'shdc') {
    const mine = own.filter((c) => c[1] === s).map(rankOf)
    const on = board.filter((c) => c[1] === s).map(rankOf)
    if (mine.length < 2 || on.length !== 2) continue
    flush = true
    let top = 14
    while (on.includes(top)) top--
    if (mine.includes(top)) nutFlush = true
  }
  const ranks = own.map(rankOf)
  const boardRanks = board.map(rankOf)
  const mask = boardRanks.reduce((m, r) => m | bit(r), 0)
  let outs = 0
  if (!straightWith(ranks, mask)) {
    for (let x = 2; x <= 14; x++) {
      if (boardRanks.includes(x)) continue
      if (straightWith(ranks, mask | bit(x))) outs += 4 - ranks.filter((r) => r === x).length
    }
  }
  return { flush, nutFlush, outs, straight: outs >= 8 ? 2 : outs > 0 ? 1 : 0 }
}

// Есть ли стрит из двух своих разных рангов и трёх со стола (рангами битов mask)
function straightWith(ranks: number[], mask: number): boolean {
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i + 1; j < ranks.length; j++) {
      if (ranks[i] === ranks[j]) continue
      for (let l = 1; l <= 10; l++) {
        const w = 0b11111 << l
        const a = bit(ranks[i]) & w
        const b = bit(ranks[j]) & w
        if (a && b && (w & ~a & ~b & ~mask) === 0) return true
      }
    }
  }
  return false
}

// Место руки на столе: какую часть пар карт соперника (две из невидимых — его две свои) она бьёт, ничья —
// пополам; натсы — ни одна пара не сильнее. dead — открытые всем карты соперников
export function omahaBoardRank(own: Card[], board: Card[], dead: Card[] = []): { beats: number; nuts: boolean } {
  const mine = handScore(OMAHA, own, board)
  const seen = new Set([...own, ...board, ...dead])
  const rest = buildDeck(OMAHA).filter((c) => !seen.has(c))
  let total = 0
  let beats = 0
  let nuts = true
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const s = handScore(OMAHA, [rest[i], rest[j]], board)
      total++
      if (mine > s) beats++
      else if (mine === s) beats += 0.5
      else nuts = false
    }
  }
  return { beats: total > 0 ? beats / total : 1, nuts }
}

// ——— Диапазоны ———

// Диапазон игрока: выборка рук, вес каждой; info — их сила на нынешнем столе
export type OmahaRange = { hands: Card[][]; w: Float64Array; info: BoardInfo }

// Рук в выборке диапазона и попыток набрать её (узкий диапазон — меньше рук)
export const RANGE_HANDS = 120
const RANGE_TRIES = 3000

// Диапазон игрока id по ходам раздачи — на столе board (флоп и дальше). known — карты, которых у него быть не
// может (свои бота, общие, открытые всем). extra — рука, которую поставить в выборку последней (своя рука
// бота — её место в своём диапазоне глазами соперников)
export function omahaRangeOf(
  r: HandRead,
  id: string,
  who: Who,
  board: Card[],
  known: Card[],
  random: Random,
  extra?: Card[],
): OmahaRange {
  const out = new Set(known)
  const deck = buildDeck(OMAHA).filter((c) => !out.has(c))
  const p = preflopOf(r, id, who)
  const spread = OMAHA_SPREAD[who]
  const hands: Card[][] = []
  const weights: number[] = []
  for (let k = 0; k < RANGE_TRIES && hands.length < RANGE_HANDS; k++) {
    for (let i = 0; i < 4; i++) {
      const j = i + Math.floor(random() * (deck.length - i))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }
    const h = deck.slice(0, 4)
    const x = preflopWeight(p, omahaTop(h) / spread, () => omahaBluff(h))
    if (x > 0 && (x >= 1 || random() < x)) {
      hands.push(h)
      weights.push(1)
    }
  }
  // Ходы до флопа прочитать не вышло — любые руки
  for (let k = 0; hands.length === 0 && k < RANGE_HANDS; k++) {
    for (let i = 0; i < 4; i++) {
      const j = i + Math.floor(random() * (deck.length - i))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }
    hands.push(deck.slice(0, 4))
    weights.push(1)
  }
  if (extra) {
    hands.push(extra)
    weights.push(Math.max(1e-3, preflopWeight(p, omahaTop(extra) / spread, () => omahaBluff(extra))))
  }
  const w = Float64Array.from(weights)
  const infos = new Map<number, BoardInfo>()
  const infoAt = (cards: number) => {
    let info = infos.get(cards)
    if (!info) {
      info = sampleInfo(hands, board.slice(0, cards))
      infos.set(cards, info)
    }
    return info
  }
  const style = readStyle(who)
  for (const [street, cards] of POSTFLOP_STREETS) {
    if (board.length < cards) break
    const moves = p.mine.filter((m) => m.street === street && m.type !== 'fold')
    if (moves.length === 0) continue
    const info = infoAt(cards)
    for (const m of moves) narrow(w, info, m, style, who)
  }
  // Сузили до пустого — ходы противоречат друг другу: прежняя выборка без весов
  if (!w.some((x) => x > 0)) w.fill(1)
  return { hands, w, info: infoAt(Math.min(5, board.length)) }
}

// Сила рук выборки на столе: место среди рук выборки и прибавка за дро омахи (флоп, тёрн)
function sampleInfo(hands: Card[][], board: Card[]): BoardInfo {
  const n = hands.length
  const score = new Float64Array(n)
  for (let i = 0; i < n; i++) score[i] = handScore(OMAHA, hands[i], board)
  const live = Array.from({ length: n }, (_, i) => i).sort((p, q) => score[p] - score[q])
  const v = new Float64Array(n)
  for (let i = 0; i < n; ) {
    let j = i
    while (j < n && score[live[j]] === score[live[i]]) j++
    const made = (i + (j - i - 1) / 2) / n
    for (let k = i; k < j; k++) v[live[k]] = made
    i = j
  }
  if (board.length < 5) {
    for (let i = 0; i < n; i++) v[i] = Math.min(0.995, v[i] + drawBonus(hands[i], board) * (1 - v[i]))
  }
  const order = Uint16Array.from(live.sort((p, q) => v[p] - v[q]))
  return { score, v, order }
}

function drawBonus(own: Card[], board: Card[]): number {
  const d = omahaDraw(own, board)
  let bonus = 0
  if (d.flush) bonus += d.nutFlush ? 0.3 : 0.18
  if (d.outs >= 12) bonus += 0.28
  else if (d.outs >= 8) bonus += 0.2
  else if (d.outs > 0) bonus += 0.06
  return Math.min(0.45, bonus)
}

// Та часть диапазона, что продолжит против ставки: верхние share по силе на этом столе
export function omahaTopOfRange(g: OmahaRange, share: number): OmahaRange {
  const q = quantiles(g.w, g.info)
  if (q === null) return g
  const w = new Float64Array(g.w.length)
  for (const i of g.info.order) w[i] = q[i] >= 1 - share ? g.w[i] : 0
  return { ...g, w }
}

// Место последней руки выборки (своей — extra) в диапазоне: 0 — слабейшая, 1 — сильнейшая
export function omahaRankInRange(g: OmahaRange): number {
  const q = quantiles(g.w, g.info)
  return q ? q[g.hands.length - 1] : 0.5
}

// Доля банка своей руки против диапазонов соперников: на ривере — точно по выборке (с несколькими —
// произведение долей), до ривера — samples досдач с руками соперников из выборок по весу
export function omahaEquityVs(own: Card[], board: Card[], ranges: OmahaRange[], dead: Card[], random: Random, samples: number): number {
  if (ranges.length === 0) return 1
  if (board.length === 5) {
    const mine = handScore(OMAHA, own, board)
    let eq = 1
    for (const g of ranges) {
      let total = 0
      let share = 0
      for (let i = 0; i < g.hands.length; i++) {
        if (g.w[i] <= 0) continue
        total += g.w[i]
        const s = g.info.score[i]
        share += g.w[i] * (mine > s ? 1 : mine === s ? 0.5 : 0)
      }
      eq *= total > 0 ? share / total : 0.5
    }
    return eq
  }
  // Вес выборки пуст (верх диапазона уже руки) — любая рука выборки
  const cums = ranges.map((g) => cumulative(g.w.some((x) => x > 0) ? g.w : new Float64Array(g.w.length).fill(1)))
  const seen = new Set([...own, ...board, ...dead])
  const deck = buildDeck(OMAHA).filter((c) => !seen.has(c))
  let share = 0
  let done = 0
  for (let k = 0; k < samples; k++) {
    const used = new Set<Card>()
    const hands: Card[][] = []
    let clash = false
    for (let g = 0; g < ranges.length && !clash; g++) {
      let picked: Card[] | null = null
      for (let tryNo = 0; tryNo < 6 && !picked; tryNo++) {
        const h = ranges[g].hands[pick(cums[g], random)]
        if (!h.some((c) => used.has(c))) picked = h
      }
      if (!picked) clash = true
      else {
        for (const c of picked) used.add(c)
        hands.push(picked)
      }
    }
    if (clash) continue
    const full = [...board]
    while (full.length < 5) {
      const c = deck[Math.floor(random() * deck.length)]
      if (!used.has(c)) {
        used.add(c)
        full.push(c)
      }
    }
    const mine = handScore(OMAHA, own, full)
    let tied = 1
    let lost = false
    for (const h of hands) {
      const d = mine - handScore(OMAHA, h, full)
      if (d < 0) {
        lost = true
        break
      }
      if (d === 0) tied++
    }
    if (!lost) share += 1 / tied
    done++
  }
  return done > 0 ? share / done : 0.5
}

function cumulative(w: Float64Array): Float64Array {
  const cum = new Float64Array(w.length)
  let s = 0
  for (let i = 0; i < w.length; i++) {
    s += w[i]
    cum[i] = s
  }
  return cum
}

function pick(cum: Float64Array, random: Random): number {
  const x = random() * cum[cum.length - 1]
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] > x) hi = mid
    else lo = mid + 1
  }
  return lo
}

// Повторимый случай (mulberry32) — для таблицы долей
function mulberry(seed: number): Random {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000
  }
}
