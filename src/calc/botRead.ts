// Чтение соперника ботом (#139, Р-45): диапазон рук игрока строится от его позиции и хода до флопа
// и сужается по каждому его ходу раздачи. Крупная ставка — поляризованный диапазон: сильные руки и
// блефы, доля блефов — от размера ставки и стиля игрока; мелкая — широкий; чек — без части самых
// сильных рук (не целиком); колл — без части самых сильных и самых слабых. Вход — только журнал ходов
// (hand.log), свои карты бота и открытые всем: чужих закрытых карт здесь нет. Диапазоны здесь — холдема
// (1326 рук); омаха (#147, Р-46) читает теми же правилами (preflopWeight, narrow) свою выборку рук — botOmaha
import { buildDeck, HOLDEM, type Card } from '../poker/cards'
import type { Hand, Street } from '../poker/hand'
import { handScore } from './allInOdds'
import { blockerBluff, COMBOS, comboIndex, inTop, openWidth, rankOf, WIDTHS, type Who } from './botRanges'

export type Random = () => number

// Ход из журнала с тем, что из него читается
export type Move = {
  street: Street
  id: string
  type: 'fold' | 'check' | 'call' | 'raise' | 'allin'
  aggressive: boolean // ставка или повышение (олл-ин выше ставки круга — тоже)
  passive: boolean // уравнял (олл-ин в пределах уравнивания — тоже)
  level: number // до флопа — повышений до этого хода (0 — никто не повышал); после — ставок улицы до хода
  size: number // ставка или повышение: прибавка к ставке круга / банк после уравнивания
  potBefore: number // банк перед ходом, со ставками
}

// Раздача глазами бота: кто где сидит и что делал
export type HandRead = {
  n: number
  ids: string[] // по местам раздачи
  button: number
  bbIndex: number
  moves: Move[]
}

export function readHand(hand: Hand): HandRead {
  const n = hand.seats.length
  const ids = hand.seats.map((s) => s.id)
  const sbIndex = n === 2 ? hand.button : (hand.button + 1) % n
  const bbIndex = (sbIndex + 1) % n
  let pot = 0
  let street: Street = 'preflop'
  let bets = new Map<string, number>([
    [ids[sbIndex], Math.min(hand.sb, hand.seats[sbIndex].committed + hand.seats[sbIndex].chips)],
    [ids[bbIndex], Math.min(hand.bb, hand.seats[bbIndex].committed + hand.seats[bbIndex].chips)],
  ])
  pot += [...bets.values()].reduce((a, b) => a + b, 0)
  let toBeat = hand.bb
  let level = 0
  const moves: Move[] = []
  for (const e of hand.log) {
    if (e.type === 'ante') {
      pot += e.bet
      continue
    }
    if (e.street !== street) {
      street = e.street
      bets = new Map()
      toBeat = 0
      level = 0
    }
    const prev = bets.get(e.playerId) ?? 0
    const aggressive = e.type === 'raise' || (e.type === 'allin' && e.bet > toBeat)
    const passive = e.type === 'call' || (e.type === 'allin' && !aggressive)
    const callPart = Math.max(0, toBeat - prev)
    const size = aggressive ? (e.bet - toBeat) / Math.max(1, pot + callPart) : 0
    moves.push({ street, id: e.playerId, type: e.type, aggressive, passive, level, size, potBefore: pot })
    pot += Math.max(0, e.bet - prev)
    bets.set(e.playerId, Math.max(prev, e.bet))
    if (aggressive) level++
    toBeat = Math.max(toBeat, e.bet)
  }
  return { n, ids, button: hand.button, bbIndex, moves }
}

// Порядок хода до флопа: 0 — первый после большого блайнда; сколько ходят после игрока (открытие первым)
export function behindOf(r: HandRead, id: string): number {
  const i = r.ids.indexOf(id)
  const order = (i - (r.bbIndex + 1) + r.n) % r.n
  return r.n - 1 - order
}

// После флопа: больше — ходит позже (кнопка — последней)
export function postflopOrder(r: HandRead, id: string): number {
  const i = r.ids.indexOf(id)
  return (i - r.button - 1 + r.n) % r.n
}

// Стол улицы: что про каждую руку известно на этих общих картах
export type BoardInfo = {
  score: Float64Array // сила лучшей пятёрки руки; рука с картой стола — −1
  v: Float64Array // сила для чтения: доля рук, которые она бьёт сейчас, и прибавка за дро (флоп, тёрн)
  order: Uint16Array // живые руки по v от слабых к сильным
}

const BOARD_CACHE = new Map<string, BoardInfo>()
const BOARD_CACHE_MAX = 8

