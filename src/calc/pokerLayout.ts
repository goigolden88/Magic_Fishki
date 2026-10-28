// Вид стола покера: кто где сидит вокруг овала, ползунок ставки и что лежит в панели внизу экрана.
// Только числа и подписи для экрана — правил не держит: границы ставки берёт из RaiseView (pokerView.ts)

// Места по кругу от меня: я — первым (внизу по центру), дальше по порядку мест, по часовой
export function aroundTable<T extends { isMe: boolean }>(seats: T[]): T[] {
  const me = seats.findIndex((s) => s.isMe)
  return me <= 0 ? seats : [...seats.slice(me), ...seats.slice(0, me)]
}

export type Spot = { x: number; y: number } // проценты слоя мест: x — слева, y — сверху

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

// Ползунок: позиция 0 — минимальная ставка, steps — олл-ин; шаг — малый блайнд,
// последний шаг может быть короче (до олл-ина)
export type BetSlider = { min: number; max: number; step: number; steps: number }

// Повысить нельзя или можно только олл-ин — ползунка нет
export function betSlider(raise: { min: number; max: number } | null, sb: number): BetSlider | null {
  if (!raise || raise.max <= raise.min) return null
  const step = Math.max(1, sb)
  return { min: raise.min, max: raise.max, step, steps: Math.ceil((raise.max - raise.min) / step) }
}

// Сумма на позиции ползунка
export function sliderAmount(s: BetSlider, index: number): number {
  const i = Math.min(s.steps, Math.max(0, Math.round(index)))
  return Math.min(s.max, s.min + i * s.step)
}

// Позиция ползунка для суммы (своё число или быстрая кнопка) — ближайший шаг
export function sliderIndex(s: BetSlider, amount: number): number {
  if (amount >= s.max) return s.steps
  return Math.min(s.steps, Math.max(0, Math.round((amount - s.min) / s.step)))
}

// Колесо мыши: на шаг вверх (+1) или вниз (−1) от суммы; сумма между шагами — к соседнему шагу
export function stepAmount(s: BetSlider, amount: number, delta: 1 | -1): number {
  const at = (amount - s.min) / s.step
  const index = delta > 0 ? Math.floor(at) + 1 : Math.ceil(at) - 1
  return amount >= s.max && delta > 0 ? s.max : sliderAmount(s, index)
}
