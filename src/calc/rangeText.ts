// Диапазон рук холдема текстом (#212, Р-73), как в PokerStove и Equilab: «77+, A9s+, AJo+, KTs-K8s, 22-55, AKs:0.5».
// Диапазон — веса 169 классов (0…1) в порядке сетки 13 × 13 (CLASSES): строка — старшая карта от туза,
// на диагонали — пары, выше неё — одномастные (s), ниже — разномастные (o).
// Куски — через запятую или пробел: класс («AA», «AKs», «AKo»; «AK» — обе), «+» (у пары — эта и старше,
// у «A9s+» — кикер до ранга под старшей), отрезок («KTs-K8s», «22-55» — в любом порядке), вес «:0.5».
// Класс дважды — побеждает последний кусок. Пустой текст — пустой диапазон
// Пример диапазона текстом — один на справку, калькулятор и «Загрузить текстом» чартов (#253)
export const RANGE_EXAMPLE = '77+, A9s+, AJo+, AKs:0.5'

export const RANKS_DOWN = 'AKQJT98765432'
export const RANGE_SIZE = 169

const rankValue = (r: string) => 14 - RANKS_DOWN.indexOf(r) // A — 14, 2 — 2
const rankChar = (v: number) => RANKS_DOWN[14 - v]

export const CLASSES: string[] = []
for (let i = 0; i < 13; i++) {
  for (let j = 0; j < 13; j++) {
    const a = RANKS_DOWN[i]
    const b = RANKS_DOWN[j]
    CLASSES.push(i === j ? a + b : i < j ? a + b + 's' : b + a + 'o')
  }
}
const CLASS_INDEX = new Map(CLASSES.map((c, i) => [c, i]))

// Номер класса в сетке («AKs» → 1); не класс — −1
export function classIndex(cls: string): number {
  return CLASS_INDEX.get(cls) ?? -1
}

export const emptyRange = (): number[] => new Array<number>(RANGE_SIZE).fill(0)
export const fullRange = (): number[] => new Array<number>(RANGE_SIZE).fill(1)

export type ParsedRange = { weights: number[] } | { error: string; piece: string }

const TOKEN = /^([2-9TJQKA])([2-9TJQKA])([SO]?)(?:(\+)|-([2-9TJQKA])([2-9TJQKA])([SO]?))?$/
const WEIGHT = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e-?\d+)?$/i // «0.5», «.25», «1»; «1e-7» — так пишет rangeText малые веса

const pairClass = (v: number) => rankChar(v) + rankChar(v)
const sideClass = (hi: number, lo: number, suit: string) => rankChar(hi) + rankChar(lo) + suit

// Классы куска без веса; не разобрать — null
function classesOf(body: string): string[] | null {
  const m = TOKEN.exec(body.toUpperCase())
  if (!m) return null
  const [, r1, r2, suffix, plus, r3, r4, suffix2] = m
  const a = rankValue(r1)
  const b = rankValue(r2)
  const out: string[] = []
  if (a === b) {
    if (suffix) return null
    let from = a
    let to = a
    if (plus) to = 14
    else if (r3) {
      if (r3 !== r4 || suffix2) return null
      from = Math.min(a, rankValue(r3))
      to = Math.max(a, rankValue(r3))
    }
    for (let v = from; v <= to; v++) out.push(pairClass(v))
    return out
  }
  const hi = Math.max(a, b)
  let from = Math.min(a, b)
  let to = from
  if (plus) to = hi - 1
  else if (r3) {
    const c = rankValue(r3)
    const d = rankValue(r4)
    if (c === d || Math.max(c, d) !== hi || suffix2 !== suffix) return null
    to = Math.max(from, Math.min(c, d))
    from = Math.min(from, Math.min(c, d))
  }
  const suits = suffix ? [suffix.toLowerCase()] : ['s', 'o']
  for (let lo = to; lo >= from; lo--) for (const s of suits) out.push(sideClass(hi, lo, s))
  return out
}

// Текст → веса 169 классов; кусок не разобран или вес вне 0…1 — ошибка с этим куском
export function parseRange(text: string): ParsedRange {
  const weights = emptyRange()
  const pieces = text
    .replace(/\s*([-:])\s*/g, '$1')
    .split(/[\s,;]+/)
    .filter((p) => p !== '')
  for (const piece of pieces) {
    const colon = piece.indexOf(':')
    const body = colon < 0 ? piece : piece.slice(0, colon)
    let weight = 1
    if (colon >= 0) {
      const w = piece.slice(colon + 1)
      weight = Number(w)
      if (!WEIGHT.test(w) || !(weight >= 0 && weight <= 1)) return { error: `Вес в «${piece}» — число от 0 до 1`, piece }
    }
    const classes = classesOf(body)
    if (!classes) return { error: `Не понял «${piece}»`, piece }
    for (const cls of classes) weights[classIndex(cls)] = weight
  }
  return { weights }
}

type Run = { top: number; bottom: number } // ранги, top ≥ bottom

function runs(has: (v: number) => boolean, top: number, bottom: number): Run[] {
  const out: Run[] = []
  for (let v = top; v >= bottom; v--) {
    if (!has(v)) continue
    const last = out.at(-1)
    if (last && last.bottom === v + 1) last.bottom = v
    else out.push({ top: v, bottom: v })
  }
  return out
}

// Куски одного веса: пары, затем по старшей карте — обе масти, одномастные, разномастные
function piecesOf(has: (cls: string) => boolean): string[] {
  const out: string[] = []
  for (const r of runs((v) => has(pairClass(v)), 14, 2)) {
    const t = pairClass(r.top)
    const b = pairClass(r.bottom)
    out.push(r.top === r.bottom ? t : r.top === 14 ? `${b}+` : `${t}-${b}`)
  }
  for (let hi = 14; hi >= 3; hi--) {
    const piece = (r: Run, s: string) => {
      const t = sideClass(hi, r.top, s)
      const b = sideClass(hi, r.bottom, s)
      return r.top === r.bottom ? t : r.top === hi - 1 ? `${b}+` : `${t}-${b}`
    }
    const suited = runs((v) => has(sideClass(hi, v, 's')), hi - 1, 2)
    const offsuit = runs((v) => has(sideClass(hi, v, 'o')), hi - 1, 2)
    const same = (r: Run) => (o: Run) => o.top === r.top && o.bottom === r.bottom
    for (const r of suited) if (offsuit.some(same(r))) out.push(piece(r, ''))
    for (const r of suited) if (!offsuit.some(same(r))) out.push(piece(r, 's'))
    for (const r of offsuit) if (!suited.some(same(r))) out.push(piece(r, 'o'))
  }
  return out
}

// Веса → короткий текст, который parseRange разбирает в те же веса: сначала вес 1, затем по убыванию веса
export function rangeText(weights: number[]): string {
  const levels = [...new Set(weights.filter((w) => w > 0))].sort((a, b) => b - a)
  const out: string[] = []
  for (const w of levels) {
    const tail = w === 1 ? '' : `:${String(w)}`
    for (const p of piecesOf((cls) => weights[classIndex(cls)] === w)) out.push(p + tail)
  }
  return out.join(', ')
}
