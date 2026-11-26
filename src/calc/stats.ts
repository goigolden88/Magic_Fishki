import type { Game, Regular } from '../model'
import { gameResult } from './casino'

// Вечер игрока — для «лучший» и «худший»
export type Evening = {
  gameId: string
  name: string
  date: string // YYYY-MM-DD
  kopecks: number // итого: покер + казино (Р-13)
}

// Итог постоянного игрока по всем закрытым играм
export type RegularStat = {
  regularId: string
  name: string // имя из настроек: переименование — та же строка
  games: number // сыграно закрытых игр
  wins: number // из них в плюсе по итого
  chips: number // покер: сумма итогов в фишках
  poker: number // покер: сумма итогов в копейках — по курсу каждой игры
  casino: number // казино: сумма в копейках
  kopecks: number // итого: покер + казино (Р-13)
  best: Evening | null // нет игр — null
  worst: Evening | null
  rebuys: number // записей «Докуп» всего
}

// Период статистики (#328, Р-120): календарный год игры (`date`) или null — всё время
export type Period = number | null

export type Stats = {
  period: Period // за какой период
  closedGames: number // в статистике
  totalGames: number // всего игр периода без демо: открытые видны разницей
  rows: RegularStat[] // по итогу в рублях, сверху — самый большой плюс; без игр — внизу
}

// Год игры — по её дате «YYYY-MM-DD»
function yearOf(game: Game): number {
  return Number(game.date.slice(0, 4))
}

// Годы, в которых есть закрытые игры без демо, — новые первыми
export function statsYears(games: Game[]): number[] {
  const years = new Set(games.filter((g) => !g.demo && g.closed).map(yearOf))
  return [...years].sort((a, b) => b - a)
}

// Период по умолчанию: текущий год, если в нём есть закрытые игры, иначе всё время
export function defaultPeriod(years: number[], currentYear: number): Period {
  return years.includes(currentYear) ? currentYear : null
}

// Статистика постоянных игроков: только закрытые игры без демо, только участники со связью (гости — нет);
// period — только игры этого года (по дате игры), null — все
export function regularStats(regulars: Regular[], games: Game[], period: Period = null): Stats {
  const real = games.filter((g) => !g.demo && (period === null || yearOf(g) === period))
  const closed = real.filter((g) => g.closed).sort((a, b) => a.date.localeCompare(b.date))
  const rows: RegularStat[] = regulars.map((r) => ({
    regularId: r.id,
    name: r.name,
    games: 0,
    wins: 0,
    chips: 0,
    poker: 0,
    casino: 0,
    kopecks: 0,
    best: null,
    worst: null,
    rebuys: 0,
  }))
  const byId = new Map(rows.map((row) => [row.regularId, row]))

  for (const game of closed) {
    const results = gameResult(game).players
    // Один постоянный — один вечер, даже если в игре он записан дважды
    const evenings = new Map<string, { chips: number; poker: number; casino: number; kopecks: number; rebuys: number }>()
    game.players.forEach((p, i) => {
      if (p.regularId === undefined || !byId.has(p.regularId)) return
      const sum = evenings.get(p.regularId) ?? { chips: 0, poker: 0, casino: 0, kopecks: 0, rebuys: 0 }
      sum.chips += results[i].poker.chips
      sum.poker += results[i].poker.kopecks
      sum.casino += results[i].casino
      sum.kopecks += results[i].kopecks
      sum.rebuys += game.entries.filter((e) => e.playerId === p.id && e.kind === 'rebuy').length
      evenings.set(p.regularId, sum)
    })
    for (const [regularId, sum] of evenings) {
      const row = byId.get(regularId)!
      const evening: Evening = { gameId: game.id, name: game.name, date: game.date, kopecks: sum.kopecks }
      row.games += 1
      if (sum.kopecks > 0) row.wins += 1
      row.chips += sum.chips
      row.poker += sum.poker
      row.casino += sum.casino
      row.kopecks += sum.kopecks
      row.rebuys += sum.rebuys
      // Равные вечера — первый по дате
      if (row.best === null || evening.kopecks > row.best.kopecks) row.best = evening
      if (row.worst === null || evening.kopecks < row.worst.kopecks) row.worst = evening
    }
  }

  // Равный итог — порядок настроек (сортировка устойчивая)
  const played = rows.filter((row) => row.games > 0).sort((a, b) => b.kopecks - a.kopecks)
  const idle = rows.filter((row) => row.games === 0)
  return { period, closedGames: closed.length, totalGames: real.length, rows: [...played, ...idle] }
}

// Период словами: «за 2026», «за всё время»
export function periodText(period: Period): string {
  return period === null ? 'за всё время' : `за ${period}`
}

// Основание статистики: «По 2 закрытым играм из 3 за 2026», «По 1 закрытой игре из 1 за всё время»
export function basisText(stats: Stats): string {
  const n = stats.closedGames
  const one = n % 10 === 1 && n % 100 !== 11
  return `По ${n} ${one ? 'закрытой игре' : 'закрытым играм'} из ${stats.totalGames} ${periodText(stats.period)}`
}

// Докупов в среднем за игру; игр нет — 0
export function rebuysPerGame(stat: RegularStat): number {
  return stat.games === 0 ? 0 : stat.rebuys / stat.games
}
