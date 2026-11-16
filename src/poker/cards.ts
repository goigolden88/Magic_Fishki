// Карты и сила руки (Р-22). Карта — строка «ранг + масть», как в прототипе: 'Ah', 'Td', '7c';
// ранги 2–9, T, J, Q, K, A; масти s h d c. Правило варианта — данными (Variant), а не копиями кода:
// колода 52 или 36, сколько карт брать из руки, порядок старшинства комбинаций

export type Card = string

export const SUITS = ['s', 'h', 'd', 'c'] as const
const RANK_CHARS = '23456789TJQKA'

export type Category =
  | 'high'
  | 'pair'
  | 'twoPair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'fullHouse'
  | 'quads'
  | 'straightFlush'

export type Variant = {
  deck: 52 | 36 // 36 — без двоек, троек, четвёрок и пятёрок
  fromHand: 'any' | number // «любые из руки и стола» или «ровно N из руки, остальное со стола»
  order: Category[] // от младшей комбинации к старшей
}

const STANDARD_ORDER: Category[] = ['high', 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush']
// Шорт-дек: флеш старше фулл-хауса; тройка старше стрита — как у Triton (Р-52)
const SHORT_DECK_ORDER: Category[] = ['high', 'pair', 'twoPair', 'straight', 'trips', 'fullHouse', 'flush', 'quads', 'straightFlush']

export const HOLDEM: Variant = { deck: 52, fromHand: 'any', order: STANDARD_ORDER }
export const OMAHA: Variant = { deck: 52, fromHand: 2, order: STANDARD_ORDER }
export const SHORT_DECK: Variant = { deck: 36, fromHand: 'any', order: SHORT_DECK_ORDER }

// Ранги колоды варианта — числами от младшего: 2..14 или 6..14 (туз — 14)
function deckRanks(variant: Variant): number[] {
  const low = variant.deck === 36 ? 6 : 2
  return Array.from({ length: 15 - low }, (_, i) => low + i)
}

// Полная колода по порядку: от младшего ранга к старшему, внутри ранга — s h d c
export function buildDeck(variant: Variant): Card[] {
  return deckRanks(variant).flatMap((r) => SUITS.map((s) => RANK_CHARS[r - 2] + s))
}

type Parsed = { card: Card; rank: number; suit: string }

function parseCard(card: Card, ranks: number[]): Parsed {
  const rank = typeof card === 'string' && card.length === 2 ? RANK_CHARS.indexOf(card[0]) + 2 : 0
  const suit = typeof card === 'string' ? card[1] : ''
  if (rank < 2 || !(SUITS as readonly string[]).includes(suit)) throw new Error(`Неверная запись карты: «${card}»`)
  if (!ranks.includes(rank)) throw new Error(`Карты «${card}» нет в колоде этого варианта`)
  return { card, rank, suit }
}

// Все карты — верные, из колоды варианта и без повторов; иначе ошибка, а не случайный ответ
function parseAll(cards: Card[], ranks: number[]): Parsed[] {
  const seen = new Set<Card>()
  return cards.map((c) => {
    const p = parseCard(c, ranks)
    if (seen.has(c)) throw new Error(`Карта «${c}» встречается дважды`)
    seen.add(c)
    return p
  })
}

export type HandResult = {
  cards: Card[] // лучшая пятёрка: сначала карты комбинации, затем кикеры по старшинству
  category: Category
  value: number[] // для сравнения: место комбинации в порядке варианта, затем ранги по старшинству
  name: string // по-русски: «Две пары, короли и семёрки»
}

// > 0 — a сильнее, < 0 — b сильнее, 0 — ничья
export function compareHands(a: HandResult, b: HandResult): number {
  for (let i = 0; i < Math.max(a.value.length, b.value.length); i++) {
    const d = (a.value[i] ?? 0) - (b.value[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

// Лучшая пятёрка из руки и стола (на столе от 3 до 5 карт)
export function bestHand(variant: Variant, hand: Card[], board: Card[]): HandResult {
  const ranks = deckRanks(variant)
  const all = parseAll([...hand, ...board], ranks)
  checkCounts(variant, hand.length, board.length)
  const own = all.slice(0, hand.length)
  const table = all.slice(hand.length)
  const fives =
    variant.fromHand === 'any'
      ? combinations(all, 5)
      : combinations(own, variant.fromHand).flatMap((h) => combinations(table, 5 - (variant.fromHand as number)).map((b) => [...h, ...b]))
  let best: HandResult | null = null
  for (const five of fives) {
    const r = evaluateFive(variant, ranks, five)
    if (!best || compareHands(r, best) > 0) best = r
  }
  return best as HandResult
}

function checkCounts(variant: Variant, hand: number, board: number) {
  if (board < 3 || board > 5) throw new Error(`На столе должно быть от 3 до 5 карт, а не ${board}`)
  if (variant.fromHand === 'any') {
    if (hand + board < 5) throw new Error('Карт руки и стола меньше пяти')
    return
  }
  const n = variant.fromHand
  if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error(`Неверное правило варианта: из руки ${n} карт`)
  if (hand < n) throw new Error(`В руке должно быть не меньше ${n} карт, а не ${hand}`)
  if (board < 5 - n) throw new Error(`На столе должно быть не меньше ${5 - n} карт, а не ${board}`)
}

export type Contender = { id: string; cards: Card[] }

// Победители на одном столе — все, у кого лучшая рука (при ничьей — несколько), в порядке contenders
export function winners(variant: Variant, board: Card[], contenders: Contender[]): string[] {
  parseAll([...board, ...contenders.flatMap((c) => c.cards)], deckRanks(variant))
  const results = contenders.map((c) => ({ id: c.id, hand: bestHand(variant, c.cards, board) }))
  let top: HandResult | null = null
  for (const r of results) if (!top || compareHands(r.hand, top) > 0) top = r.hand
  return results.filter((r) => top && compareHands(r.hand, top) === 0).map((r) => r.id)
}

// Лоу хай/лоу (#227, «восьмёрка или лучше»): пять карт пяти разных рангов, все не старше 8; туз — младший (1),
// стриты и флеши не мешают. Сравнение — от старшей карты вниз, меньше — лучше: лучший лоу — 5-4-3-2-A
export type LowResult = {
  cards: Card[] // пять карт лоу — от старшей к младшей, туз последним
  value: number[] // ранги от старшего, туз — 1: меньше — лучше
  name: string // «Лоу 8-6-4-3-A»
}

const LOW_MAX = 8

// > 0 — лоу a лучше (младше), < 0 — b лучше, 0 — ничья
export function compareLows(a: LowResult, b: LowResult): number {
  for (let i = 0; i < Math.max(a.value.length, b.value.length); i++) {
    const d = (b.value[i] ?? 0) - (a.value[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

// Лучший лоу из руки и стола по правилу варианта: «ровно N из руки» — ровно N своих и 5 − N со стола (выбор свой,
// не тот, что у старшей руки), «любые» — любые пять. Лоу не собрать — null
export function bestLow(variant: Variant, hand: Card[], board: Card[]): LowResult | null {
  const ranks = deckRanks(variant)
  const all = parseAll([...hand, ...board], ranks)
  checkCounts(variant, hand.length, board.length)
  // Годятся только карты не старше 8 (туз — младший); из одинаковых рангов хватит одной на ранг
  const low = (cards: Parsed[]) => cards.filter((c) => lowRank(c.rank) <= LOW_MAX)
  const own = low(all.slice(0, hand.length))
  const table = low(all.slice(hand.length))
  const fives =
    variant.fromHand === 'any'
      ? combinations([...own, ...table], 5)
      : combinations(own, variant.fromHand).flatMap((h) => combinations(table, 5 - (variant.fromHand as number)).map((b) => [...h, ...b]))
  let best: LowResult | null = null
  for (const five of fives) {
    const r = evaluateLow(five)
    if (r && (!best || compareLows(r, best) > 0)) best = r
  }
  return best
}

// Лоу на одном столе — все с лучшим лоу (при ничьей — несколько), в порядке contenders; лоу ни у кого нет — пусто
export function lowWinners(variant: Variant, board: Card[], contenders: Contender[]): string[] {
  parseAll([...board, ...contenders.flatMap((c) => c.cards)], deckRanks(variant))
  const results = contenders.map((c) => ({ id: c.id, low: bestLow(variant, c.cards, board) }))
  let top: LowResult | null = null
  for (const r of results) if (r.low && (!top || compareLows(r.low, top) > 0)) top = r.low
  return results.filter((r) => top && r.low && compareLows(r.low, top) === 0).map((r) => r.id)
}

const lowRank = (rank: number) => (rank === 14 ? 1 : rank)

function evaluateLow(five: Parsed[]): LowResult | null {
  const sorted = [...five].sort((a, b) => lowRank(b.rank) - lowRank(a.rank))
  const value = sorted.map((c) => lowRank(c.rank))
  if (new Set(value).size !== 5) return null
  const name = `Лоу ${sorted.map((c) => c.card[0]).join('-')}`
  return { cards: sorted.map((c) => c.card), value, name }
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]]
  const out: T[][] = []
  for (let i = 0; i <= items.length - k; i++) {
    for (const rest of combinations(items.slice(i + 1), k - 1)) out.push([items[i], ...rest])
  }
  return out
}

function evaluateFive(variant: Variant, ranks: number[], five: Parsed[]): HandResult {
  const counts = new Map<number, number>()
  for (const c of five) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
  // Ранги группами: сначала по размеру группы, затем по старшинству
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const shape = groups.map((g) => g[1]).join('')
  const flush = five.every((c) => c.suit === five[0].suit)
  const straightHigh = groups.length === 5 ? straightTop(ranks, groups.map((g) => g[0])) : 0

  let category: Category
  let tie: number[]
  if (straightHigh && flush) [category, tie] = ['straightFlush', [straightHigh]]
  else if (shape === '41') [category, tie] = ['quads', groups.map((g) => g[0])]
  else if (shape === '32') [category, tie] = ['fullHouse', groups.map((g) => g[0])]
  else if (flush) [category, tie] = ['flush', groups.map((g) => g[0])]
  else if (straightHigh) [category, tie] = ['straight', [straightHigh]]
  else if (shape === '311') [category, tie] = ['trips', groups.map((g) => g[0])]
  else if (shape === '221') [category, tie] = ['twoPair', groups.map((g) => g[0])]
  else if (shape === '2111') [category, tie] = ['pair', groups.map((g) => g[0])]
  else [category, tie] = ['high', groups.map((g) => g[0])]

  const place = variant.order.indexOf(category)
  if (place < 0) throw new Error(`В порядке старшинства варианта нет комбинации «${category}»`)
  // Карты: в порядке групп; в младшем стрите туз — последним
  const order = straightHigh ? straightOrder(straightHigh, ranks) : groups.map((g) => g[0])
  const cards = order.flatMap((r) => five.filter((c) => c.rank === r).map((c) => c.card))
  return { cards, category, value: [place, ...tie], name: handName(category, tie) }
}

// Старшая карта стрита или 0. Младший стрит — туз и четыре младших ранга колоды (A-2-3-4-5, A-6-7-8-9)
function straightTop(ranks: number[], desc: number[]): number {
  if (desc[0] - desc[4] === 4) return desc[0]
  const wheel = [14, ...ranks.slice(0, 4).reverse()]
  return desc.every((r, i) => r === wheel[i]) ? ranks[3] : 0
}

function straightOrder(high: number, ranks: number[]): number[] {
  if (high === ranks[3]) return [...ranks.slice(0, 4).reverse(), 14]
  return [high, high - 1, high - 2, high - 3, high - 4]
}

// Названия рангов: именительный, родительный, множественное, женский род
const RANK_NAMES: Record<number, [string, string, string, boolean]> = {
  2: ['двойка', 'двойки', 'двойки', true],
  3: ['тройка', 'тройки', 'тройки', true],
  4: ['четвёрка', 'четвёрки', 'четвёрки', true],
  5: ['пятёрка', 'пятёрки', 'пятёрки', true],
  6: ['шестёрка', 'шестёрки', 'шестёрки', true],
  7: ['семёрка', 'семёрки', 'семёрки', true],
  8: ['восьмёрка', 'восьмёрки', 'восьмёрки', true],
  9: ['девятка', 'девятки', 'девятки', true],
  10: ['десятка', 'десятки', 'десятки', true],
  11: ['валет', 'валета', 'валеты', false],
  12: ['дама', 'дамы', 'дамы', true],
  13: ['король', 'короля', 'короли', false],
  14: ['туз', 'туза', 'тузы', false],
}

const nom = (r: number) => RANK_NAMES[r][0]
const gen = (r: number) => RANK_NAMES[r][1]
const plural = (r: number) => RANK_NAMES[r][2]
const senior = (r: number) => `${RANK_NAMES[r][3] ? 'старшая' : 'старший'} ${nom(r)}`

function handName(category: Category, tie: number[]): string {
  switch (category) {
    case 'straightFlush':
      return tie[0] === 14 ? 'Роял-флеш' : `Стрит-флеш до ${gen(tie[0])}`
    case 'quads':
      return `Каре, ${plural(tie[0])}`
    case 'fullHouse':
      return `Фулл-хаус, ${plural(tie[0])} и ${plural(tie[1])}`
    case 'flush':
      return `Флеш, ${senior(tie[0])}`
    case 'straight':
      return `Стрит до ${gen(tie[0])}`
    case 'trips':
      return `Тройка, ${plural(tie[0])}`
    case 'twoPair':
      return `Две пары, ${plural(tie[0])} и ${plural(tie[1])}`
    case 'pair':
      return `Пара, ${plural(tie[0])}`
    case 'high':
      return `Старшая карта, ${nom(tie[0])}`
  }
}
