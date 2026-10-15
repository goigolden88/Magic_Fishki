import type { Game, Regular } from '../model'
import { playerTotals } from './totals'

// Вечер игрока — для «лучший» и «худший»
export type Evening = {
  gameId: string
  name: string
  date: string // YYYY-MM-DD
  kopecks: number
}

// Итог постоянного игрока по всем закрытым играм
export type RegularStat = {
  regularId: string
  name: string // имя из настроек: переименование — та же строка
  games: number // сыграно закрытых игр
  wins: number // из них в плюсе
  chips: number // сумма итогов в фишках
  kopecks: number // сумма итогов в копейках — по курсу каждой игры
  best: Evening | null // нет игр — null
  worst: Evening | null
  rebuys: number // записей «Докуп» всего
}

export type Stats = {
  closedGames: number // в статистике
  totalGames: number // всего игр без демо: открытые видны разницей
  rows: RegularStat[] // по итогу в рублях, сверху — самый большой плюс; без игр — внизу
}

// Статистика постоянных игроков: только закрытые игры без демо, только участники со связью (гости — нет)
export function regularStats(regulars: Regular[], games: Game[]): Stats {
  const real = games.filter((g) => !g.demo)
  const closed = real.filter((g) => g.closed).sort((a, b) => a.date.localeCompare(b.date))
  const rows: RegularStat[] = regulars.map((r) => ({
    regularId: r.id,
    name: r.name,
    games: 0,
    wins: 0,
    chips: 0,
    kopecks: 0,
    best: null,
    worst: null,
    rebuys: 0,
  }))
  const byId = new Map(rows.map((row) => [row.regularId, row]))

  for (const game of closed) {
    const totals = playerTotals(game.players, game.entries, game.rate)
    // Один постоянный — один вечер, даже если в игре он записан дважды
    const evenings = new Map<string, { chips: number; kopecks: number; rebuys: number }>()
    game.players.forEach((p, i) => {
      if (p.regularId === undefined || !byId.has(p.regularId)) return
      const sum = evenings.get(p.regularId) ?? { chips: 0, kopecks: 0, rebuys: 0 }
      sum.chips += totals[i].chips
      sum.kopecks += totals[i].kopecks
      sum.rebuys += game.entries.filter((e) => e.playerId === p.id && e.kind === 'rebuy').length
      evenings.set(p.regularId, sum)
    })
    for (const [regularId, sum] of evenings) {
      const row = byId.get(regularId)!
      const evening: Evening = { gameId: game.id, name: game.name, date: game.date, kopecks: sum.kopecks }
      row.games += 1
      if (sum.kopecks > 0) row.wins += 1
      row.chips += sum.chips
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
  return { closedGames: closed.length, totalGames: real.length, rows: [...played, ...idle] }
}

// Докупов в среднем за игру; игр нет — 0
export function rebuysPerGame(stat: RegularStat): number {
  return stat.games === 0 ? 0 : stat.rebuys / stat.games
}
