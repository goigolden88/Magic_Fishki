import type { Game } from '../model'
import { gameResult } from './casino'

// Окно динамики — столько последних игр игрока
export const WINDOW = 5

// Окно игр постоянного игрока: итоги по «итого» (Р-13)
export type GameWindow = {
  games: number // игр в окне: 1–5
  kopecks: number // итого за окно
  wins: number // игр в плюсе по итого
  rebuys: number // записей «Докуп» всего
}

// Разница последних с предыдущими. Предыдущих меньше 5 — по средним:
// итог и «в плюсе» предыдущих приведены к числу последних
export type Delta = {
  kopecks: number // итог, копейки
  wins: number // в плюсе, до десятых
  average: number // средний итог за игру, копейки
  rebuys: number // докупов в среднем за игру, до десятых
}

export type Trend = {
  recent: GameWindow | null // закрытых игр нет — null
  previous: GameWindow | null // игр 5 и меньше — null
  delta: Delta | null // есть, когда есть предыдущие
}

export type Change = 'better' | 'worse' | 'same'

const tenths = (n: number) => Math.round(n * 10) / 10

// Средний итог за игру, копейки — целыми
export function averageKopecks(w: GameWindow): number {
  return Math.round(w.kopecks / w.games)
}

// Докупов в среднем за игру
export function rebuysAverage(w: GameWindow): number {
  return w.rebuys / w.games
}

function sum(evenings: { kopecks: number; rebuys: number }[]): GameWindow {
  return {
    games: evenings.length,
    kopecks: evenings.reduce((s, e) => s + e.kopecks, 0),
    wins: evenings.filter((e) => e.kopecks > 0).length,
    rebuys: evenings.reduce((s, e) => s + e.rebuys, 0),
  }
}

// Динамика постоянного игрока: закрытые игры без демо, новые первыми (как на «Играх»: дата, затем id);
// последние 5 против предыдущих 5
export function playerTrend(regularId: string, games: Game[]): Trend {
  const closed = games
    .filter((g) => g.closed && !g.demo)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  const evenings: { kopecks: number; rebuys: number }[] = []
  for (const game of closed) {
    // Один постоянный — один вечер, даже если в игре он записан дважды
    const mine = game.players.flatMap((p, i) => (p.regularId === regularId ? [{ p, i }] : []))
    if (mine.length === 0) continue
    const results = gameResult(game).players
    evenings.push({
      kopecks: mine.reduce((s, { i }) => s + results[i].kopecks, 0),
      rebuys: mine.reduce(
        (s, { p }) => s + game.entries.filter((e) => e.playerId === p.id && e.kind === 'rebuy').length,
        0,
      ),
    })
    if (evenings.length === WINDOW * 2) break
  }

  if (evenings.length === 0) return { recent: null, previous: null, delta: null }
  const recent = sum(evenings.slice(0, WINDOW))
  if (evenings.length <= WINDOW) return { recent, previous: null, delta: null }
  const previous = sum(evenings.slice(WINDOW))

  const scale = recent.games / previous.games
  return {
    recent,
    previous,
    delta: {
      kopecks: recent.kopecks - Math.round(previous.kopecks * scale),
      wins: tenths(recent.wins - previous.wins * scale),
      // Разница тех средних, что на экране
      average: averageKopecks(recent) - averageKopecks(previous),
      rebuys: tenths(tenths(rebuysAverage(recent)) - tenths(rebuysAverage(previous))),
    },
  }
}

// Лучше или хуже: для докупов меньше — лучше
export function change(diff: number, lessIsBetter = false): Change {
  if (diff === 0) return 'same'
  return diff > 0 !== lessIsBetter ? 'better' : 'worse'
}

// «Последние 5 игр», «Последние 3 игры», «Последняя игра»; так же «Предыдущие»
export function windowTitle(which: 'recent' | 'previous', n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (n === 1) return which === 'recent' ? 'Последняя игра' : 'Предыдущая игра'
  const word = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'игры' : 'игр'
  return `${which === 'recent' ? 'Последние' : 'Предыдущие'} ${n} ${word}`
}
