// Свои чарты «Тренажёра» (#215, Р-77): правка встроенного, новый с нуля, загрузка текстом и файлом, выгрузка.
// Хранятся на телефоне (IndexedDB, хранилище charts) и входят в копию данных. Встроенный набор не меняется:
// правка встроенного сохраняется своим чартом с base — ключом его ситуации («CO|UTG raise 2bb»).
// cells — по классу руки доли действий 0…1 в порядке actions, в сумме 1; класса нет — руки нет в ситуации.
// Своему чарту «доходит» не нужно: рука в нём или есть целиком, или её нет
import { isChartAction, TWELFTHS, unpackNode, type ChartGrid, type PackedNode } from './charts'
import { CLASSES } from './rangeText'

export type OwnChart = {
  id: string
  name: string
  base: string | null // ключ встроенной ситуации (situationKey) или null — заведён с нуля
  actions: string[] // первым — «fold», как у встроенных
  cells: Record<string, number[]>
  updatedAt: string // ISO 8601
}

// Правка на экране — то же без id и времени
export type ChartDraft = Pick<OwnChart, 'name' | 'base' | 'actions' | 'cells'>

const EPS = 1e-6
const QUARTER = 0.25
export const NAME_MAX = 60

// Доли — без хвостов вида 0,30000000000000004
const tidy = (x: number) => Math.round(x * 1e9) / 1e9

// Имя: пробелы по краям и двойные убраны, не длиннее NAME_MAX; пустое — пустая строка
export const chartName = (raw: string): string => raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)

// Встроенное решение → доли своего чарта: двенадцатые в доли 0…1, рука, что не доходит, — нет руки
export function builtinCells(node: PackedNode): Record<string, number[]> {
  const chart = unpackNode(node)
  const cells: Record<string, number[]> = {}
  chart.hands.forEach((hand, k) => {
    if (hand) cells[CLASSES[k]] = hand.strategy.map((s) => tidy(s / TWELFTHS))
  })
  return cells
}

// Свой чарт → сетка и легенда экрана: рука есть — доходит целиком (reach 12), доли × 12
export function ownChartGrid(chart: Pick<OwnChart, 'actions' | 'cells'>): ChartGrid {
  return {
    actions: chart.actions,
    hands: CLASSES.map((cls) => {
      const shares = chart.cells[cls]
      return shares ? { reach: TWELFTHS, strategy: shares.map((s) => s * TWELFTHS) } : null
    }),
  }
}

export function sameCells(a: Record<string, number[]>, b: Record<string, number[]>): boolean {
  return CLASSES.every((cls) => {
    const x = a[cls]
    const y = b[cls]
    if (!x || !y) return !x && !y
    return x.length === y.length && x.every((s, i) => Math.abs(s - y[i]) < EPS)
  })
}

// Действия нового чарта: пас всегда первым, дальше — колл, рейзы по возрастанию размера, олл-ин
export function newChartActions(pick: { call: boolean; raises: number[]; allin: boolean }): string[] {
  const raises = [...new Set(pick.raises)].sort((a, b) => a - b).map((bb) => `raise ${String(bb)}bb`)
  return ['fold', ...(pick.call ? ['call'] : []), ...raises, ...(pick.allin ? ['allin'] : [])]
}

// Размер рейза словами пользователя: «2,5», «3 bb», «7.5» → ББ с одной цифрой после запятой; не так — null
export function parseRaiseBB(text: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d)?)\s*(?:bb|бб)?\s*$/i.exec(text)
  if (!m) return null
  const bb = Number(m[1].replace(',', '.'))
  return bb >= 1 && bb <= 100 ? bb : null
}

// Новый чарт: каждая рука есть и пасует целиком — дальше правка или загрузка текстом
export function emptyCells(actions: string[]): Record<string, number[]> {
  const cells: Record<string, number[]> = {}
  for (const cls of CLASSES) cells[cls] = actions.map((_, i) => (i === 0 ? 1 : 0))
  return cells
}

// Кому отдать или у кого взять долю: пас, а у самого паса — первое действие после него
const partner = (i: number) => (i === 0 ? 1 : 0)

// «+» у действия: до следующей отметки 25 %, недостающее берётся у паса, затем у других действий с конца.
// Отдать некому — без изменений
export function stepUp(shares: number[], i: number): number[] {
  const next = [...shares]
  const target = Math.min(1, Math.floor(next[i] / QUARTER + EPS) * QUARTER + QUARTER)
  let need = target - next[i]
  const donors = [partner(i), ...next.map((_, j) => j).reverse().filter((j) => j !== i && j !== partner(i))]
  for (const j of donors) {
    if (need < EPS) break
    const take = Math.min(need, next[j])
    next[j] -= take
    next[i] += take
    need -= take
  }
  return next.map(tidy)
}

