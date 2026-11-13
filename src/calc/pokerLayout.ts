// Вид стола покера: кто где сидит вокруг овала, ползунок ставки и что лежит в панели внизу экрана.
// Только числа и подписи для экрана — правил не держит: границы ставки берёт из RaiseView (pokerView.ts)
import { formatBB, formatNumber, stackText } from './format'

export type Spot = { x: number; y: number } // проценты слоя мест: x — слева, y — сверху

// Точки по номеру места (#98): точек — на все «Мест за столом», и занятых, и свободных; моё место —
// точка 0 (внизу по центру), дальше по номерам мест по часовой. Меня за столом нет — внизу место 0.
// Элемент k — точка места k: пересел — точка другая, остальные стоят где стояли
export function spotsBySeat(maxSeats: number, mySeat: number | null): Spot[] {
  const spots = seatSpots(maxSeats)
  const n = spots.length
  const shift = mySeat ?? 0
  return spots.map((_, k) => spots[(((k - shift) % n) + n) % n])
}

// Сколько места занимает место у стола, в процентах слоя мест, на самом тесном экране — телефоне
// 360×640 с панелью хода (на 320 px по ширине — так же): соседи не ближе этого по ширине или по высоте
export const SEAT_W = 31
export const SEAT_H = 30

// Готовые точки на каждое число мест (#97), как у покерных клиентов: я внизу по центру, остальные
// по часовой — столбиком вверх по левому краю, по верху, столбиком вниз по правому. Левый столбик —
// снизу вверх, верх — слева направо; правый столбик — зеркало левого. Соседи по столбику — не ближе
// SEAT_H по высоте, по верху — не ближе SEAT_W по ширине: на узком телефоне стол ниже, чем был овал
// с местами по кругу, и девять–десять мест по кругу наезжали бы друг на друга
const SPOTS: { left: Spot[]; top: Spot[] }[] = [
  { left: [], top: [] }, // 1 — только я
  { left: [], top: [{ x: 50, y: 0 }] },
  { left: [{ x: 0, y: 25 }], top: [] },
  { left: [{ x: 0, y: 45 }], top: [{ x: 50, y: 0 }] },
  { left: [{ x: 0, y: 62 }], top: [{ x: 30, y: 0 }, { x: 70, y: 0 }] },
  { left: [{ x: 0, y: 72 }, { x: 0, y: 24 }], top: [{ x: 50, y: 0 }] },
  { left: [{ x: 0, y: 76 }, { x: 0, y: 34 }], top: [{ x: 32, y: 0 }, { x: 68, y: 0 }] },
  { left: [{ x: 2, y: 90 }, { x: 0, y: 52 }, { x: 0, y: 14 }], top: [{ x: 50, y: 0 }] },
  { left: [{ x: 2, y: 92 }, { x: 0, y: 56 }, { x: 0, y: 20 }], top: [{ x: 33, y: 0 }, { x: 67, y: 0 }] },
  { left: [{ x: 3, y: 100 }, { x: 0, y: 67 }, { x: 0, y: 33 }, { x: 3, y: 0 }], top: [{ x: 50, y: 0 }] },
]

// Точки n мест по порядку: 0 — внизу по центру, дальше по часовой — влево, вверх, вправо.
// Мест больше, чем в готовых, — по кругу овала
export function seatSpots(n: number): Spot[] {
  const k = Math.max(1, Math.round(n))
  const set = SPOTS[k - 1]
  if (!set) return Array.from({ length: k }, (_, i) => ovalSpot(i, k))
  const right = [...set.left].reverse().map((p) => ({ x: 100 - p.x, y: p.y }))
  return [{ x: 50, y: 100 }, ...set.left, ...set.top, ...right]
}

function ovalSpot(i: number, n: number): Spot {
  const angle = Math.PI / 2 + (2 * Math.PI * i) / n
  return { x: round(50 + 50 * Math.cos(angle)), y: round(50 + 50 * Math.sin(angle)) }
}

function round(x: number): number {
  return Math.round(x * 100) / 100
}

// Ставка улицы — у края места со стороны стола: у левого столбика — справа от места, у правого — слева,
// у верхних — под местом. У нижних — сбоку к середине: над моим местом центр стола — банк и общие карты
export type BetSide = 'left' | 'right' | 'below'

export function betSide({ x, y }: Spot): BetSide {
  if (x <= 10) return 'right'
  if (x >= 90) return 'left'
  if (y < 50) return 'below'
  return x <= 50 ? 'right' : 'left'
}

// Панель внизу экрана стола (#97): в свой ход — кнопки хода; идёт раздача, а ход не мой — узкая полоса
// «Ждём хода»; между раздачами — кнопки ведущего (кроме оконченного турнира); иначе панели нет
export type Dock = 'turn' | 'wait' | 'host' | 'none'

