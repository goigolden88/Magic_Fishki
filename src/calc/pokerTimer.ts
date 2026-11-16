// Форма «Время на ход» и «Следующая раздача сама» (#75): при создании комнаты и в настройках
// стола у ведущего. Выбор кнопкой — выкл, готовое число секунд или «своё» с числом в поле
import {
  AUTO_START_MS,
  TIME_BANK_ADD_S,
  TIME_BANK_EVERY,
  TIME_BANK_MAX_S,
  TURN_MAX_S,
  TURN_MIN_S,
  type AutoStart,
  type Settings,
} from '../poker/table'

export const TURN_PRESETS = [20, 30, 60]

// Совет для вечера (#223): ход 20 с и запас 30 с
export const TIMER_TIP = { turnSeconds: 20, timeBank: 30 }

export type TurnChoice = 'off' | 'custom' | number // number — одно из TURN_PRESETS

export const AUTO_START_LABELS: [AutoStart, string][] = [
  ['off', 'Выкл'],
  ['fast', 'Быстро'],
  ['medium', 'Средне'],
  ['slow', 'Медленно'],
]

// Выбор формы по настройке стола: готовое число — его кнопка, иное — «своё» с числом
export function turnChoiceOf(seconds: number | null | undefined): { choice: TurnChoice; text: string } {
  if (seconds === null || seconds === undefined) return { choice: 'off', text: '' }
  return TURN_PRESETS.includes(seconds) ? { choice: seconds, text: '' } : { choice: 'custom', text: String(seconds) }
}

// Время на ход из формы: секунды, null — без таймера; «своё» вне пределов или не число — ошибка
export function turnSecondsOf(choice: TurnChoice, text: string): { ok: true; seconds: number | null } | { ok: false; error: string } {
  if (choice === 'off') return { ok: true, seconds: null }
  if (choice !== 'custom') return { ok: true, seconds: choice }
  const n = /^\s*\d+\s*$/.test(text) ? Number(text) : NaN
  if (!Number.isInteger(n) || n < TURN_MIN_S || n > TURN_MAX_S) {
    return { ok: false, error: `Своё время — целое число от ${TURN_MIN_S} до ${TURN_MAX_S} секунд` }
  }
  return { ok: true, seconds: n }
}

// Подпись паузы раздачи «сама»: «пауза 3 с»; выкл — «ведущий жмёт «Начать раздачу»»
export function autoStartNote(mode: AutoStart): string {
  if (mode === 'off') return 'Новую раздачу начинает ведущий'
  return `Новая раздача начнётся сама через ${AUTO_START_MS[mode] / 1000} с после раздачи банков`
}

// Запас времени (#223) из формы: без времени на ход запаса нет — поля в форме тогда не видно
export function timeBankOf(turnSeconds: number | null, bank: number | null): number | null {
  return turnSeconds === null ? null : bank
}

// Подпись под «Запасом времени»
export function timeBankNote(bank: number | null): string {
  if (bank === null) {
    return `Без запаса: время вышло — сразу чек или пас. Совет для вечера — ход ${TIMER_TIP.turnSeconds} с и запас ${TIMER_TIP.timeBank} с`
  }
  return (
    `Время на ход вышло — идёт свой запас, ${bank} с на вечер; каждые ${TIME_BANK_EVERY} раздач +${TIME_BANK_ADD_S} с, ` +
    `не больше ${TIME_BANK_MAX_S} с. Вне сети запас не тратится`
  )
}

// Настройки времени стола; у столов до #75 полей нет — выкл, до #223 — без запаса
export function timerSettings(settings: Settings): { turnSeconds: number | null; timeBank: number | null; autoStart: AutoStart } {
  return {
    turnSeconds: settings.turnSeconds ?? null,
    timeBank: timeBankOf(settings.turnSeconds ?? null, settings.timeBank ?? null),
    autoStart: settings.autoStart ?? 'off',
  }
}
