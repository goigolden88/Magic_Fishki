import type { CasinoRound, Entry, Game, Player } from '../model'

// Демо-игры (Р-04): имена и числа выдуманы, живут только в коде. У каждой demo: true — в статистику,
// динамику и копию не идут, удаляются одной кнопкой. Участники — гости: постоянные игроки от демо не меняются

type DemoPlayer = { name: string; buyin: number; rebuys?: number[]; cashout?: number } // фишки; нет выхода — не записан
type DemoSpec = {
  name: string
  daysAgo: number // день игры — столько дней назад от сегодня
  rate: number
  closed: boolean
  players: DemoPlayer[]
  casino?: Record<string, number>[] // раунды: имя → рубли, сумма — ноль
}

const DEMO: DemoSpec[] = [
  {
    name: 'Демо: пятница',
    daysAgo: 14,
    rate: 0.5,
    closed: true,
    players: [
      { name: 'Аня', buyin: 1000, rebuys: [1000], cashout: 3500 },
      { name: 'Боря', buyin: 1000, cashout: 400 },
      { name: 'Вера', buyin: 1000, rebuys: [500], cashout: 700 },
      { name: 'Гоша', buyin: 1000, cashout: 1900 },
      { name: 'Даша', buyin: 1000, rebuys: [500, 500], cashout: 1000 },
    ],
  },
  {
    name: 'Демо: суббота с казино',
    daysAgo: 7,
    rate: 1,
    closed: true,
    players: [
      { name: 'Егор', buyin: 2000, cashout: 2600 },
      { name: 'Аня', buyin: 2000, rebuys: [1000], cashout: 1500 },
      { name: 'Гоша', buyin: 2000, cashout: 2900 },
    ],
    casino: [
      { Егор: -300, Аня: 500, Гоша: -200 },
      { Аня: -150, Гоша: 150 },
    ],
  },
  {
    name: 'Демо: игра идёт',
    daysAgo: 0,
    rate: 0.5,
    closed: false,
    players: [
      { name: 'Боря', buyin: 1000, cashout: 1200 },
      { name: 'Вера', buyin: 1000, rebuys: [500] },
      { name: 'Даша', buyin: 1000, cashout: 800 },
    ],
  },
]

// День YYYY-MM-DD на n дней раньше, по календарю
function daysBefore(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10)
}

// Время записи: день игры, 20:00 по часам телефона плюс минуты
function timeOn(date: string, minutes: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 20, minutes).toISOString()
}

function demoGame(spec: DemoSpec, today: string, now: string, makeId: () => string): Game {
  const id = makeId()
  const date = daysBefore(today, spec.daysAgo)
  const players: Player[] = spec.players.map((p) => ({ id: makeId(), name: p.name }))
  const entries: Entry[] = []
  const add = (playerId: string, kind: Entry['kind'], chips: number, minutes: number) => {
    entries.push({ id: makeId(), playerId, kind, chips, at: timeOn(date, minutes) })
  }
  // Закупы в начале вечера, докупы через час и позже, выходы к концу
  spec.players.forEach((p, i) => {
    add(players[i].id, 'buyin', p.buyin, i)
    ;(p.rebuys ?? []).forEach((chips, j) => add(players[i].id, 'rebuy', chips, 60 + 30 * j + i))
    if (p.cashout !== undefined) add(players[i].id, 'cashout', p.cashout, 180 + i)
  })
  const casino: CasinoRound[] | undefined = spec.casino?.map((round, k) => ({
    id: makeId(),
    amounts: Object.entries(round).map(([name, rub]) => ({
      playerId: players[spec.players.findIndex((p) => p.name === name)].id,
      kopecks: rub * 100,
    })),
    at: timeOn(date, 120 + k),
  }))
  return {
    id,
    name: spec.name,
    date,
    rate: spec.rate,
    players,
    entries,
    ...(casino && { casino }),
    ...(spec.closed && { closed: true }),
    demo: true,
    updatedAt: now,
  }
}

// Несколько выдуманных игр: две закрытые (одна с казино) и одна идёт, где не записан выход
export function demoGames(today: string, now: string, makeId: () => string): Game[] {
  return DEMO.map((spec) => demoGame(spec, today, now, makeId))
}

// Есть ли демо-игры: «Добавить» второй раз не удваивает их
export function hasDemo(games: Game[]): boolean {
  return games.some((g) => g.demo)
}
