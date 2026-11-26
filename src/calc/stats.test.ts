import { describe, expect, it } from 'vitest'
import type { Entry, EntryKind, Game, Player, Regular } from '../model'
import { formatTenths } from './format'
import { basisText, defaultPeriod, periodText, rebuysPerGame, regularStats, statsYears } from './stats'

// Выдуманные игроки и игры
const REGULARS: Regular[] = [
  { id: 'r-anna', name: 'Анна' },
  { id: 'r-boris', name: 'Борис' },
  { id: 'r-vera', name: 'Вера' },
]

type Row = { player: Player; buyin: number; rebuys?: number[]; cashout?: number }

function makeGame(id: string, date: string, rate: number, rows: Row[], extra: Partial<Game> = {}): Game {
  const entries: Entry[] = []
  const add = (playerId: string, kind: EntryKind, chips: number) =>
    entries.push({ id: `${id}-${entries.length}`, playerId, kind, chips, at: `${date}T20:00:00.000Z` })
  for (const row of rows) {
    add(row.player.id, 'buyin', row.buyin)
    for (const r of row.rebuys ?? []) add(row.player.id, 'rebuy', r)
    if (row.cashout !== undefined) add(row.player.id, 'cashout', row.cashout)
  }
  return {
    id,
    name: `Игра ${id}`,
    date,
    rate,
    players: rows.map((r) => r.player),
    entries,
    closed: true,
    updatedAt: `${date}T23:00:00.000Z`,
    ...extra,
  }
}

const anna = (id: string): Player => ({ id, name: 'Анна', regularId: 'r-anna' })
const boris = (id: string): Player => ({ id, name: 'Борис', regularId: 'r-boris' })
const guest = (id: string): Player => ({ id, name: 'Гость' })

// Игра 1, курс 0,5: Анна +1000 фишек, Борис −500 с докупом, гость −500
const G1 = makeGame('g1', '2026-09-01', 0.5, [
  { player: anna('p1'), buyin: 1000, cashout: 2000 },
  { player: boris('p2'), buyin: 500, rebuys: [500], cashout: 500 },
  { player: guest('p3'), buyin: 1000, cashout: 500 },
])

// Игра 2, курс 1: Анна −300 с двумя докупами, Борис +300
const G2 = makeGame('g2', '2026-09-08', 1, [
  { player: anna('p4'), buyin: 500, rebuys: [200, 100], cashout: 500 },
  { player: boris('p5'), buyin: 500, cashout: 800 },
])