export function dockOf(v: {
  actions: { myTurn: boolean } | null
  stage: string | null
  isHost: boolean
  tournament: { ended: boolean } | null
}): Dock {
  if (v.actions?.myTurn) return 'turn'
  if (v.stage !== null) return 'wait'
  if (v.isHost && !v.tournament?.ended) return 'host'
  return 'none'
}

// Полоса «Ждём хода»: чей ход и сколько секунд; торги закрыты — кто отдаёт банк
export function waitLine(v: {
  toActName: string | null
  turnLeft: number | null
  stage: string | null
  stageLabel: string
  isHost: boolean
  phoneCards: boolean
}): string {
  if (v.toActName) return `Ждём хода · ${v.toActName}${v.turnLeft !== null ? ` · ${v.turnLeft} с` : ''}`
  if (v.stage === 'showdown' && !v.phoneCards) {
    return `${v.stageLabel} — ${v.isHost ? 'отметьте победителя ниже' : 'ведущий отмечает победителя'}`
  }
  return v.stageLabel
}

// Ползунок ставки (Р-69). Где стоит игрок — из RaiseView (pokerView.ts): ставка круга, банк после моего колла
// (как у быстрых кнопок), большой блайнд раздачи; до флопа — суммы быстрых кнопок (2,5, 3, 4 ББ или «×2,5», «×3»)
export type BetSpot = {
  preflop: boolean
  currentBet: number
  pot: number // банк после моего колла: 100 % — ставка круга и столько сверху
  bb: number
  pre: number[] // до флопа — суммы быстрых кнопок «N ББ» или «×N»; после флопа — пусто
}

// Дорожка ползунка — SLIDER_TRACK положений; сумма по положению — по шкале:
// от минимума до «опоры» мелко (после флопа — по 1 % банка, до флопа — по 0,1 ББ), от опоры до олл-ина — крупнее
// (целыми ББ, шаг растёт к олл-ину: шкала по степени). Опора — банк (100 %), до флопа — не ниже самой крупной
// быстрой суммы. У каждой точки прилипания — своя полоска SNAP_WIDTH положений, на ней сумма ровно точка;
// между полосками ставится любая сумма шкалы. Крайние положения — ровно минимум и олл-ин (в пот-лимите — «Пот»)
export type BetSlider = {
  min: number
  max: number
  spot: BetSpot
  pivot: number // конец мелкой части; равна max — крупной части нет
  fine: number // доля дорожки под мелкую часть, 0…1
  snaps: number[] // суммы прилипания по возрастанию, строго между min и max
}

export const SLIDER_TRACK = 1000
export const SNAP_WIDTH = 24 // ≈ 2,4 % дорожки — несколько пикселей под пальцем
const COARSE_WEIGHT = 40 // крупная часть занимает на дорожке столько же, сколько 40 мелких шагов
export const POT_SNAPS = [33, 50, 66, 75, 100] // после флопа — проценты банка после колла

// Сумма «N % банка»: ставка круга и N % банка после колла сверху, целая
export function potShareAmount(spot: BetSpot, pct: number): number {
  return spot.currentBet + Math.round((spot.pot * pct) / 100)
}

// Повысить нельзя или можно только олл-ин — ползунка нет
export function betSlider(raise: { min: number; max: number; spot: BetSpot } | null): BetSlider | null {
  if (!raise || raise.max <= raise.min) return null
  const { min, max, spot } = raise
  const top = potShareAmount(spot, 100)
  const pivot = clamp(spot.preflop ? Math.max(top, ...spot.pre) : top, min, max)
  const units = (pivot - min) / fineUnit(spot)
  const fine = pivot >= max ? 1 : units / (units + COARSE_WEIGHT)
  const marks = spot.preflop ? spot.pre : POT_SNAPS.map((p) => potShareAmount(spot, p))
  const snaps = [...new Set(marks)].filter((a) => a > min && a < max).sort((a, b) => a - b)
  return { min, max, spot, pivot, fine, snaps }
}

