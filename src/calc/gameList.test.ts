import { describe, expect, it } from 'vitest'
import type { Game } from '../model'
import { formatDate } from '../dates'
import { formatNumber } from './format'
import { defaultOpenYear, gameSummary, groupByYear, isYearOpen } from './gameList'

// Выдуманные игры
function game(id: string, date: string, extra: Partial<Game> = {}): Game {
  return {
    id,
    name: formatDate(date),
    date,
    rate: 0.5,
    players: [],
    entries: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  }
}

describe('groupByYear', () => {
  it('группы по году, новые сверху, порядок внутри сохраняется', () => {
    const games = [game('d', '2026-03-01'), game('c', '2026-01-10'), game('b', '2025-12-31'), game('a', '2024-05-05')]
    const groups = groupByYear(games)
    expect(groups.map((g) => g.year)).toEqual(['2026', '2025', '2024'])
    expect(groups[0].games.map((g) => g.id)).toEqual(['d', 'c'])
    expect(groups[1].games.map((g) => g.id)).toEqual(['b'])
  })

  it('игр нет — групп нет', () => {
    expect(groupByYear([])).toEqual([])
  })
})

describe('defaultOpenYear и isYearOpen', () => {
  const groups = groupByYear([game('b', '2025-06-01'), game('a', '2024-06-01')])

  it('текущий год с играми — раскрыт он', () => {
    const withCurrent = groupByYear([game('c', '2026-01-01'), game('b', '2025-06-01')])
    expect(defaultOpenYear(withCurrent, '2026')).toBe('2026')
  })

  it('в текущем году игр нет — самый свежий год с играми', () => {
    expect(defaultOpenYear(groups, '2026')).toBe('2025')
  })

  it('игр нет — ничего', () => {
    expect(defaultOpenYear([], '2026')).toBeNull()
  })

  it('без выбора — раскрыт только год по умолчанию; выбор человека главнее', () => {
    expect(isYearOpen('2025', {}, '2025')).toBe(true)
    expect(isYearOpen('2024', {}, '2025')).toBe(false)
    expect(isYearOpen('2025', { '2025': false }, '2025')).toBe(false)
    expect(isYearOpen('2024', { '2024': true }, '2025')).toBe(true)
  })
})

describe('gameSummary', () => {
  const players = [
    { id: 'p1', name: 'Анна' },
    { id: 'p2', name: 'Борис' },
  ]
  const entries = [
    { id: 'e1', playerId: 'p1', kind: 'buyin' as const, chips: 1000, at: '2026-10-09T18:00:00.000Z' },
    { id: 'e2', playerId: 'p2', kind: 'buyin' as const, chips: 1000, at: '2026-10-09T18:00:00.000Z' },
    { id: 'e3', playerId: 'p1', kind: 'cashout' as const, chips: 1500, at: '2026-10-09T23:00:00.000Z' },
    { id: 'e4', playerId: 'p2', kind: 'cashout' as const, chips: 500, at: '2026-10-09T23:00:00.000Z' },
  ]

  it('название — дата: дата не повторяется', () => {
    const g = game('a', '2026-10-09', { players, entries, closed: true })
    expect(gameSummary(g)).toBe(`игроков 2 · закуплено ${formatNumber(2000)} · закрыта`)
  })

  it('своё название — дата остаётся', () => {
    const g = game('a', '2026-10-09', { name: 'День рождения', players, entries })
    expect(gameSummary(g)).toBe(`${formatDate('2026-10-09')} · игроков 2 · закуплено ${formatNumber(2000)} · сходится`)
  })

  it('без записей — «записей нет»', () => {
    expect(gameSummary(game('a', '2026-10-09', { players }))).toBe('игроков 2 · закуплено 0 · записей нет')
  })

  it('только казино — о казино, статус «закрыта» как у остальных', () => {
    const casino = [
      {
        id: 'r1',
        amounts: [
          { playerId: 'p1', kopecks: 15000 },
          { playerId: 'p2', kopecks: -15000 },
        ],
        at: '2026-10-09T20:00:00.000Z',
      },
    ]
    const open = game('a', '2026-10-09', { players, casino })
    expect(gameSummary(open)).toBe('игроков 2 · только казино · раундов 1')
    expect(gameSummary({ ...open, closed: true })).toBe('игроков 2 · только казино · раундов 1 · закрыта')
    // Новая игра «только казино» без раундов (Р-29)
    expect(gameSummary(game('b', '2026-10-09', { players, mode: 'casino' }))).toBe(
      'игроков 2 · только казино · раундов нет',
    )
  })

  it('покер и казино — покерная строка с пометкой «казино» (Р-29)', () => {
    const casino = [
      {
        id: 'r1',
        amounts: [
          { playerId: 'p1', kopecks: 15000 },
          { playerId: 'p2', kopecks: -15000 },
        ],
        at: '2026-10-09T20:00:00.000Z',
      },
    ]
    const g = game('a', '2026-10-09', { players, entries, casino })
    expect(gameSummary(g)).toBe(`игроков 2 · закуплено ${formatNumber(2000)} · сходится · казино`)
    // Режим «покер и казино» без раундов — пометка тоже есть
    expect(gameSummary(game('b', '2026-10-09', { players, entries, mode: 'mixed' }))).toBe(
      `игроков 2 · закуплено ${formatNumber(2000)} · сходится · казино`,
    )
  })
})
