import { formatDate } from '../dates'
import type { Game } from '../model'
import { gameResult, type PlayerResult } from './casino'
import { formatDuration, gameClock } from './duration'
import { chipsGenitive, formatNumber, formatRate } from './format'
import { basisText, type Stats } from './stats'

const NBSP = ' '
const MINUS = '−'

// Название игры, если своё не задано (по умолчанию игра называется датой)
export const DEFAULT_TITLE = 'Покер'
// То же для игры только с казино (Р-13)
export const CASINO_TITLE = 'Казино'

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

function title(game: Game, fallback: string): string {
  const name = game.name.trim()
  return name === '' || name === formatDate(game.date) ? fallback : name
}

// Текст итога для мессенджера: заголовок, итоги от большего выигрыша к большему проигрышу, переводы.
// Расчёт — тот же, что на экране; меняется только порядок переводов: должники от большего
// проигрыша, у каждого получатели от большего выигрыша — как в строке итогов.
// С казино (Р-13) — строки «Покер:», «Казино:», «Итого:»; только казино — одна строка «Казино:».
// Под заголовком — «Играли 4 ч 20 мин» (#49): то же время, что на экране; меньше минуты — без строки
export function shareText(game: Game, now: string): string {
  const result = gameResult(game)
  const nameById = new Map(game.players.map((p) => [p.id, p.name]))
  const onlyCasino = result.hasCasino && game.entries.length === 0
  const sorted = result.hasCasino
    ? [...result.players].sort((x, y) => y.kopecks - x.kopecks)
    : [...result.players].sort((x, y) => y.poker.chips - x.poker.chips)
  const rank = new Map(sorted.map((t, i) => [t.playerId, i]))
  const line = (list: PlayerResult[], kopecks: (r: PlayerResult) => number) =>
    list.map((r) => `${nameById.get(r.playerId)} ${chatRub(kopecks(r), true)}`).join(' · ')
  const row = (list: PlayerResult[], kopecks: (r: PlayerResult) => number) =>
    line([...list].sort((x, y) => kopecks(y) - kopecks(x)), kopecks)

  const lines = [
    onlyCasino
      ? `${title(game, CASINO_TITLE)} · ${shortDate(game.date)}`
      : `${title(game, DEFAULT_TITLE)} · ${shortDate(game.date)} · курс ${formatRate(game.rate)}${NBSP}₽`,
  ]
  const clock = gameClock(game, now)
  if (clock !== null && clock.minutes > 0) lines.push('Играли ' + formatDuration(clock.minutes))
  if (!result.hasCasino) {
    if (sorted.length > 0) lines.push(line(sorted, (r) => r.poker.kopecks))
  } else {
    const casinoRow = 'Казино: ' + row(result.players.filter((r) => r.inCasino), (r) => r.casino)
    if (onlyCasino) {
      lines.push(casinoRow)
    } else {
      lines.push('Покер: ' + row(result.players.filter((r) => r.inPoker), (r) => r.poker.kopecks))
      lines.push(casinoRow)
      lines.push('Итого: ' + line(sorted, (r) => r.kopecks))
    }
  }

  const b = result.balance
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
  if (!result.casinoOk) {
    lines.push('Казино не сходится — переводы не посчитаны')
    return lines.join('\n')
  }

  const list = [...result.transfers].sort(
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

// Статистика игроков для мессенджера: заголовок с основанием, по строке на игрока в порядке экрана.
// Игроки без закрытых игр не входят; казино не в ноль — в скобках «покер …, казино …»
export function statsShareText(stats: Stats): string {
  const lines = [`Статистика · ${basisText(stats)}`]
  for (const s of stats.rows) {
    if (s.games === 0) continue
    const split = s.casino === 0 ? '' : ` (покер ${chatRub(s.poker, true)}, казино ${chatRub(s.casino, true)})`
    lines.push(`${s.name} ${chatRub(s.kopecks, true)} · игр ${chatNumber(s.games)}, в плюсе ${chatNumber(s.wins)}${split}`)
  }
  return lines.join('\n')
}