// Мелкий шаг в фишках: после флопа — 1 % банка, до флопа — 0,1 ББ
function fineUnit(spot: BetSpot): number {
  return Math.max(0.01, spot.preflop ? Math.max(1, spot.bb) / 10 : spot.pot / 100)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

// Шкала без полосок прилипания: доля u дорожки 0…1 → сумма
function baseAmount(s: BetSlider, u: number): number {
  if (u <= 0) return s.min
  if (u >= 1) return s.max
  const { spot } = s
  if (u <= s.fine) {
    const raw = s.min + ((s.pivot - s.min) * u) / s.fine
    const amount = spot.preflop
      ? Math.round((Math.round((raw * 10) / Math.max(1, spot.bb)) * Math.max(1, spot.bb)) / 10)
      : potShareAmount(spot, Math.round(((raw - spot.currentBet) * 100) / Math.max(1, spot.pot)))
    return clamp(amount, s.min, s.max)
  }
  const bb = Math.max(1, spot.bb)
  const x0 = s.pivot - spot.currentBet
  const x1 = s.max - spot.currentBet
  const w = (u - s.fine) / (1 - s.fine)
  const raw = spot.currentBet + x0 * Math.pow(x1 / x0, w)
  return clamp(Math.round(raw / bb) * bb, s.pivot, s.max)
}

// Обратно: сумма → доля дорожки без полосок прилипания
function baseShare(s: BetSlider, amount: number): number {
  if (amount <= s.min) return 0
  if (amount >= s.max) return 1
  if (amount <= s.pivot) return s.pivot > s.min ? (s.fine * (amount - s.min)) / (s.pivot - s.min) : 0
  const x0 = s.pivot - s.spot.currentBet
  const x1 = s.max - s.spot.currentBet
  const w = Math.log((amount - s.spot.currentBet) / x0) / Math.log(x1 / x0)
  return s.fine + (1 - s.fine) * w
}

// Начала полосок прилипания на дорожке
function snapStarts(s: BetSlider): number[] {
  const free = SLIDER_TRACK - s.snaps.length * SNAP_WIDTH
  return s.snaps.map((a, j) => Math.round(baseShare(s, a) * free) + j * SNAP_WIDTH)
}

// Сумма на положении ползунка: целая, от минимума до max
export function sliderAmount(s: BetSlider, index: number): number {
  const p = clamp(Math.round(index), 0, SLIDER_TRACK)
  if (p === 0) return s.min
  if (p === SLIDER_TRACK) return s.max
  const free = SLIDER_TRACK - s.snaps.length * SNAP_WIDTH
  let before = 0
  for (const [j, start] of snapStarts(s).entries()) {
    if (p < start) break
    if (p < start + SNAP_WIDTH) return s.snaps[j]
    before = j + 1
  }
  // Между полосками — между их точками: округление не перескочит соседнюю точку
  const lo = before > 0 ? s.snaps[before - 1] : s.min
  const hi = before < s.snaps.length ? s.snaps[before] : s.max
  return clamp(baseAmount(s, (p - before * SNAP_WIDTH) / free), lo, hi)
}

// Положение ползунка для суммы (своё число, быстрая кнопка, колесо): точка прилипания — середина её полоски
export function sliderIndex(s: BetSlider, amount: number): number {
  if (amount <= s.min) return 0
  if (amount >= s.max) return SLIDER_TRACK
  const free = SLIDER_TRACK - s.snaps.length * SNAP_WIDTH
  const starts = snapStarts(s)
  const at = s.snaps.indexOf(amount)
  if (at !== -1) return starts[at] + Math.floor(SNAP_WIDTH / 2)
  const before = s.snaps.filter((a) => a < amount).length
  return clamp(Math.round(baseShare(s, amount) * free) + before * SNAP_WIDTH, 1, SLIDER_TRACK - 1)
}

// Шаг колеса мыши и кнопок «−»/«+» (Р-69): 1 ББ (сначала) или 0,5 ББ — на этом телефоне, есть в копии
export type BetStep = 'bb' | 'half'

export const BET_STEP_DEFAULT: BetStep = 'bb'

export const BET_STEP_LABELS: [BetStep, string][] = [
  ['bb', formatBB(1, 1)], // «1 ББ»
  ['half', formatBB(1, 2)], // «0,5 ББ»
]

export function parseBetStep(raw: unknown): BetStep | null {
  return raw === 'bb' || raw === 'half' ? raw : null
}

// Шаг в фишках: целый, не меньше фишки; половина нечётного ББ — округлением
export function betStepChips(step: BetStep, bb: number): number {
  return Math.max(1, step === 'half' ? Math.round(bb / 2) : Math.round(bb))
}

// Колесо мыши и «−»/«+»: на шаг вверх (+1) или вниз (−1) от суммы; у минимума и max — упирается
export function stepAmount(s: { min: number; max: number }, amount: number, delta: 1 | -1, step: number): number {
  return clamp(Math.round(amount) + delta * Math.max(1, Math.round(step)), s.min, s.max)
}

// Подпись под суммой: «66 % банка · 12 ББ» (в фишках — «66 % банка · 1 200»); проценты — от банка после колла
// поверх ставки круга, как у быстрых кнопок. Сумма не выше ставки круга — без процентов
export function betShareText(spot: BetSpot, amount: number, unit: number | null): string {
  const sum = stackText(amount, unit)
  if (spot.pot <= 0 || amount <= spot.currentBet) return sum
  return `${formatNumber(Math.round(((amount - spot.currentBet) * 100) / spot.pot))} % банка · ${sum}`
}
