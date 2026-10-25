// Вид стола покера: кто где сидит вокруг овала и ползунок ставки. Только числа для экрана —
// правил не держит: границы ставки берёт из RaiseView (pokerView.ts)

// Места по кругу от меня: я — первым (внизу по центру), дальше по порядку мест, по часовой
export function aroundTable<T extends { isMe: boolean }>(seats: T[]): T[] {
  const me = seats.findIndex((s) => s.isMe)
  return me <= 0 ? seats : [...seats.slice(me), ...seats.slice(0, me)]
}

// Точка места i из n на овале, в процентах рамки (x — слева, y — сверху): 0 — внизу по центру,
// дальше по часовой — влево, вверх, вправо. radius — доля от края до центра: 1 — край, 0 — центр
export function seatSpot(i: number, n: number, radius = 1): { x: number; y: number } {
  const angle = Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n)
  return { x: round(50 + 50 * radius * Math.cos(angle)), y: round(50 + 50 * radius * Math.sin(angle)) }
}

function round(x: number): number {
  return Math.round(x * 100) / 100
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
