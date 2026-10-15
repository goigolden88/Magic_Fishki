// Список «Игры»: группы по годам, что раскрыто, строка под названием
import type { Game } from '../model'
import { formatDate } from '../dates'
import { formatNumber } from './format'
import { balance, playerTotals } from './totals'

export type YearGroup = { year: string; games: Game[] }

// Год — из Game.date (YYYY-MM-DD); группы — новые сверху, порядок игр внутри — как пришёл
export function groupByYear(games: Game[]): YearGroup[] {
  const byYear = new Map<string, Game[]>()
  for (const g of games) {
    const year = g.date.slice(0, 4)
    const list = byYear.get(year)
    if (list) list.push(g)
    else byYear.set(year, [g])
  }
  return [...byYear.entries()]
    .map(([year, list]) => ({ year, games: list }))
    .sort((a, b) => (a.year < b.year ? 1 : a.year > b.year ? -1 : 0))
}

// Какой год раскрыт без выбора человека: текущий, а если в нём игр нет — самый свежий с играми
export function defaultOpenYear(groups: YearGroup[], currentYear: string): string | null {
  if (groups.some((g) => g.year === currentYear)) return currentYear
  return groups[0]?.year ?? null
}

// Раскрыт ли год: выбор человека (saved), иначе — только год по умолчанию
export function isYearOpen(year: string, saved: Record<string, boolean>, defaultYear: string | null): boolean {
  return saved[year] ?? year === defaultYear
}

// Строка под названием: дата — только если название не дата; только казино — о казино
export function gameSummary(game: Game): string {
  const parts: string[] = []
  if (game.name !== formatDate(game.date)) parts.push(formatDate(game.date))
  parts.push(`игроков ${game.players.length}`)
  const rounds = game.casino?.length ?? 0
  if (game.entries.length === 0 && rounds > 0) {
    parts.push(`казино: раундов ${rounds}`)
    if (game.closed) parts.push('закрыта')
    return parts.join(' · ')
  }
  const b = balance(playerTotals(game.players, game.entries, game.rate))
  const status = game.closed ? 'закрыта' : b.chipsIn === 0 ? 'записей нет' : b.ok ? 'сходится' : 'не сходится'
  parts.push(`закуплено ${formatNumber(b.chipsIn)}`, status)
  return parts.join(' · ')
}