export function boardInfo(board: Card[]): BoardInfo {
  const key = board.join('')
  const hit = BOARD_CACHE.get(key)
  if (hit) return hit
  const on = new Set(board)
  const score = new Float64Array(COMBOS.length)
  const live: number[] = []
  for (let c = 0; c < COMBOS.length; c++) {
    const { a, b } = COMBOS[c]
    if (on.has(a) || on.has(b)) {
      score[c] = -1
      continue
    }
    score[c] = handScore(HOLDEM, [a, b], board)
    live.push(c)
  }
  // Доля бьющихся рук: равные — пополам
  live.sort((p, q) => score[p] - score[q])
  const v = new Float64Array(COMBOS.length)
  for (let i = 0; i < live.length; ) {
    let j = i
    while (j < live.length && score[live[j]] === score[live[i]]) j++
    const made = (i + (j - i - 1) / 2) / live.length
    for (let k = i; k < j; k++) v[live[k]] = made
    i = j
  }
  if (board.length < 5) {
    for (const c of live) {
      const bonus = drawBonus(COMBOS[c].a, COMBOS[c].b, board)
      v[c] = Math.min(0.995, v[c] + bonus * (1 - v[c]))
    }
  }
  const order = Uint16Array.from([...live].sort((p, q) => v[p] - v[q]))
  const info = { score, v, order }
  BOARD_CACHE.set(key, info)
  if (BOARD_CACHE.size > BOARD_CACHE_MAX) BOARD_CACHE.delete(BOARD_CACHE.keys().next().value as string)
  return info
}

export type Draw = { flush: boolean; straight: 0 | 1 | 2 } // straight: 1 — гатшот, 2 — двусторонний

// Дро руки на столе (флоп, тёрн): своих карт к флешу или стриту не хватает одной; карты руки участвуют
export function drawOf(a: Card, b: Card, board: Card[]): Draw {
  if (board.length >= 5) return { flush: false, straight: 0 }
  let flush = false
  for (const s of 'shdc') {
    const own = (a[1] === s ? 1 : 0) + (b[1] === s ? 1 : 0)
    const onBoard = board.filter((c) => c[1] === s).length
    if (own > 0 && own + onBoard === 4) flush = true
  }
  const boardMask = maskOf(board)
  const all = boardMask | rankBit(a) | rankBit(b)
  if (hasStraight(all)) return { flush, straight: 0 }
  let outs = 0
  for (let r = 2; r <= 14; r++) {
    const bit = rankBit(r)
    if (all & bit) continue
    if (hasStraight(all | bit) && !hasStraight(boardMask | bit)) outs++
  }
  return { flush, straight: outs >= 2 ? 2 : outs === 1 ? 1 : 0 }
}

function drawBonus(a: Card, b: Card, board: Card[]): number {
  const d = drawOf(a, b, board)
  let bonus = 0
  if (d.flush) bonus += a[0] === 'A' || b[0] === 'A' ? 0.3 : 0.24
  if (d.straight === 2) bonus += 0.18
  else if (d.straight === 1) bonus += 0.07
  return Math.min(0.4, bonus)
}

function rankBit(x: Card | number): number {
  const r = typeof x === 'number' ? x : rankOf(x)
  return r === 14 ? (1 << 14) | (1 << 1) : 1 << r
}

function maskOf(cards: Card[]): number {
  let m = 0
  for (const c of cards) m |= rankBit(c)
  return m
}

function hasStraight(mask: number): boolean {
  for (let low = 1; low <= 10; low++) {
    const w = 0b11111 << low
    if ((mask & w) === w) return true
  }
  return false
}

// Как читается ход по стилю игрока
export type ReadStyle = {
  trap: number // чек: вес самых сильных рук (медленная игра)
  callTop: number // колл: вес самых сильных (с ними чаще повышают)
  callLow: number // колл: вес самых слабых
  value: number // ставка: доля диапазона, что ставит на вэлью
  bluff: number // множитель доли блефов в крупной ставке
}

const READ: Record<Who, ReadStyle> = {
  maniac: { trap: 0.25, callTop: 0.35, callLow: 0.5, value: 0.6, bluff: 1.8 },
  station: { trap: 0.7, callTop: 1, callLow: 0.6, value: 0.12, bluff: 0.35 },
  nit: { trap: 0.6, callTop: 0.9, callLow: 0.05, value: 0.2, bluff: 0.15 },
  abc: { trap: 0.45, callTop: 0.6, callLow: 0.12, value: 0.35, bluff: 0.45 },
  tag: { trap: 0.45, callTop: 0.45, callLow: 0.18, value: 0.4, bluff: 1 },
  lag: { trap: 0.35, callTop: 0.4, callLow: 0.22, value: 0.45, bluff: 1.15 },
  unknown: { trap: 0.45, callTop: 0.6, callLow: 0.25, value: 0.35, bluff: 0.8 },
}

