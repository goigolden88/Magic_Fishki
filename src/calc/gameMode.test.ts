import { describe, expect, it } from 'vitest'
import { createGame, type CasinoRound, type Entry, type Game } from '../model'
import { gameResult } from './casino'
import { demoGames } from './demo'
import { addCasino, addPoker, gameMode } from './gameMode'

// Выдуманная игра
const NOW = '2026-10-26T20:00:00.000Z'
const players = [
  { id: 'p1', name: 'Анна' },
  { id: 'p2', name: 'Борис' },
]
const entries: Entry[] = [
  { id: 'e1', playerId: 'p1', kind: 'buyin', chips: 1000, at: NOW },
  { id: 'e2', playerId: 'p2', kind: 'buyin', chips: 1000, at: NOW },
]
const rounds: CasinoRound[] = [
  {
    id: 'r1',
    amounts: [
      { playerId: 'p1', kopecks: 15000 },
      { playerId: 'p2', kopecks: -15000 },
    ],
    at: NOW,
  },
]

function game(over: Partial<Game> = {}): Game {
  return { id: 'g1', name: 'Пятница', date: '2026-10-26', rate: 0.5, players, entries: [], updatedAt: NOW, ...over }
}

function counter(): () => string {
  let n = 0
  return () => `id${++n}`
}

describe('режим игры по данным — игры до Р-29', () => {
  it('раунды без покерных записей — «только казино»', () => {
    expect(gameMode(game({ casino: rounds }))).toBe('casino')
  })

  it('и раунды, и покерные записи — «покер и казино»', () => {
    expect(gameMode(game({ entries, casino: rounds }))).toBe('mixed')
  })

  it('раундов нет — «покер», в том числе пустая игра и пустой список раундов', () => {
    expect(gameMode(game({ entries }))).toBe('poker')
    expect(gameMode(game())).toBe('poker')
    expect(gameMode(game({ entries, casino: [] }))).toBe('poker')
  })

  it('поле режима главнее данных', () => {
    expect(gameMode(game({ mode: 'casino' }))).toBe('casino')
    expect(gameMode(game({ entries, mode: 'mixed' }))).toBe('mixed')
  })

  it('демо-игры — режим по данным, поля нет', () => {
    for (const g of demoGames('2026-10-26', NOW, counter())) {
      expect(g.mode).toBeUndefined()
      const rounds = g.casino?.length ?? 0
      expect(gameMode(g)).toBe(rounds === 0 ? 'poker' : g.entries.length === 0 ? 'casino' : 'mixed')
    }
  })
})

describe('новая игра с режимом (Р-29)', () => {
  const regulars = [
    { id: 'r-a', name: 'Анна' },
    { id: 'r-b', name: 'Борис' },
  ]
  const input = { name: 'Пятница', date: '2026-10-26', rate: 0.5, players: regulars, now: NOW }

  it('«только казино» — без закупа, даже если он передан; игра сходится', () => {
    const g = createGame({ ...input, buyin: 1000, mode: 'casino' }, counter())
    expect(g.mode).toBe('casino')
    expect(g.entries).toEqual([])
    expect(g.players.map((p) => p.name)).toEqual(['Анна', 'Борис'])
    expect(gameMode(g)).toBe('casino')
    expect(gameResult(g).ok).toBe(true)
  })

  it('«покер» по умолчанию, закуп — как раньше; «покер и казино» — тоже с закупом', () => {
    const poker = createGame({ ...input, buyin: 1000 }, counter())
    expect(poker.mode).toBe('poker')
    expect(poker.entries).toHaveLength(2)
    const mixed = createGame({ ...input, buyin: 1000, mode: 'mixed' }, counter())
    expect(mixed.mode).toBe('mixed')
    expect(mixed.entries).toHaveLength(2)
  })
})

describe('смена режима (Р-29)', () => {
  it('«покер» → «покер и казино»: записи и курс те же', () => {
    const poker = game({ entries, mode: 'poker' })
    expect(addCasino(poker)).toEqual({ ...poker, mode: 'mixed' })
    // Старая игра без поля — тоже
    expect(gameMode(addCasino(game({ entries })))).toBe('mixed')
  })

  it('«только казино» → «покер и казино»: курс — из настроек, раунды те же', () => {
    const casino = game({ casino: rounds, mode: 'casino', rate: 0.5 })
    expect(addPoker(casino, 1)).toEqual({ ...casino, mode: 'mixed', rate: 1 })
    expect(gameMode(addPoker(game({ casino: rounds }), 1))).toBe('mixed')
  })

  it('обратного перехода нет: из «покер и казино» — как была; «покер» не получает покер, «казино» — казино', () => {
    const mixed = game({ entries, casino: rounds, mode: 'mixed' })
    expect(addCasino(mixed)).toBe(mixed)
    expect(addPoker(mixed, 1)).toBe(mixed)
    const poker = game({ entries, mode: 'poker' })
    expect(addPoker(poker, 1)).toBe(poker)
    const casino = game({ mode: 'casino' })
    expect(addCasino(casino)).toBe(casino)
  })
})
