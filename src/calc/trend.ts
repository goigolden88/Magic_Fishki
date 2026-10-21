import type { Game } from '../model'
import { gameResult } from './casino'

// Окно игр постоянного игрока: итоги по «итого» (Р-13)
export type GameWindow = {
  games: number // игр в окне: от 1 до окна сравнения (Р-15)
  kopecks: number // итого за окно
  wins: number // игр в плюсе по итого
  rebuys: number // записей «Докуп» всего
}

// Разница последних с предыдущими. Предыдущих меньше окна — по средним:
// итог и «в плюсе» предыдущих приведены к числу последних
export type Delta = {
  kopecks: number // итог, копейки
  wins: number // в плюсе, до десятых
  average: number // средний итог за игру, копейки
  rebuys: number // докупов в среднем за игру, до десятых
}

export type Trend = {
  recent: GameWindow | null // закрытых игр нет — null
  previous: GameWindow | null // игр не больше окна — null
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

// Вечер постоянного игрока: итог по «итого» и число докупов
type Evening = { date: string; kopecks: number; rebuys: number }

function sum(evenings: Evening[]): GameWindow {
  return {
    games: evenings.length,
    kopecks: evenings.reduce((s, e) => s + e.kopecks, 0),
    wins: evenings.filter((e) => e.kopecks > 0).length,
    rebuys: evenings.reduce((s, e) => s + e.rebuys, 0),
  }
}

// Вечера постоянного игрока: закрытые игры без демо, новые первыми (как на «Играх»: дата, затем id)
function playerEvenings(regularId: string, games: Game[]): Evening[] {
  const closed = games
    .filter((g) => g.closed && !g.demo)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  const evenings: Evening[] = []
  for (const game of closed) {
    // Один постоянный — один вечер, даже если в игре он записан дважды
    const mine = game.players.flatMap((p, i) => (p.regularId === regularId ? [{ p, i }] : []))
    if (mine.length === 0) continue
    const results = gameResult(game).players
    evenings.push({
      date: game.date,
      kopecks: mine.reduce((s, { i }) => s + results[i].kopecks, 0),
      rebuys: mine.reduce(
        (s, { p }) => s + game.entries.filter((e) => e.playerId === p.id && e.kind === 'rebuy').length,
        0,
      ),
    })
  }
  return evenings
}

// Динамика постоянного игрока: последние size игр против предыдущих size (окно сравнения, Р-15)
export function playerTrend(regularId: string, games: Game[], size: number): Trend {
  const evenings = playerEvenings(regularId, games).slice(0, size * 2)

  if (evenings.length === 0) return { recent: null, previous: null, delta: null }
  const recent = sum(evenings.slice(0, size))
  if (evenings.length <= size) return { recent, previous: null, delta: null }
  const previous = sum(evenings.slice(size))

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

// Промежуток — size игр игрока подряд: итого за них и дни первой и последней
export type Span = {
  games: number
  kopecks: number
  from: string // YYYY-MM-DD, первая игра
  to: string // YYYY-MM-DD, последняя игра
}

export type Spans = {
  evenings: number // закрытых игр игрока всего
  best: Span | null // игр меньше двух окон — null
  worst: Span | null
}

// Лучший и худший промежуток (Р-15): скользящее окно по вечерам в порядке дат; лучший и худший
// могут пересекаться; при равенстве — более поздний. Игр меньше двух окон — промежутков нет
export function playerSpans(regularId: string, games: Game[], size: number): Spans {
  const evenings = playerEvenings(regularId, games).reverse() // старые первыми
  if (evenings.length < size * 2) return { evenings: evenings.length, best: null, worst: null }

  let best: Span | null = null
  let worst: Span | null = null
  let kopecks = 0
  for (let i = 0; i < evenings.length; i++) {
    kopecks += evenings[i].kopecks
    if (i >= size) kopecks -= evenings[i - size].kopecks
    if (i < size - 1) continue
    const span = { games: size, kopecks, from: evenings[i - size + 1].date, to: evenings[i].date }
    if (best === null || kopecks >= best.kopecks) best = span
    if (worst === null || kopecks <= worst.kopecks) worst = span
  }
  return { evenings: evenings.length, best, worst }
}

// Лучше или хуже: для докупов меньше — лучше
export function change(diff: number, lessIsBetter = false): Change {
  if (diff === 0) return 'same'
  return diff > 0 !== lessIsBetter ? 'better' : 'worse'
}

// После числа: «1 игра», «3 игры», «5 игр», «22 игры»
export function gamesWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'игра'
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'игры' : 'игр'
}

// «Последние 5 игр», «Последние 3 игры», «Последняя игра»; так же «Предыдущие»
export function windowTitle(which: 'recent' | 'previous', n: number): string {
  if (n === 1) return which === 'recent' ? 'Последняя игра' : 'Предыдущая игра'
  return `${which === 'recent' ? 'Последние' : 'Предыдущие'} ${n} ${gamesWord(n)}`
}