describe('статистика постоянных игроков', () => {
  it('итог — суммой копеек по курсу каждой игры', () => {
    const s = regularStats(REGULARS, [G1, G2])
    const a = s.rows.find((r) => r.regularId === 'r-anna')!
    expect(a.chips).toBe(1000 - 300)
    expect(a.kopecks).toBe(50000 - 30000) // 1000 × 0,5 ₽ − 300 × 1 ₽ = 200 ₽
    const b = s.rows.find((r) => r.regularId === 'r-boris')!
    expect(b.chips).toBe(-500 + 300)
    expect(b.kopecks).toBe(-25000 + 30000) // −250 ₽ + 300 ₽ = 50 ₽
  })

  it('игр, в плюсе, лучший и худший вечер, докупы', () => {
    const a = regularStats(REGULARS, [G1, G2]).rows.find((r) => r.regularId === 'r-anna')!
    expect(a.games).toBe(2)
    expect(a.wins).toBe(1)
    expect(a.best).toEqual({ gameId: 'g1', name: 'Игра g1', date: '2026-09-01', kopecks: 50000 })
    expect(a.worst).toEqual({ gameId: 'g2', name: 'Игра g2', date: '2026-09-08', kopecks: -30000 })
    expect(a.rebuys).toBe(2)
    expect(rebuysPerGame(a)).toBe(1)
  })

  it('основание: закрытых из всех', () => {
    const open = makeGame('g3', '2026-09-15', 0.5, [{ player: anna('p6'), buyin: 1000 }], { closed: false })
    const s = regularStats(REGULARS, [G1, G2, open])
    expect(s.closedGames).toBe(2)
    expect(s.totalGames).toBe(3)
    // открытая игра в итог не входит
    expect(s.rows.find((r) => r.regularId === 'r-anna')!.games).toBe(2)
  })

  it('по итогу в рублях, сверху — самый большой плюс; без игр — внизу', () => {
    const s = regularStats(REGULARS, [G1, G2])
    expect(s.rows.map((r) => r.name)).toEqual(['Анна', 'Борис', 'Вера'])
    const vera = s.rows[2]
    expect(vera.games).toBe(0)
    expect(vera.best).toBeNull()
    expect(vera.worst).toBeNull()
    expect(rebuysPerGame(vera)).toBe(0)

    // Без игр — внизу, даже ниже минуса
    const loss = makeGame('g4', '2026-09-20', 1, [
      { player: anna('p7'), buyin: 5000, cashout: 0 },
      { player: boris('p8'), buyin: 100, cashout: 5100 },
    ])
    const s2 = regularStats(REGULARS, [G1, G2, loss])
    expect(s2.rows.map((r) => r.name)).toEqual(['Борис', 'Анна', 'Вера'])
    expect(s2.rows[1].kopecks).toBeLessThan(0)
  })

  it('переименование в настройках — одна строка под новым именем', () => {
    const renamed: Regular[] = [{ id: 'r-anna', name: 'Аня' }, REGULARS[1], REGULARS[2]]
    const s = regularStats(renamed, [G1, G2])
    expect(s.rows).toHaveLength(3)
    const a = s.rows.find((r) => r.regularId === 'r-anna')!
    expect(a.name).toBe('Аня')
    expect(a.games).toBe(2)
  })

  it('гости и демо-игры в статистику не входят', () => {
    const demo = makeGame('g5', '2026-09-22', 1, [{ player: anna('p9'), buyin: 100, cashout: 10100 }], { demo: true })
    const s = regularStats(REGULARS, [G1, G2, demo])
    expect(s.totalGames).toBe(2)
    expect(s.closedGames).toBe(2)
    expect(s.rows.find((r) => r.regularId === 'r-anna')!.kopecks).toBe(20000)
    expect(s.rows.map((r) => r.regularId)).toEqual(['r-anna', 'r-boris', 'r-vera'])
  })

  it('закрытых игр нет — все без игр', () => {
    const open = { ...G1, closed: false }
    const s = regularStats(REGULARS, [open])
    expect(s.closedGames).toBe(0)
    expect(s.totalGames).toBe(1)
    expect(s.rows.every((r) => r.games === 0)).toBe(true)
  })

  it('постоянный дважды в одной игре — один вечер', () => {
    const twice = makeGame('g6', '2026-09-29', 1, [
      { player: anna('p10'), buyin: 100, rebuys: [100], cashout: 500 },
      { player: anna('p11'), buyin: 100, cashout: 0 },
    ])
    const a = regularStats(REGULARS, [twice]).rows.find((r) => r.regularId === 'r-anna')!
    expect(a.games).toBe(1)
    expect(a.chips).toBe(300 - 100)
    expect(a.kopecks).toBe(20000)
    expect(a.rebuys).toBe(1)
  })

  it('равные вечера — лучший и худший первые по дате', () => {
    const later = makeGame('g7', '2026-10-06', 0.5, [{ player: anna('p12'), buyin: 1000, cashout: 2000 }])
    // Игры подаются новые сверху, как из базы
    const a = regularStats(REGULARS, [later, G1]).rows.find((r) => r.regularId === 'r-anna')!
    expect(a.best!.gameId).toBe('g1')
    expect(a.worst!.gameId).toBe('g1')
  })
})

