import { formatDate } from '../dates'
import type { Game } from '../model'
import { chipsGenitive, formatNumber, formatRate } from './format'
import { balance, playerTotals } from './totals'
import { transfers } from './transfers'

const NBSP = ' '
const MINUS = '−'

// Название игры, если своё не задано (по умолчанию игра называется датой)
export const DEFAULT_TITLE = 'Покер'

// Числа для чата: до 4 знаков слитно (1475), длиннее — с пробелами (11 000)
function chatNumber(n: number): string {
  const abs = Math.abs(n)
  return abs < 10000 ? String(abs) : formatNumber(abs)
}

// Копейки → рубли для чата: «+1475 ₽», «+182,5 ₽», «−500 ₽», «182,05 ₽»
function chatRub(kopecks: number, withSign: boolean): string {
  const abs = Math.abs(kopecks)
  const kop = abs % 100
  const fraction = kop === 0 ? '' : ',' + (kop % 10 === 0 ? String(kop / 10) : String(kop).padStart(2, '0'))
  const text = chatNumber(Math.floor(abs / 100)) + fraction + NBSP + '₽'
  if (kopecks < 0) return MINUS + text
  return withSign && kopecks > 0 ? '+' + text : text
}

// 2026-10-09 → «09.10»
function shortDate(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}.${m}`
}

function title(game: Game): string {
  const name = game.name.trim()
  return name === '' || name === formatDate(game.date) ? DEFAULT_TITLE : name
}

// Текст итога для мессенджера: заголовок, итоги от большего выигрыша к большему проигрышу, переводы.
// Расчёт — тот же, что на экране; меняется только порядок переводов: должники от большего
// проигрыша, у каждого получатели от большего выигрыша — как в строке итогов.
export function shareText(game: Game): string {
  const totals = playerTotals(game.players, game.entries, game.rate)
  const nameById = new Map(game.players.map((p) => [p.id, p.name]))
  const sorted = [...totals].sort((x, y) => y.chips - x.chips)
  const rank = new Map(sorted.map((t, i) => [t.playerId, i]))

  const lines = [`${title(game)} · ${shortDate(game.date)} · курс ${formatRate(game.rate)}${NBSP}₽`]
  if (sorted.length > 0) {
    lines.push(sorted.map((t) => `${nameById.get(t.playerId)} ${chatRub(t.kopecks, true)}`).join(' · '))
  }

  const b = balance(totals)
  if (b.diff > 0) {
    lines.push(`Не хватает ${chatNumber(b.diff)} ${chipsGenitive(b.diff)} — переводы не посчитаны`)
    return lines.join('\n')
  }
  if (b.diff < 0) {
    lines.push(
      `Выведено ${chatNumber(b.chipsOut)} из ${chatNumber(b.chipsIn)} ${chipsGenitive(b.chipsIn)} — больше, чем закуплено; переводы не посчитаны`,
    )
    return lines.join('\n')
  }

  const list = transfers(totals, game.rate).sort(
    (x, y) => rank.get(y.from)! - rank.get(x.from)! || rank.get(x.to)! - rank.get(y.to)!,
  )
  if (list.length === 0) {
    lines.push('Переводы не нужны')
    return lines.join('\n')
  }
  lines.push('Переводы:')
  for (const t of list) lines.push(`${nameById.get(t.from)} → ${nameById.get(t.to)} ${chatRub(t.kopecks, false)}`)
  return lines.join('\n')
}
