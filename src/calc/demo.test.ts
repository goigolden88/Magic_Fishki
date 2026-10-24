import { describe, expect, it } from 'vitest'
import type { Game } from '../model'
import { makeBackup } from './backup'
import { gameResult } from './casino'
import { demoGames, hasDemo } from './demo'
import { regularStats } from './stats'

const TODAY = '2026-10-24'
const NOW = '2026-10-24T18:00:00.000Z'

function counter(): () => string {
  let n = 0
  return () => `id${++n}`
}

describe('демо-игры (Р-04)', () => {
  const games = demoGames(TODAY, NOW, counter())

  it('несколько игр, все с пометкой демо, названия начинаются с «Демо»', () => {
    expect(games.length).toBeGreaterThanOrEqual(3)
    for (const g of games) {
      expect(g.demo).toBe(true)
      expect(g.name).toMatch(/^Демо/)
      expect(g.updatedAt).toBe(NOW)
    }
  })

  it('дни — не позже сегодня, последняя игра — сегодня', () => {
    for (const g of games) expect(g.date <= TODAY).toBe(true)
    expect(games.map((g) => g.date)).toContain(TODAY)
    expect(games.map((g) => g.date)).toContain('2026-10-10')
  })

  it('id игр, участников, записей и раундов не повторяются', () => {
    const ids = games.flatMap((g) => [
      g.id,
      ...g.players.map((p) => p.id),
      ...g.entries.map((e) => e.id),
      ...(g.casino ?? []).map((r) => r.id),
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('участники — гости: связи с постоянными нет', () => {
    for (const g of games) for (const p of g.players) expect(p.regularId).toBeUndefined()
  })

  it('записи ссылаются на участников своей игры, фишки — целые больше нуля', () => {
    for (const g of games) {
      const ids = new Set(g.players.map((p) => p.id))
      for (const e of g.entries) {
        expect(ids.has(e.playerId)).toBe(true)
        expect(Number.isInteger(e.chips) && e.chips > 0).toBe(true)
        expect(e.at.slice(0, 4)).toBe('2026')
      }
      for (const r of g.casino ?? []) for (const a of r.amounts) expect(ids.has(a.playerId)).toBe(true)
    }
  })

  it('закрытые сходятся, есть казино в ноль; открытая не сходится — не записан выход', () => {
    const closed = games.filter((g) => g.closed)
    expect(closed.length).toBeGreaterThanOrEqual(2)
    for (const g of closed) expect(gameResult(g).ok).toBe(true)
    expect(closed.some((g) => gameResult(g).hasCasino)).toBe(true)

    const open = games.filter((g) => !g.closed)
    expect(open).toHaveLength(1)
    expect(gameResult(open[0]).balance.diff).toBeGreaterThan(0)
  })

  it('новый вызов — новые id: прежние демо не перезаписываются', () => {
    const again = demoGames(TODAY, NOW, () => `x${Math.random()}`)
    const first = new Set(games.map((g) => g.id))
    for (const g of again) expect(first.has(g.id)).toBe(false)
  })
})

describe('демо и остальное', () => {
  const regulars = [{ id: 'r-Аня', name: 'Аня' }]
  const demo = demoGames(TODAY, NOW, counter())
  const real: Game = {
    id: 'real',
    name: 'Пятница',
    date: '2026-10-01',
    rate: 0.5,
    players: [{ id: 'p1', name: 'Аня', regularId: 'r-Аня' }],
    entries: [],
    closed: true,
    updatedAt: NOW,
  }

  it('есть ли демо — по пометке', () => {
    expect(hasDemo([])).toBe(false)
    expect(hasDemo([real])).toBe(false)
    expect(hasDemo([real, ...demo])).toBe(true)
  })

  it('в статистику не входят: одни демо — закрытых игр нет', () => {
    expect(regularStats(regulars, demo)).toMatchObject({ closedGames: 0, totalGames: 0 })
    expect(regularStats(regulars, [real, ...demo])).toMatchObject({ closedGames: 1, totalGames: 1 })
  })

  it('в копию не идут', () => {
    const settings = { defaultRate: 0.5, players: regulars, quickAmounts: [], defaultBuyin: 1000, compareWindow: 5 }
    const backup = makeBackup([real, ...demo], settings, NOW)
    expect(backup.games.map((g) => g.id)).toEqual(['real'])
  })
})
