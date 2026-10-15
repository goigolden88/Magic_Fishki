import { describe, expect, it } from 'vitest'
import type { Entry, Game, Player } from '../model'
import { averageKopecks, change, playerTrend, rebuysAverage, windowTitle } from './trend'

// Выдуманные игры: курс 1 — фишка = рубль
type Row = { player: Player; buyin: number; rebuys?: number; cashout: number }

function makeGame(id: string, date: string, rows: Row[], extra: Partial<Game> = {}): Game {
  const entries: Entry[] = []
  const add = (playerId: string, kind: Entry['kind'], chips: number) =>
    entries.push({ id: `${id}-${entries.length}`, playerId, kind, chips, at: `${date}T20:00:00.000Z` })
  for (const row of rows) {
    add(row.player.id, 'buyin', row.buyin)
    for (let r = 0; r < (row.rebuys ?? 0); r++) add(row.player.id, 'rebuy', 100)
    add(row.player.id, 'cashout', row.cashout)
  }
  return {
    id,
    name: `Игра ${id}`,
    date,
    rate: 1,
    players: rows.map((r) => r.player),
    entries,
    closed: true,
    updatedAt: `${date}T23:00:00.000Z`,
    ...extra,
  }
}

const gleb = (id: string): Player => ({ id, name: 'Глеб', regularId: 'r-gleb' })
const dina = (id: string): Player => ({ id, name: 'Дина', regularId: 'r-dina' })

// Вечер Глеба: итог в рублях и число докупов по 100; Дина забирает разницу
function evening(n: number, rub: number, rebuys = 0): Game {
  const id = `g${String(n).padStart(2, '0')}`
  const spent = 1000 + rebuys * 100
  return makeGame(id, `2026-0${1 + Math.floor(n / 28)}-${String((n % 28) + 1).padStart(2, '0')}`, [
    { player: gleb(`${id}-a`), buyin: 1000, rebuys, cashout: spent + rub },
    { player: dina(`${id}-b`), buyin: 20000, cashout: 20000 - rub },
  ])
}

