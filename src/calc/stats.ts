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
  return { closedGames: closed.length, totalGames: real.length, rows: [...played, ...idle] }
}

// Основание статистики: «По 2 закрытым играм из 3», «По 1 закрытой игре из 1»
export function basisText(stats: Stats): string {
  const n = stats.closedGames
  const one = n % 10 === 1 && n % 100 !== 11
  return `По ${n} ${one ? 'закрытой игре' : 'закрытым играм'} из ${stats.totalGames}`
}

// Докупов в среднем за игру; игр нет — 0
export function rebuysPerGame(stat: RegularStat): number {
  return stat.games === 0 ? 0 : stat.rebuys / stat.games
}
