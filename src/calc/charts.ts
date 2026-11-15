// Чарты префлопа «Тренажёра» (#214, Р-76): набор Leakproof 6max-100bb-norake 1.0.0 (CC BY 4.0) — в свой формат
// и в слова экрана. Набор лежит как есть (data/leakproof/nodes.json); packCharts переводит его в компактный вид,
// npm run charts (scripts/charts.ts) пишет перевод в chartsData.ts, тест сверяет файл с переводом. Доли не правятся.
// Ситуация — ход actor после line («CO raise 2.5bb, BTN raise 7.5bb»); у класса руки — reach (какая доля его
// сочетаний доходит до ситуации) и доли действий actions. Все доли в наборе — целые двенадцатые
import { combosOf, HAND_ORDER } from './botRanges'
import { formatBB, formatNumber, pluralForm } from './format'
import { CLASSES } from './rangeText'
import { ALL_COMBOS } from './trainerView'

export const CHART_POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const
export type ChartPosition = (typeof CHART_POSITIONS)[number]

// Решение набора, как в nodes.json; остальные его поля (history, raises, pot_bb, to_call_bb) переводу не нужны
export type LeakproofNode = {
  line: string
  actor: string
  actions: string[]
  classes: Record<string, { reach: number; strategy: number[] }>
}

// Решение в своём формате: cells — по классам HAND_ORDER подряд цифра reach и цифры долей действий
// (0…c — двенадцатые); класса в ситуации нет — одни нули
export type PackedNode = { actor: ChartPosition; line: string; actions: string[]; cells: string }
export type ChartPack = PackedNode[]

export const TWELFTHS = 12
const DIGITS = '0123456789abc'

function twelfths(x: number, where: string): number {
  const n = Math.round(x * TWELFTHS)
  if (!(Math.abs(x * TWELFTHS - n) < 1e-3) || n < 0 || n > TWELFTHS) throw new Error(`${where}: ${x} — не целые двенадцатые`)
  return n
}

const isPosition = (s: string): s is ChartPosition => (CHART_POSITIONS as readonly string[]).includes(s)

const ACTION = /^(?:fold|call|allin|raise \d+(?:\.\d+)?bb)$/
// Действие набора: «fold», «call», «allin», «raise 7.5bb» — так же и у своих чартов (#215)
export const isChartAction = (a: string): boolean => ACTION.test(a)
// Ключ встроенной ситуации: «CO|UTG raise 2bb» — им свой чарт помнит, из какой ситуации сделан (#215, base)
export const situationKey = (node: { actor: string; line: string }): string => `${node.actor}|${node.line}`
const STEP = /^(UTG|HJ|CO|BTN|SB|BB) (?:raise (\d+(?:\.\d+)?)bb|allin)$/

// Ход до ситуации: кто и до скольких ББ повысил; bb — null у олл-ина
export type ChartStep = { pos: ChartPosition; bb: number | null }

// «UTG raise 2bb, BB allin» → ходы; пусто — никто не входил; другой ход — ошибка (в наборе только повышения)
export function lineSteps(line: string): ChartStep[] {
  if (line === '') return []
  return line.split(', ').map((part) => {
    const m = STEP.exec(part)
    if (!m) throw new Error(`Ход «${part}» не разобран`)
    return { pos: m[1] as ChartPosition, bb: m[2] === undefined ? null : Number(m[2]) }
  })
}

// Набор → свой формат; что-то не так (позиция, ход, действие, класс, доли не двенадцатые или не в сумме 1) — ошибка
export function packCharts(nodes: LeakproofNode[]): ChartPack {
  const seen = new Set<string>()
  return nodes.map((node) => {
    const where = `${node.actor} после «${node.line}»`
    if (!isPosition(node.actor)) throw new Error(`${where}: позиция не из шести`)
    const key = situationKey(node)
    if (seen.has(key)) throw new Error(`${where}: ситуация дважды`)
    seen.add(key)
    lineSteps(node.line)
    for (const a of node.actions) if (!isChartAction(a)) throw new Error(`${where}: действие «${a}» не разобрано`)
    for (const cls of Object.keys(node.classes)) if (!HAND_ORDER.includes(cls)) throw new Error(`${where}: класс «${cls}»`)
    const cells = HAND_ORDER.map((cls) => {
      const c = node.classes[cls]
      if (!c) return '0'.repeat(1 + node.actions.length)
      if (c.strategy.length !== node.actions.length) throw new Error(`${where}, ${cls}: долей не столько, сколько действий`)
      const reach = twelfths(c.reach, `${where}, ${cls}, reach`)
      if (reach === 0) throw new Error(`${where}, ${cls}: reach — ноль`)
      const strategy = c.strategy.map((s) => twelfths(s, `${where}, ${cls}`))
      if (strategy.reduce((a, b) => a + b, 0) !== TWELFTHS) throw new Error(`${where}, ${cls}: доли не в сумме 1`)
      return DIGITS[reach] + strategy.map((s) => DIGITS[s]).join('')
    }).join('')
    return { actor: node.actor, line: node.line, actions: [...node.actions], cells }
  })
}