// Доля блефов в ставке размера size (часть банка) — как у равновесия: size / (1 + 2·size), со стилем
export function bluffShare(size: number, who: Who): number {
  return Math.min(0.6, Math.max(0.02, (size / (1 + 2 * size)) * READ[who].bluff))
}

// Диапазон игрока id по ходам раздачи: вес каждой из 1326 рук. known — карты, которых у него быть не может
// (свои карты бота, общие, открытые всем)
export function rangeOf(r: HandRead, id: string, who: Who, board: Card[], known: Card[]): Float64Array {
  const w = new Float64Array(COMBOS.length)
  const out = new Set(known)
  const p = preflopOf(r, id, who)
  for (let c = 0; c < COMBOS.length; c++) {
    const combo = COMBOS[c]
    if (out.has(combo.a) || out.has(combo.b)) continue
    w[c] = preflopWeight(p, combo.top, () => blockerBluff(combo))
  }
  // После флопа — по улицам, на их общих картах
  const style = READ[who]
  for (const [street, cards] of POSTFLOP_STREETS) {
    if (board.length < cards) break
    const moves = p.mine.filter((m) => m.street === street && m.type !== 'fold')
    if (moves.length === 0) continue
    const info = boardInfo(board.slice(0, cards))
    for (let c = 0; c < w.length; c++) if (info.score[c] < 0) w[c] = 0
    for (const m of moves) narrow(w, info, m, style, who)
  }
  return w
}

// Улицы после флопа и карт стола на каждой
export const POSTFLOP_STREETS: [Street, number][] = [
  ['flop', 3],
  ['turn', 4],
  ['river', 5],
]

// Что про игрока нужно для веса руки до флопа: его ходы, стиль, большой ли блайнд, ширина открытия по месту
export type PreflopRead = { who: Who; mine: Move[]; pre: Move[]; isBB: boolean; open: number }

export function preflopOf(r: HandRead, id: string, who: Who): PreflopRead {
  const mine = r.moves.filter((m) => m.id === id)
  return {
    who,
    mine,
    pre: mine.filter((m) => m.street === 'preflop'),
    isBB: r.ids.indexOf(id) === r.bbIndex,
    open: openWidth(who, behindOf(r, id), r.n),
  }
}

// Вес руки с верхней долей t по ходам игрока до флопа; bluff — годится ли рука в блеф-3-бет (блокеры).
// Одно правило для холдема и омахи: у омахи t — своей оценкой четырёх карт (botOmaha)
export function preflopWeight(p: PreflopRead, t: number, bluff: () => boolean): number {
  const { who, isBB } = p
  const wd = WIDTHS[who]
  let x = 1
  for (const m of p.pre) {
    if (m.type === 'fold') continue
    if (m.level === 0) {
      if (m.type === 'check') x *= t < wd.threeBet * 2 && who !== 'station' ? (who === 'maniac' ? 0.2 : 0.35) : 1
      else if (m.passive) x *= inTop(t, wd.limp) * (t < 0.04 && who !== 'station' ? 0.4 : 1)
      else if (m.aggressive) x *= inTop(t, p.open)
    } else if (m.level === 1) {
      if (m.passive) x *= inTop(t, isBB ? wd.bbCall : wd.call) * (t < wd.threeBet && who !== 'station' ? 0.35 : 1)
      else if (m.aggressive) x *= Math.max(inTop(t, wd.threeBet), bluff() ? wd.bluffs * 0.5 : 0)
    } else {
      if (m.passive) x *= inTop(t, wd.threeBet * 1.6) * (t < wd.fourBet ? 0.4 : 1)
      else if (m.aggressive) x *= Math.max(inTop(t, wd.fourBet), bluff() ? wd.bluffs * 0.25 : 0)
    }
  }
  return x
}

export function readStyle(who: Who): ReadStyle {
  return READ[who]
}

