// Эквити тренажёра (#212, Р-73): сколько банка в среднем берёт каждая сторона — конкретная рука или диапазон
// (веса 169 классов, rangeText) — при досдаче борда до 5 карт. Только безлимитный холдем.
// Раскладка — по сочетанию у каждой стороны без общих карт между собой и с бортом; её вес — произведение
// весов классов. Выигрыш — вся досдача, ничья на k — по 1/k банка.
// Раскладок × досдач не больше samples — полный перебор (на борде из 5 карт — раскладок до RIVER_EXACT),
// иначе — выборка samples досдач с зерном из входа: одни и те же входы — один и тот же ответ
import { buildDeck, HOLDEM, type Card } from '../poker/cards'
import { handScore, hash, random, SAMPLES } from './allInOdds'
import { COMBOS, comboIndex, handClass } from './botRanges'
import { classIndex, RANGE_SIZE } from './rangeText'

// На борде из 5 карт досдач нет, а сила каждого сочетания считается один раз — точно перебираются
// и две стороны с любыми диапазонами (1326 × 1326)
export const RIVER_EXACT = 3_000_000
// Выборка: попыток раскладки (часть отбрасывается — общие карты) не больше samples × этого
const ATTEMPTS = 200

export type EquitySide = { cards: Card[] } | { range: number[] }
// Доли от 0 до 1: банка (share), раскладок, где сторона выиграла одна (win) и поделила банк (tie)
export type SideEquity = { share: number; win: number; tie: number }
export type RangeEquity =
  | { ok: true; exact: boolean; runs: number; sides: SideEquity[] }
  | { ok: false; reason: string }

const DECK = buildDeck(HOLDEM)
const CARD_INDEX = new Map(DECK.map((c, i) => [c, i]))
const COMBO_A = Int32Array.from(COMBOS, (c) => CARD_INDEX.get(c.a) ?? -1)
const COMBO_B = Int32Array.from(COMBOS, (c) => CARD_INDEX.get(c.b) ?? -1)
const COMBO_CLASS = Int32Array.from(COMBOS, (c) => classIndex(handClass(c.a, c.b)))

const no = (reason: string): RangeEquity => ({ ok: false, reason })

function binomial(n: number, k: number): number {
  let out = 1
  for (let i = 0; i < k; i++) out = (out * (n - i)) / (i + 1)
  return Math.round(out)
}

// Сочетания стороны и их веса; карты борда и конкретных рук других сторон — вне игры
type Pool = { combos: Int32Array; weights: Float64Array }

function poolOf(side: EquitySide, dead: Set<number>): Pool {
  if ('cards' in side) return { combos: Int32Array.of(comboIndex(side.cards[0], side.cards[1])), weights: Float64Array.of(1) }
  const combos: number[] = []
  const weights: number[] = []
  for (let c = 0; c < COMBOS.length; c++) {
    const w = side.range[COMBO_CLASS[c]]
    if (w > 0 && !dead.has(COMBO_A[c]) && !dead.has(COMBO_B[c])) {
      combos.push(c)
      weights.push(w)
    }
  }
  return { combos: Int32Array.from(combos), weights: Float64Array.from(weights) }
}

// Проверка входа: что не так — словами, всё верно — null
function problem(sides: EquitySide[], board: Card[]): string | null {
  if (sides.length < 2 || sides.length > 6) return 'Сторон должно быть от 2 до 6'
  if (![0, 3, 4, 5].includes(board.length)) return 'На борде — 0, 3, 4 или 5 карт'
  const known = [...board]
  for (let s = 0; s < sides.length; s++) {
    const side = sides[s]
    if ('cards' in side) {
      if (side.cards.length !== 2) return `Сторона ${s + 1}: в руке должно быть 2 карты`
      known.push(...side.cards)
    } else if (side.range.length !== RANGE_SIZE || !side.range.every((w) => Number.isFinite(w) && w >= 0 && w <= 1)) {
      return `Сторона ${s + 1}: диапазон — ${RANGE_SIZE} весов от 0 до 1`
    }
  }
  const bad = known.find((c) => !CARD_INDEX.has(c))
  if (bad !== undefined) return `Нет такой карты: «${bad}»`
  const twice = known.find((c, i) => known.indexOf(c) !== i)
  if (twice !== undefined) return `Карта ${twice} — дважды`
  return null
}