// Текст файла chartsData.ts — его пишет npm run charts; решение — строкой
export function chartsModuleText(pack: ChartPack): string {
  return [
    '// Создано npm run charts (scripts/charts.ts) из data/leakproof/nodes.json — руками не править.',
    '// Набор: Leakproof 6max-100bb-norake 1.0.0 (CC BY 4.0), преобразован в свой формат (src/calc/charts.ts, packCharts)',
    "import type { ChartPack } from './charts'",
    '',
    'export const LEAKPROOF: ChartPack = [',
    ...pack.map((node) => `  ${JSON.stringify(node)},`),
    ']',
    '',
  ].join('\n')
}

// Класс руки в ситуации: доходит reach двенадцатых сочетаний, доли действий — двенадцатые
// (у своих чартов, #215, — доля × 12, может быть дробной; reach у них всегда 12)
export type ChartHand = { reach: number; strategy: number[] }
// Решение для экрана: hands — по клеткам сетки CLASSES; null — руки в ситуации нет
export type Chart = { actor: ChartPosition; line: string; actions: string[]; hands: (ChartHand | null)[] }
// Что нужно сетке и легенде — у встроенного и у своего чарта
export type ChartGrid = Pick<Chart, 'actions' | 'hands'>

export function unpackNode(node: PackedNode): Chart {
  const width = 1 + node.actions.length
  const byClass = new Map<string, ChartHand>()
  HAND_ORDER.forEach((cls, i) => {
    const part = node.cells.slice(i * width, (i + 1) * width)
    const reach = DIGITS.indexOf(part[0])
    if (reach > 0) byClass.set(cls, { reach, strategy: [...part.slice(1)].map((d) => DIGITS.indexOf(d)) })
  })
  return { actor: node.actor, line: node.line, actions: node.actions, hands: CLASSES.map((cls) => byClass.get(cls) ?? null) }
}

// «7,5 ББ»
const bbText = (bb: number) => formatBB(Math.round(bb * 10), 10)

// Повышение k-е по счёту (1 — открытие, 2 — 3-бет…) или олл-ин — словом
const raiseWord = (s: ChartStep, k: number) => (s.bb === null ? 'олл-ин' : `${k + 1}-бет`)
const sizeOf = (s: ChartStep) => (s.bb === null ? '' : ` (${bbText(s.bb)})`)

// «Что было до меня» словами: «Никто не входил», «Открылся CO (2,5 ББ)», «Я открылся, 3-бет от BB (14 ББ)»,
// «Я сделал 3-бет, 4-бет от CO (20 ББ)», «Я сделал 4-бет, олл-ин от BTN»
export function situationLabel(actor: ChartPosition, line: string): string {
  const steps = lineSteps(line)
  if (steps.length === 0) return 'Никто не входил'
  const mine = steps.map((s) => s.pos).lastIndexOf(actor)
  const after = (from: number) => steps.slice(from).map((s, j) => `${raiseWord(s, from + j + 1)} от ${s.pos}${sizeOf(s)}`)
  if (mine < 0) {
    const first = steps[0]
    const open = first.bb === null ? `Олл-ин от ${first.pos}` : `Открылся ${first.pos}${sizeOf(first)}`
    return [open, ...after(1)].join(', ')
  }
  const me = steps[mine]
  const my = me.bb === null ? 'Я пошёл в олл-ин' : mine === 0 ? 'Я открылся' : `Я сделал ${mine + 2}-бет`
  return [my, ...after(mine + 1)].join(', ')
}

export type Situation = { index: number; label: string } // index — номер решения в наборе

