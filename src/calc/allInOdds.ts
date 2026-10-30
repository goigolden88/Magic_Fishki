// Шансы на ва-банке (#116): торги закрылись до ривера, остальное досдала программа — какая доля
// основного банка досталась бы каждому дошедшему до вскрытия при досдаче. Выигрыш — вся досдача,
// ничья на k — по 1/k. Считает телефон из записи раздачи (HandRecord): карты сбросивших в неё
// не попадают — они остаются в колоде, как в покер-румах.
// Сила руки — те же правила, что bestHand в src/poker/cards.ts (вариант: колода, «из руки», старшинство),
// но числом и без строк: перебор — тысячи досдач. Совпадение с bestHand проверяют тесты
import { buildDeck, type Card, type Category, type Variant } from '../poker/cards'
import type { Street } from '../poker/hand'
import type { HandRecord } from '../poker/table'

// Досдач меньше этого — полный перебор (с флопа и тёрна), больше — выборка этого размера
// с зерном из самой раздачи (до флопа): ответ один на всех телефонах, точность около ±1 %
export const SAMPLES = 20_000

const RANKS = '23456789TJQKA'
const SUIT_CHARS = 'shdc'
const CATEGORIES: Category[] = ['high', 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush']
const [HIGH, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH] = CATEGORIES.map((_, i) => i)
const BASE = [15 ** 5, 15 ** 4, 15 ** 3, 15 ** 2, 15, 1]

type Rules = { place: number[]; low: number } // место категории в старшинстве варианта; младший ранг колоды

// Карта числом: ранг × 4 + масть; ранг 2…14
function code(card: Card): number {
  return (RANKS.indexOf(card[0]) + 2) * 4 + SUIT_CHARS.indexOf(card[1])
}

const ranks = new Int32Array(5)
const groupRank = new Int32Array(5)
const groupSize = new Int32Array(5)

// Пятёрка числом: больше — сильнее, равны — ничья. Как value у bestHand: место комбинации, затем ранги
function score5(rules: Rules, a: number, b: number, c: number, d: number, e: number): number {
  ranks[0] = a >> 2
  ranks[1] = b >> 2
  ranks[2] = c >> 2
  ranks[3] = d >> 2
  ranks[4] = e >> 2
  for (let i = 1; i < 5; i++) {
    const r = ranks[i]
    let j = i
    while (j > 0 && ranks[j - 1] < r) {
      ranks[j] = ranks[j - 1]
      j--
    }
    ranks[j] = r
  }
  // Группы рангов: по размеру, затем по старшинству (ранги уже по убыванию, сдвиг устойчивый)
  let groups = 0
  for (let i = 0; i < 5; i++) {
    if (groups > 0 && groupRank[groups - 1] === ranks[i]) groupSize[groups - 1]++
    else {
      groupRank[groups] = ranks[i]
      groupSize[groups] = 1
      groups++
    }
  }
  for (let i = 1; i < groups; i++) {
    for (let j = i; j > 0 && groupSize[j - 1] < groupSize[j]; j--) {
      const r = groupRank[j]
      const s = groupSize[j]
      groupRank[j] = groupRank[j - 1]
      groupSize[j] = groupSize[j - 1]
      groupRank[j - 1] = r
      groupSize[j - 1] = s
    }
  }
  let category: number
  if (groups === 5) {
    const suit = a & 3
    const flush = (b & 3) === suit && (c & 3) === suit && (d & 3) === suit && (e & 3) === suit
    const low = rules.low
    // Младший стрит — туз и четыре младших ранга колоды (A-2-3-4-5, A-6-7-8-9)
    const high =
      ranks[0] - ranks[4] === 4
        ? ranks[0]
        : ranks[0] === 14 && ranks[1] === low + 3 && ranks[2] === low + 2 && ranks[3] === low + 1 && ranks[4] === low
          ? low + 3
          : 0
    if (high) return rules.place[flush ? STRAIGHT_FLUSH : STRAIGHT] * BASE[0] + high * BASE[1]
    category = flush ? FLUSH : HIGH
  } else if (groups === 2) category = groupSize[0] === 4 ? QUADS : FULL_HOUSE
  else if (groups === 3) category = groupSize[0] === 3 ? TRIPS : TWO_PAIR
  else category = PAIR
  let score = rules.place[category] * BASE[0]
  for (let i = 0; i < groups; i++) score += groupRank[i] * BASE[i + 1]
  return score
}

function combinations(items: number[], k: number): number[][] {
  if (k === 0) return [[]]
  const out: number[][] = []
  for (let i = 0; i <= items.length - k; i++) {
    for (const rest of combinations(items.slice(i + 1), k - 1)) out.push([items[i], ...rest])
  }
  return out
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i)

function binomial(n: number, k: number): number {
  let out = 1
  for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1)
  return Math.round(out)
}

// Зерно из самой раздачи (FNV-1a) и генератор mulberry32: на всех телефонах — одна и та же выборка
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