describe('динамика игрока: окна по 5 игр', () => {
  it('игр нет — пусто', () => {
    const t = playerTrend('r-gleb', [])
    expect(t).toEqual({ recent: null, previous: null, delta: null })
  })

  it('открытые и демо не входят', () => {
    const open = { ...evening(1, 500), closed: false }
    const demo = { ...evening(2, 500), demo: true }
    expect(playerTrend('r-gleb', [open, demo]).recent).toBeNull()
  })

  it('5 и меньше — только последние, без сравнения', () => {
    const games = [evening(1, 300, 1), evening(2, -100), evening(3, 200, 2)]
    const t = playerTrend('r-gleb', games)
    expect(t.recent).toEqual({ games: 3, kopecks: 40000, wins: 2, rebuys: 3 })
    expect(t.previous).toBeNull()
    expect(t.delta).toBeNull()
  })

  it('10 игр: последние 5 — новые по дате, разница по каждому показателю', () => {
    // Старые 1–5: итог 0 ₽, в плюсе 3, по 2 докупа; новые 6–10: итог +1500 ₽, в плюсе 4, по 1 докупу
    const old = [evening(1, 500, 2), evening(2, -1000, 2), evening(3, 500, 2), evening(4, -200, 2), evening(5, 200, 2)]
    const fresh = [evening(6, 400, 1), evening(7, 400, 1), evening(8, -100, 1), evening(9, 400, 1), evening(10, 400, 1)]
    // Подача старыми первыми — порядок задаёт дата
    const t = playerTrend('r-gleb', [...old, ...fresh])
    expect(t.recent).toEqual({ games: 5, kopecks: 150000, wins: 4, rebuys: 5 })
    expect(t.previous).toEqual({ games: 5, kopecks: 0, wins: 3, rebuys: 10 })
    expect(t.delta).toEqual({ kopecks: 150000, wins: 1, average: 30000, rebuys: -1 })
  })

  it('больше 10 игр — старше десятой не входят', () => {
    const games = Array.from({ length: 12 }, (_, i) => evening(i + 1, i < 2 ? 10000 : 100))
    const t = playerTrend('r-gleb', games)
    expect(t.previous!.games).toBe(5)
    expect(t.previous!.kopecks).toBe(50000)
  })

  it('от 6 до 9 — предыдущих сколько есть, сравнение по средним', () => {
    // Старые 1–2: +300 и −100 (в плюсе 1, по 1 докупу); новые 3–7: по +100, без докупов
    const games = [evening(1, 300, 1), evening(2, -100, 1), ...[3, 4, 5, 6, 7].map((n) => evening(n, 100))]
    const t = playerTrend('r-gleb', games)
    expect(t.recent).toEqual({ games: 5, kopecks: 50000, wins: 5, rebuys: 0 })
    expect(t.previous).toEqual({ games: 2, kopecks: 20000, wins: 1, rebuys: 2 })
    // Предыдущие приведены к 5 играм: итог 200 ₽ × 5/2 = 500 ₽, в плюсе 1 × 5/2 = 2,5
    expect(t.delta).toEqual({ kopecks: 0, wins: 2.5, average: 0, rebuys: -1 })
  })

  it('при равных датах — порядок как на «Играх»: больший id новее', () => {
    // Две игры одного дня старше четырёх январских: gb — новее ga
    const a = makeGame('ga', '2025-12-31', [
      { player: gleb('a1'), buyin: 1000, cashout: 1500 },
      { player: dina('a2'), buyin: 1000, cashout: 500 },
    ])
    const b = makeGame('gb', '2025-12-31', [
      { player: gleb('b1'), buyin: 1000, cashout: 500 },
      { player: dina('b2'), buyin: 1000, cashout: 1500 },
    ])
    const newer = [1, 2, 3, 4].map((n) => evening(n, 0))
    // Последние 5: четыре январские и gb (−500 ₽); в предыдущих — ga (+500 ₽)
    const t = playerTrend('r-gleb', [a, ...newer, b])
    expect(t.recent!.kopecks).toBe(-50000)
    expect(t.previous).toEqual({ games: 1, kopecks: 50000, wins: 1, rebuys: 0 })
  })

  it('постоянный дважды в одной игре — один вечер; чужие игры не считаются', () => {
    const twice = makeGame('gt', '2026-04-01', [
      { player: gleb('t1'), buyin: 100, rebuys: 1, cashout: 500 },
      { player: gleb('t2'), buyin: 100, cashout: 0 },
    ])
    const without = makeGame('gw', '2026-04-02', [{ player: dina('w1'), buyin: 100, cashout: 100 }])
    const t = playerTrend('r-gleb', [twice, without])
    expect(t.recent).toEqual({ games: 1, kopecks: 20000, wins: 1, rebuys: 1 })
  })
})

describe('средние окна', () => {
  it('средний итог — целыми копейками, докупы — как есть', () => {
    const w = { games: 3, kopecks: 10000, wins: 1, rebuys: 2 }
    expect(averageKopecks(w)).toBe(3333)
    expect(rebuysAverage(w)).toBeCloseTo(0.667, 3)
  })
})

describe('лучше или хуже', () => {
  it('больше — лучше; для докупов — наоборот', () => {
    expect(change(500)).toBe('better')
    expect(change(-500)).toBe('worse')
    expect(change(0)).toBe('same')
    expect(change(-0.4, true)).toBe('better')
    expect(change(0.4, true)).toBe('worse')
    expect(change(0, true)).toBe('same')
  })
})

describe('заголовок окна', () => {
  it('падеж по числу', () => {
    expect(windowTitle('recent', 5)).toBe('Последние 5 игр')
    expect(windowTitle('recent', 3)).toBe('Последние 3 игры')
    expect(windowTitle('recent', 1)).toBe('Последняя игра')
    expect(windowTitle('previous', 4)).toBe('Предыдущие 4 игры')
    expect(windowTitle('previous', 1)).toBe('Предыдущая игра')
    expect(windowTitle('previous', 5)).toBe('Предыдущие 5 игр')
  })
})