// Сузить диапазон по одному ходу после флопа: q — место руки в нынешнем диапазоне (0 — слабейшая, 1 — сильнейшая).
// Руки — номерами: у холдема все 1326, у омахи — выборка диапазона (botOmaha)
export function narrow(w: Float64Array, info: BoardInfo, m: Move, style: ReadStyle, who: Who): void {
  const q = quantiles(w, info)
  if (q === null) return
  if (m.type === 'check') {
    for (const c of info.order) if (q[c] >= 0.8) w[c] *= style.trap
    return
  }
  if (m.passive) {
    for (const c of info.order) {
      if (q[c] >= 0.92) w[c] *= style.callTop
      else if (q[c] < 0.25) w[c] *= style.callLow
    }
    return
  }
  if (!m.aggressive) return
  // Повышение поверх ставки — уже, чем ставка
  const value = m.level > 0 ? style.value * 0.5 : style.value
  if (m.size < 0.55) {
    // Мелкая ставка — широкий диапазон, с перевесом сильных
    for (const c of info.order) if (q[c] < 1 - value * 1.6) w[c] *= 0.3 + 0.5 * q[c]
    return
  }
  // Крупная — поляризованный: вэлью сверху, блефы снизу в доле от размера, середина — почти без неё
  const share = bluffShare(m.size, who) * (m.level > 0 ? 0.6 : 1)
  let valueMass = 0
  let lowMass = 0
  for (const c of info.order) {
    if (q[c] >= 1 - value) valueMass += w[c]
    else if (q[c] < 0.4) lowMass += w[c]
  }
  const want = (valueMass * share) / (1 - share)
  const k = lowMass > 0 ? Math.min(1, want / lowMass) : 0
  for (const c of info.order) {
    if (q[c] >= 1 - value) continue
    w[c] *= q[c] < 0.4 ? k : 0.1
  }
}

// Та часть диапазона, что продолжит против ставки: верхние share по силе на этом столе
export function topOfRange(w: Float64Array, board: Card[], share: number): Float64Array {
  const info = boardInfo(board)
  const q = quantiles(w, info)
  if (q === null) return w
  const out = new Float64Array(w.length)
  for (const c of info.order) out[c] = q[c] >= 1 - share ? w[c] : 0
  return out
}

// Место каждой руки в диапазоне по силе v; диапазон пуст — null
export function quantiles(w: Float64Array, info: BoardInfo): Float64Array | null {
  let total = 0
  for (const c of info.order) total += w[c]
  if (total <= 0) return null
  const q = new Float64Array(w.length)
  let before = 0
  for (const c of info.order) {
    q[c] = (before + w[c] / 2) / total
    before += w[c]
  }
  return q
}

// Доля банка своей руки против диапазонов соперников: на ривере — точно по каждой руке диапазона (с
// несколькими — произведение долей), до ривера — samples досдач с руками соперников из их диапазонов
export function equityVs(own: Card[], board: Card[], ranges: Float64Array[], random: Random, samples: number): number {
  if (ranges.length === 0) return 1
  const known = new Set([...own, ...board])
  const ready = ranges.map((w) => {
    let total = 0
    for (let c = 0; c < w.length; c++) total += w[c]
    if (total > 0) return w
    // Ходы прочитать не вышло — любые руки без известных карт
    const any = new Float64Array(w.length)
    for (let c = 0; c < any.length; c++) any[c] = known.has(COMBOS[c].a) || known.has(COMBOS[c].b) ? 0 : 1
    return any
  })
  if (board.length === 5) {
    const info = boardInfo(board)
    const mine = info.score[comboIndex(own[0], own[1])] ?? handScore(HOLDEM, own, board)
    let eq = 1
    for (const w of ready) {
      let total = 0
      let share = 0
      for (const c of info.order) {
        if (w[c] <= 0) continue
        total += w[c]
        const s = info.score[c]
        share += w[c] * (mine > s ? 1 : mine === s ? 0.5 : 0)
      }
      eq *= total > 0 ? share / total : 0.5
    }
    return eq
  }
  const cums = ready.map(cumulative)
  const deck = buildDeck(HOLDEM).filter((c) => !known.has(c))
  let share = 0
  let done = 0
  for (let k = 0; k < samples; k++) {
    const used = new Set<Card>()
    const hands: Card[][] = []
    let clash = false
    for (const cum of cums) {
      let picked = -1
      for (let tryNo = 0; tryNo < 6 && picked === -1; tryNo++) {
        const c = pick(cum, random)
        if (!used.has(COMBOS[c].a) && !used.has(COMBOS[c].b)) picked = c
      }
      if (picked === -1) {
        clash = true
        break
      }
      used.add(COMBOS[picked].a)
      used.add(COMBOS[picked].b)
      hands.push([COMBOS[picked].a, COMBOS[picked].b])
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
    const mine = handScore(HOLDEM, own, full)
    let tied = 1
    let lost = false
    for (const h of hands) {
      const d = mine - handScore(HOLDEM, h, full)
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
  for (let c = 0; c < w.length; c++) {
    s += w[c]
    cum[c] = s
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