// Доли основного банка при досдаче стола до boardSize карт: у каждой руки, сумма — 1.
// dead — известные карты вне игры (открытые у сбросивших). Карты неверные или повторяются — null
export function equity(variant: Variant, hands: Card[][], board: Card[], boardSize: number, dead: Card[] = []): number[] | null {
  const deck = buildDeck(variant)
  const known = [...board, ...hands.flat(), ...dead]
  if (new Set(known).size !== known.length || !known.every((c) => deck.includes(c))) return null
  const need = boardSize - board.length
  if (hands.length < 2 || need < 0) return null
  const fromHand = variant.fromHand
  if (fromHand !== 'any' && (hands.some((h) => h.length < fromHand) || boardSize < 5 - fromHand)) return null
  if (fromHand === 'any' && hands.some((h) => h.length + boardSize < 5)) return null

  // Все карты — в одном ряду: сначала стол, затем руки по порядку; у руки — пятёрки номерами в этом ряду
  const all = new Int32Array(boardSize + hands.reduce((n, h) => n + h.length, 0))
  board.forEach((c, i) => (all[i] = code(c)))
  const fives: Int32Array[] = []
  let at = boardSize
  for (const hand of hands) {
    hand.forEach((c, i) => (all[at + i] = code(c)))
    const own = range(at, hand.length)
    const table = range(0, boardSize)
    const sets =
      fromHand === 'any'
        ? combinations([...table, ...own], 5)
        : combinations(own, fromHand).flatMap((h) => combinations(table, 5 - fromHand).map((t) => [...h, ...t]))
    fives.push(Int32Array.from(sets.flat()))
    at += hand.length
  }

  const rules: Rules = {
    place: CATEGORIES.map((c) => variant.order.indexOf(c)),
    low: variant.deck === 36 ? 6 : 2,
  }
  const shares = new Float64Array(hands.length)
  const best = new Float64Array(hands.length)
  const showdown = () => {
    let top = -1
    let count = 0
    for (let p = 0; p < hands.length; p++) {
      const f = fives[p]
      let b = -1
      for (let i = 0; i < f.length; i += 5) {
        const s = score5(rules, all[f[i]], all[f[i + 1]], all[f[i + 2]], all[f[i + 3]], all[f[i + 4]])
        if (s > b) b = s
      }
      best[p] = b
      if (b > top) {
        top = b
        count = 1
      } else if (b === top) count++
    }
    for (let p = 0; p < hands.length; p++) if (best[p] === top) shares[p] += 1 / count
  }

  const used = new Set(known)
  const rest = deck.filter((c) => !used.has(c)).map(code)
  if (need > rest.length) return null
  const total = binomial(rest.length, need)
  let runs = 0
  if (total <= SAMPLES) {
    // Полный перебор досдач: номера карт остатка по возрастанию
    const idx = range(0, need)
    for (;;) {
      for (let k = 0; k < need; k++) all[board.length + k] = rest[idx[k]]
      showdown()
      runs++
      let k = need - 1
      while (k >= 0 && idx[k] === rest.length - need + k) k--
      if (k < 0) break
      idx[k]++
      for (let j = k + 1; j < need; j++) idx[j] = idx[j - 1] + 1
    }
  } else {
    // Выборка: частичное тасование остатка на каждую досдачу
    const next = random(hash(`${variant.deck}|${variant.fromHand}|${board.join('')}|${hands.map((h) => h.join('')).join('|')}`))
    for (; runs < SAMPLES; runs++) {
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(next() * (rest.length - k))
        const t = rest[k]
        rest[k] = rest[j]
        rest[j] = t
        all[board.length + k] = rest[k]
      }
      showdown()
    }
  }
  return Array.from(shares, (s) => s / runs)
}

// Доли — в целые проценты; сумма — 100, разница от округления — первому
export function percents(shares: number[]): number[] {
  const out = shares.map((s) => Math.round(s * 100))
  if (out.length > 0) out[0] += 100 - out.reduce((a, b) => a + b, 0)
  return out
}

export type AllInOdds = { street: Street; players: { id: string; name: string; percent: number }[] }

// Последние посчитанные: экран перерисовывается часто, а запись та же
const cache = new Map<string, AllInOdds | null>()

// Шансы по записи раздачи: дошли до вскрытия двое и больше, а торги закрылись до последней
// улицы. Улица — последнего хода; карт стола к ней — по шагам описания игры. Иначе — null
export function allInOdds(record: HandRecord): AllInOdds | null {
  const ids = record.seats.map((s) => s.id).filter((id) => record.hands[id] !== undefined)
  const rounds = record.game.rounds
  const street = record.log.at(-1)?.street ?? rounds[0]?.street
  const closed = rounds.findIndex((r) => r.street === street)
  if (!street || ids.length < 2 || closed < 0 || closed === rounds.length - 1) return null
  const boardAt = (last: number) =>
    rounds.slice(0, last + 1).reduce((n, r) => n + r.deal.reduce((m, d) => m + (d.kind === 'board' ? d.count : 0), 0), 0)
  const known = boardAt(closed)
  const boardSize = boardAt(rounds.length - 1)
  if (known >= boardSize || record.board.length !== boardSize) return null
  const hands = ids.map((id) => record.shown[id] ?? [])
  if (hands.some((h) => h.length === 0 || h.some((c) => c === null))) return null
  const dead = Object.entries(record.shown)
    .filter(([id]) => !ids.includes(id))
    .flatMap(([, cards]) => cards.filter((c): c is Card => c !== null))
  const board = record.board.slice(0, known)
  const key = JSON.stringify([record.game.id, street, board, hands, dead])
  if (cache.has(key)) return cache.get(key) ?? null
  const shares = equity(record.game.variant, hands as Card[][], board, boardSize, dead)
  const names = new Map(record.seats.map((s) => [s.id, s.name]))
  const out = shares && {
    street,
    players: percents(shares).map((percent, i) => ({ id: ids[i], name: names.get(ids[i]) ?? 'Ушёл', percent })),
  }
  if (cache.size >= 20) cache.delete(cache.keys().next().value as string)
  cache.set(key, out)
  return out
}