export function rangeEquity(sides: EquitySide[], board: Card[], samples = SAMPLES): RangeEquity {
  const why = problem(sides, board)
  if (why) return no(why)
  const n = sides.length
  const dead = new Set<number>(board.map((c) => CARD_INDEX.get(c) as number))
  for (const side of sides) if ('cards' in side) side.cards.forEach((c) => dead.add(CARD_INDEX.get(c) as number))
  const pools = sides.map((side) => poolOf(side, dead))
  const empty = pools.findIndex((p) => p.combos.length === 0)
  if (empty >= 0) return no(`Сторона ${empty + 1}: пустой диапазон — нет рук без карт борда и других рук`)

  const need = 5 - board.length
  const full = [...board, ...new Array<Card>(need).fill('')]
  const used = new Uint8Array(DECK.length)
  for (const c of board) used[CARD_INDEX.get(c) as number] = 1
  const chosen = new Int32Array(n)

  // Сила сочетания на полном борде; на борде из 5 карт — одна на всё время счёта
  const riverScore = new Float64Array(COMBOS.length).fill(-1)
  const scoreOf = (c: number): number => {
    if (need > 0) return handScore(HOLDEM, [COMBOS[c].a, COMBOS[c].b], full)
    if (riverScore[c] < 0) riverScore[c] = handScore(HOLDEM, [COMBOS[c].a, COMBOS[c].b], board)
    return riverScore[c]
  }

  const share = new Float64Array(n)
  const win = new Float64Array(n)
  const tie = new Float64Array(n)
  const score = new Float64Array(n)
  let total = 0
  let runs = 0
  const showdown = (w: number) => {
    let top = -1
    let count = 0
    for (let p = 0; p < n; p++) {
      const s = scoreOf(chosen[p])
      score[p] = s
      if (s > top) {
        top = s
        count = 1
      } else if (s === top) count++
    }
    for (let p = 0; p < n; p++) {
      if (score[p] !== top) continue
      share[p] += w / count
      if (count === 1) win[p] += w
      else tie[p] += w
    }
    total += w
    runs++
  }
  const restCards = (): number[] => {
    const rest: number[] = []
    for (let i = 0; i < DECK.length; i++) if (!used[i]) rest.push(i)
    return rest
  }

  const assignments = pools.reduce((p, pool) => p * pool.combos.length, 1)
  const runouts = binomial(DECK.length - board.length - 2 * n, need)
  const exact = need === 0 ? assignments <= RIVER_EXACT : assignments * runouts <= samples

  if (exact) {
    // Полный перебор: раскладки — от стороны с меньшим числом сочетаний, на каждую — все досдачи
    const order = Array.from(pools.keys()).sort((a, b) => pools[a].combos.length - pools[b].combos.length)
    const deal = (w: number) => {
      if (need === 0) return showdown(w)
      const rest = restCards()
      const idx = Array.from({ length: need }, (_, k) => k)
      for (;;) {
        for (let k = 0; k < need; k++) full[board.length + k] = DECK[rest[idx[k]]]
        showdown(w)
        let k = need - 1
        while (k >= 0 && idx[k] === rest.length - need + k) k--
        if (k < 0) break
        idx[k]++
        for (let j = k + 1; j < need; j++) idx[j] = idx[j - 1] + 1
      }
    }
    const walk = (depth: number, w: number) => {
      if (depth === n) return deal(w)
      const s = order[depth]
      const { combos, weights } = pools[s]
      for (let k = 0; k < combos.length; k++) {
        const c = combos[k]
        const a = COMBO_A[c]
        const b = COMBO_B[c]
        if (used[a] || used[b]) continue
        used[a] = used[b] = 1
        chosen[s] = c
        walk(depth + 1, w * weights[k])
        used[a] = used[b] = 0
      }
    }
    walk(0, 1)
  } else {
    // Выборка: у каждой стороны сочетание по весам, раскладка с общими картами отбрасывается —
    // так у раскладки вероятность по произведению весов; досдача — частичное тасование остатка
    const next = random(hash(JSON.stringify([board, sides, samples])))
    const cums = pools.map((p) => {
      const cum = new Float64Array(p.weights.length)
      let sum = 0
      p.weights.forEach((w, i) => (cum[i] = sum += w))
      return cum
    })
    const pick = (cum: Float64Array) => {
      const x = next() * cum[cum.length - 1]
      let lo = 0
      let hi = cum.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cum[mid] > x) hi = mid
        else lo = mid + 1
      }
      return lo
    }
    for (let attempt = 0; runs < samples && attempt < samples * ATTEMPTS; attempt++) {
      let taken = 0
      for (; taken < n; taken++) {
        const c = pools[taken].combos[pick(cums[taken])]
        const a = COMBO_A[c]
        const b = COMBO_B[c]
        if (used[a] || used[b]) break
        used[a] = used[b] = 1
        chosen[taken] = c
      }
      if (taken === n) {
        const rest = restCards()
        for (let k = 0; k < need; k++) {
          const j = k + Math.floor(next() * (rest.length - k))
          const t = rest[k]
          rest[k] = rest[j]
          rest[j] = t
          full[board.length + k] = DECK[rest[k]]
        }
        showdown(1)
      }
      for (let p = 0; p < taken; p++) used[COMBO_A[chosen[p]]] = used[COMBO_B[chosen[p]]] = 0
    }
  }

  if (runs === 0 || total <= 0) return no('Нет ни одной раскладки без общих карт')
  return {
    ok: true,
    exact,
    runs,
    sides: Array.from(share, (s, p) => ({ share: s / total, win: win[p] / total, tie: tie[p] / total })),
  }
}
