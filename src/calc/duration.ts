import type { Game } from '../model'

const NBSP = ' '
const MINUTE_MS = 60_000

// Игру забыли закрыть: с последней записи прошло больше — часы не идут до «сейчас» (#49)
export const FORGOTTEN_MS = 12 * 60 * MINUTE_MS

// Часы вечера: running — идёт (от первой записи до «сейчас»), иначе — сыграно (от первой до последней)
export type GameClock = { running: boolean; minutes: number }

// Записи — закупы, докупы, выходы и раунды казино; удалённых в игре уже нет.
// Записей нет — null; сыгранная игра короче минуты — тоже null
export function gameClock(game: Game, now: string): GameClock | null {
  const times = [...game.entries, ...(game.casino ?? [])].map((r) => Date.parse(r.at)).filter(Number.isFinite)
  if (times.length === 0) return null
  const first = Math.min(...times)
  const last = Math.max(...times)
  const nowMs = Date.parse(now)
  if (!game.closed && nowMs - last <= FORGOTTEN_MS) {
    return { running: true, minutes: Math.max(0, Math.floor((nowMs - first) / MINUTE_MS)) }
  }
  const minutes = Math.floor((last - first) / MINUTE_MS)
  return minutes > 0 ? { running: false, minutes } : null
}

// 45 → «45 мин», 245 → «4 ч 05 мин»
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}${NBSP}мин`
  const h = Math.floor(minutes / 60)
  const m = String(minutes % 60).padStart(2, '0')
  return `${h}${NBSP}ч ${m}${NBSP}мин`
}

// Строка экрана игры: «Идёт 1 ч 05 мин» или «Играли 4 ч 20 мин»
export function clockText(clock: GameClock): string {
  return (clock.running ? 'Идёт ' : 'Играли ') + formatDuration(clock.minutes)
}