// Ситуации позиции по порядку: сначала меньше повышений, повышение перед олл-ином, затем по позициям ходивших
export function chartSituations(pack: ChartPack, actor: ChartPosition): Situation[] {
  const keyed = pack.flatMap((node, index) => {
    if (node.actor !== actor) return []
    const steps = lineSteps(node.line)
    const key = [steps.length, steps.at(-1)?.bb === null ? 1 : 0, ...steps.map((s) => CHART_POSITIONS.indexOf(s.pos))]
    return [{ index, label: situationLabel(actor, node.line), key }]
  })
  keyed.sort((a, b) => {
    for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
      const d = (a.key[i] ?? -1) - (b.key[i] ?? -1)
      if (d !== 0) return d
    }
    return 0
  })
  return keyed.map(({ index, label }) => ({ index, label }))
}

export type ActionKind = 'fold' | 'call' | 'raise' | 'allin'
export const actionKind = (a: string): ActionKind => (a.startsWith('raise') ? 'raise' : (a as ActionKind))

// Действие словом: «Пас», «Колл», «Рейз 7,5 ББ», «Олл-ин»
export function actionLabel(a: string): string {
  const kind = actionKind(a)
  if (kind === 'raise') return `Рейз ${bbText(Number(a.slice('raise '.length, -'bb'.length)))}`
  return { fold: 'Пас', call: 'Колл', allin: 'Олл-ин' }[kind]
}

const KIND_WORDS: Record<ActionKind, string> = { fold: 'пас', call: 'колл', raise: 'рейз', allin: 'олл-ин' }
const twelfthPercent = (n: number) => formatNumber(Math.round((n * 100) / TWELFTHS))

// Касание клетки: «AKs: рейз 75 % · олл-ин 25 %»; доходит не всегда — « · доходит 25 %»; руки нет — словами
export function handText(cls: string, hand: ChartHand | null, actions: string[]): string {
  if (!hand) return `${cls}: в эту ситуацию не доходит`
  const parts = actions.flatMap((a, i) => (hand.strategy[i] > 0 ? [`${KIND_WORDS[actionKind(a)]} ${twelfthPercent(hand.strategy[i])} %`] : []))
  if (hand.reach < TWELFTHS) parts.push(`доходит ${twelfthPercent(hand.reach)} %`)
  return `${cls}: ${parts.join(' · ')}`
}

// Полосы клетки слева направо в порядке действий: от и до, проценты ширины; нулевых нет
export function handStripes(hand: ChartHand, actions: string[]): { kind: ActionKind; from: number; to: number }[] {
  const out: { kind: ActionKind; from: number; to: number }[] = []
  let at = 0
  actions.forEach((a, i) => {
    const s = hand.strategy[i]
    if (s === 0) return
    out.push({ kind: actionKind(a), from: (at * 100) / TWELFTHS, to: ((at + s) * 100) / TWELFTHS })
    at += s
  })
  return out
}

export type LegendRow = { kind: ActionKind; label: string; combos: number; share: number }

// Легенда: сочетаний, дошедших до ситуации (класс × reach), и по действию — сочетаний и доля от дошедших
export function chartLegend(chart: ChartGrid):{ reached: number; rows: LegendRow[] } {
  let reached = 0
  const combos = chart.actions.map(() => 0)
  chart.hands.forEach((hand, k) => {
    if (!hand) return
    const n = (combosOf(CLASSES[k]) * hand.reach) / TWELFTHS
    reached += n
    hand.strategy.forEach((s, i) => (combos[i] += (n * s) / TWELFTHS))
  })
  const rows = chart.actions.map((a, i) => ({
    kind: actionKind(a),
    label: actionLabel(a),
    combos: combos[i],
    share: reached > 0 ? combos[i] / reached : 0,
  }))
  return { reached, rows }
}

// Одна цифра после запятой, без «,0»: 18,1 · 100 · 0,5
function tenths(n: number): string {
  const t = Math.round(n * 10)
  return t % 10 === 0 ? formatNumber(t / 10) : `${formatNumber(Math.trunc(t / 10))},${t % 10}`
}

// «18,1 %»
export const sharePercentText = (share: number): string => `${tenths(share * 100)} %`

// «240 сочетаний», дробное — «0,8 сочетания»
export function combosText(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 1e-9
  const word = whole ? pluralForm(Math.round(n), 'сочетание', 'сочетания', 'сочетаний') : 'сочетания'
  return `${tenths(n)} ${word}`
}

// Над легендой: сколько рук доходит до ситуации — от них доли действий
export function reachedText(reached: number): string {
  return `Доходит до ситуации: ${combosText(reached)} из ${formatNumber(ALL_COMBOS)} (${sharePercentText(reached / ALL_COMBOS)} рук); доли — от дошедших`
}
