// Открытие столов казино-стола (#134): кнопкой или само через промежуток, карты стола — по одной.
// Только экран: правила раунда (casinoDeal) и запись о нём не знают. Время — мс по часам экрана (now);
// здесь — что открыто, переворачивается ли стол и сколько до следующего; таймер и карты рисует экран
import { BOARD_CARDS } from './casinoDeal'

// «Открывать столы сами»: секунды, 0 — «Нет» (кнопкой)
export const AUTO_OPEN_CHOICES = [0, 3, 5, 10]
export const DEFAULT_AUTO_OPEN = 5
export const BOARD_FLIP_MS = 1500 // весь стол переворачивается — не дольше
const FLIP_STEP_MS = BOARD_FLIP_MS / BOARD_CARDS // карта за картой; последняя доворачивается к концу

export const autoOpenLabel = (seconds: number) => (seconds > 0 ? `${seconds} с` : 'Нет')

export type Reveal = {
  total: number // столов в раунде
  every: number | null // мс между открытиями; null — «Нет», открывают кнопкой
  flip: number // мс переворота стола; 0 — «Анимация карт» выключена, стол открывается сразу
  opened: number // столов открыто (последний может ещё переворачиваться)
  turnAt: number // когда начал открываться последний открытый стол
  due: number | null // когда откроется следующий сам; null — отсчёта нет
  held: number | null // отсчёт стоит (ушли с экрана, вопрос «Бросить раунд?»): сколько оставалось
  paused: boolean // «Пауза»
}

// Новая раздача: ничего не открыто; первый стол — через промежуток после delay (анимация раздачи)
export function revealStart(total: number, every: number | null, flip: number, now: number, delay = 0): Reveal {
  return {
    total,
    every,
    flip,
    opened: 0,
    turnAt: now - flip,
    due: every !== null && total > 0 ? now + delay + every : null,
    held: null,
    paused: false,
  }
}

const turnEnd = (s: Reveal) => s.turnAt + s.flip

// Последний открытый стол ещё переворачивается
export const turning = (s: Reveal, now: number) => s.opened > 0 && now < turnEnd(s)

// Карт лицом у последнего открытого стола: по одной слева направо; не переворачивается — все
export function cardsShown(s: Reveal, now: number): number {
  if (s.opened === 0) return 0
  if (!turning(s, now)) return BOARD_CARDS
  return Math.min(BOARD_CARDS, Math.floor(Math.max(0, now - s.turnAt) / FLIP_STEP_MS) + 1)
}

// Все столы открыты и последний перевернулся — пора итог
export const allShown = (s: Reveal, now: number) => s.opened >= s.total && !turning(s, now)

// Отсчёт до следующего: от конца переворота, если идёт сам и есть что открывать
function rearm(s: Reveal, from: number): Reveal {
  const go = s.every !== null && !s.paused && s.opened < s.total
  return { ...s, due: go ? from + (s.every as number) : null, held: null }
}

// Открыть следующий стол (кнопка «Открыть стол N» или срок): прошлый, если переворачивался, — сразу целиком
export function openNext(s: Reveal, now: number): Reveal {
  if (s.opened >= s.total) return s
  return rearm({ ...s, opened: s.opened + 1, turnAt: now }, now + s.flip)
}

// «Открыть сейчас»: стол переворачивается — сразу целиком; иначе — следующий. Отсчёт до следующего — заново
export function openNow(s: Reveal, now: number): Reveal {
  if (turning(s, now)) return rearm({ ...s, turnAt: now - s.flip }, now)
  return openNext(s, now)
}

// Срок пришёл — открыть один стол. Пропущенные разом не открываются: следующий — через промежуток от этого
export function revealTick(s: Reveal, now: number): Reveal {
  return s.due !== null && now >= s.due ? openNext(s, now) : s
}

export function revealPause(s: Reveal): Reveal {
  return { ...s, paused: true, due: null, held: null }
}

// «Продолжить» — отсчёт заново, с конца переворота, если он идёт
export function revealResume(s: Reveal, now: number): Reveal {
  return rearm({ ...s, paused: false }, Math.max(now, turnEnd(s)))
}

// Отсчёт встал (ушли с экрана, вопрос) — запомнить, сколько оставалось
export function revealHold(s: Reveal, now: number): Reveal {
  if (s.due === null) return s
  return { ...s, due: null, held: Math.max(0, s.due - now) }
}

// Вернулись — с того же места
export function revealRelease(s: Reveal, now: number): Reveal {
  if (s.held === null) return s
  return { ...s, due: now + s.held, held: null }
}

// Сменили промежуток посреди раунда: «Нет» — отсчёт снят; иначе — заново с новым (пауза остаётся паузой)
export function revealEvery(s: Reveal, every: number | null, now: number): Reveal {
  if (every === s.every) return s
  return rearm({ ...s, every }, Math.max(now, turnEnd(s)))
}

// Секунд до следующего — для строки «Стол N через K с»; во время переворота и раздачи — полный промежуток.
// Отсчёта нет — null
export function secondsLeft(s: Reveal, now: number): number | null {
  const left = s.due !== null ? s.due - now : s.held
  if (left === null || s.every === null) return null
  return Math.max(0, Math.ceil(Math.min(s.every, left) / 1000))
}

// Через сколько мс экрану перерисоваться: следующая карта, конец переворота, смена секунды или срок. Нечего ждать — null
export function nextWake(s: Reveal, now: number): number | null {
  const at: number[] = []
  if (turning(s, now)) {
    const shown = cardsShown(s, now)
    at.push(shown < BOARD_CARDS ? s.turnAt + shown * FLIP_STEP_MS : turnEnd(s))
  }
  if (s.due !== null && s.every !== null) {
    const left = s.due - now
    // Строка меняется, когда секунды убывают: выше промежутка — стоят, ниже — каждую целую секунду
    at.push(left > s.every ? s.due - s.every : left <= 0 ? now : now + left - (Math.ceil(left / 1000) - 1) * 1000)
  }
  if (at.length === 0) return null
  return Math.max(0, Math.min(...at) - now)
}