describe('статистика за год (#328)', () => {
  // На границе года: 31 декабря и 1 января
  const dec31 = makeGame('y1', '2025-12-31', 1, [
    { player: anna('q1'), buyin: 500, cashout: 1500 },
    { player: boris('q2'), buyin: 1000, cashout: 0 },
  ])
  const jan1 = makeGame('y2', '2026-01-01', 1, [
    { player: anna('q3'), buyin: 500, rebuys: [500], cashout: 0 },
    { player: boris('q4'), buyin: 500, cashout: 1500 },
  ])
  const open2024 = makeGame('y3', '2024-06-01', 1, [{ player: anna('q5'), buyin: 500 }], { closed: false })
  const demo2023 = makeGame('y4', '2023-03-03', 1, [{ player: anna('q6'), buyin: 100, cashout: 900 }], {
    demo: true,
  })
  const all = [jan1, dec31, open2024, demo2023, G1]

  it('годы — закрытых игр без демо, новые первыми', () => {
    expect(statsYears(all)).toEqual([2026, 2025])
    expect(statsYears([open2024, demo2023])).toEqual([])
  })

  it('по умолчанию — текущий год, если в нём есть закрытые игры, иначе всё время', () => {
    expect(defaultPeriod([2026, 2025], 2026)).toBe(2026)
    expect(defaultPeriod([2025], 2026)).toBeNull()
    expect(defaultPeriod([], 2026)).toBeNull()
  })

  it('год — по дате игры: 31 декабря в своём году, 1 января — в следующем', () => {
    const s25 = regularStats(REGULARS, all, 2025)
    expect(s25.period).toBe(2025)
    expect(s25.closedGames).toBe(1)
    expect(s25.totalGames).toBe(1)
    const a25 = s25.rows.find((r) => r.regularId === 'r-anna')!
    expect(a25.games).toBe(1)
    expect(a25.kopecks).toBe(100000)
    expect(a25.best!.gameId).toBe('y1')

    const s26 = regularStats(REGULARS, all, 2026)
    expect(s26.closedGames).toBe(2) // 1 января и G1 (сентябрь 2026)
    const a26 = s26.rows.find((r) => r.regularId === 'r-anna')!
    expect(a26.games).toBe(2)
    expect(a26.wins).toBe(1)
    expect(a26.rebuys).toBe(1)
    expect(a26.kopecks).toBe(-100000 + 50000)
    expect(a26.worst!.gameId).toBe('y2')
    expect(s26.rows.map((r) => r.name)).toEqual(['Борис', 'Анна', 'Вера'])
  })

  it('открытые и демо в год не входят; открытые видны в «из»', () => {
    const s24 = regularStats(REGULARS, all, 2024)
    expect(s24.closedGames).toBe(0)
    expect(s24.totalGames).toBe(1) // открытая
    expect(s24.rows.every((r) => r.games === 0)).toBe(true)
    const s23 = regularStats(REGULARS, all, 2023)
    expect(s23.totalGames).toBe(0) // только демо
  })

  it('всё время — все годы, как без периода', () => {
    const s = regularStats(REGULARS, all, null)
    expect(s.period).toBeNull()
    expect(s.closedGames).toBe(3)
    expect(s.totalGames).toBe(4)
    expect(regularStats(REGULARS, all)).toEqual(s)
  })
})

describe('основание статистики', () => {
  const basis = (closedGames: number, totalGames: number, period: number | null = null) =>
    basisText({ period, closedGames, totalGames, rows: [] })

  it('число закрытых из всех, падеж по числу', () => {
    expect(basis(2, 3)).toBe('По 2 закрытым играм из 3 за всё время')
    expect(basis(1, 1)).toBe('По 1 закрытой игре из 1 за всё время')
    expect(basis(21, 30)).toBe('По 21 закрытой игре из 30 за всё время')
    expect(basis(11, 12)).toBe('По 11 закрытым играм из 12 за всё время')
  })

  it('называет год', () => {
    expect(basis(2, 3, 2026)).toBe('По 2 закрытым играм из 3 за 2026')
    expect(periodText(2025)).toBe('за 2025')
    expect(periodText(null)).toBe('за всё время')
  })
})

describe('один знак после запятой', () => {
  it('округляет и всегда пишет десятые', () => {
    expect(formatTenths(1)).toBe('1,0')
    expect(formatTenths(1.25)).toBe('1,3')
    expect(formatTenths(2 / 3)).toBe('0,7')
    expect(formatTenths(0)).toBe('0,0')
  })

  it('со знаком: плюс, минус, ноль без знака', () => {
    expect(formatTenths(1, true)).toBe('+1,0')
    expect(formatTenths(-0.44, true)).toBe('−0,4')
    expect(formatTenths(0.04, true)).toBe('0,0')
  })
})