// «−» у действия: до прежней отметки 25 %, отданное — пасу (у паса — первому действию после него)
export function stepDown(shares: number[], i: number): number[] {
  if (shares.length < 2) return shares
  const next = [...shares]
  const target = Math.max(0, Math.ceil(next[i] / QUARTER - EPS) * QUARTER - QUARTER)
  const give = next[i] - target
  next[i] -= give
  next[partner(i)] += give
  return next.map(tidy)
}

// «Загрузить текстом» (одно действие за раз): доля класса из диапазона ложится на действие action (не пас),
// остаток клетки — пас. Прочие действия руки остаются, а не влезают — урезаются в той же пропорции.
// Класса нет в диапазоне — доля действия 0; руки нет в чарте и в диапазоне её нет — её и не будет
export function applyRange(
  cells: Record<string, number[]>,
  actions: string[],
  action: number,
  weights: number[],
): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  CLASSES.forEach((cls, k) => {
    const w = weights[k] ?? 0
    const cur = cells[cls]
    if (!cur && w === 0) return
    const base = cur ?? actions.map((_, i) => (i === 0 ? 1 : 0))
    const others = base.reduce((sum, s, j) => (j === 0 || j === action ? sum : sum + s), 0)
    const scale = others > 1 - w ? (1 - w) / others : 1
    const next = base.map((s, j) => (j === 0 || j === action ? 0 : s * scale))
    next[action] = w
    next[0] = Math.max(0, 1 - next.reduce((a, b) => a + b, 0))
    out[cls] = next.map(tidy)
  })
  return out
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const CLASS_SET = new Set(CLASSES)

// Что не так со своим чартом (из копии или файла) — словами; всё верно — null
export function chartProblem(v: unknown): string | null {
  if (!isObject(v)) return 'не чарт'
  if (typeof v.id !== 'string' || v.id === '') return 'нет id'
  if (typeof v.name !== 'string' || chartName(v.name) === '') return 'нет имени'
  if (!(v.base === null || typeof v.base === 'string')) return 'ситуация не читается'
  if (typeof v.updatedAt !== 'string') return 'нет времени правки'
  const actions = v.actions
  if (!Array.isArray(actions) || actions.length < 2 || actions[0] !== 'fold') return 'действия — пас и хотя бы одно ещё'
  if (!actions.every((a) => typeof a === 'string' && isChartAction(a))) return 'действие не разобрано'
  if (new Set(actions).size !== actions.length) return 'действие дважды'
  if (!isObject(v.cells)) return 'нет рук'
  for (const [cls, shares] of Object.entries(v.cells)) {
    if (!CLASS_SET.has(cls)) return `рука «${cls}» не разобрана`
    if (!Array.isArray(shares) || shares.length !== actions.length) return `у ${cls} долей не столько, сколько действий`
    if (!shares.every((s) => typeof s === 'number' && s >= 0 && s <= 1)) return `у ${cls} доля не от 0 до 1`
    if (Math.abs(shares.reduce((a: number, b: number) => a + b, 0) - 1) > EPS) return `у ${cls} доли не в сумме 100 %`
  }
  return null
}

export const isOwnChart = (v: unknown): v is OwnChart => chartProblem(v) === null

// Файл выгрузки: пометка приложения, что это чарт, версия формата — и сам чарт
export const CHART_FILE_KIND = 'chart'
export const CHART_FILE_FORMAT = 1
const APP = 'magic_fishki'

export function chartFileText(chart: OwnChart): string {
  return JSON.stringify({ app: APP, kind: CHART_FILE_KIND, format: CHART_FILE_FORMAT, chart }, null, 2)
}

// «chart-Мой BTN.json»: знаки, которых не любят файлы, — дефисом
export function chartFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'чарт'
  return `chart-${safe}.json`
}

export type ParsedChartFile = { ok: true; chart: OwnChart } | { ok: false; error: string }

// Текст файла → чарт или понятная ошибка
export function parseChartFile(text: string): ParsedChartFile {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return { ok: false, error: 'Файл не читается: это не чарт «Фишек» или он повреждён' }
  }
  if (!isObject(data) || data.app !== APP || data.kind !== CHART_FILE_KIND) return { ok: false, error: 'Это не чарт «Фишек»' }
  if (typeof data.format !== 'number' || !Number.isInteger(data.format) || data.format < 1) {
    return { ok: false, error: 'Чарт повреждён: не указана версия' }
  }
  if (data.format > CHART_FILE_FORMAT) return { ok: false, error: 'Чарт из более новой версии «Фишек» — обновите приложение' }
  const problem = chartProblem(data.chart)
  if (problem !== null) return { ok: false, error: `Чарт повреждён: ${problem}` }
  const chart = data.chart as OwnChart
  return { ok: true, chart: { ...chart, name: chartName(chart.name) } }
}

// «Мои чарты» — по имени, одинаковые имена — по времени правки
export function byName(charts: OwnChart[]): OwnChart[] {
  return [...charts].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.updatedAt.localeCompare(b.updatedAt))
}
