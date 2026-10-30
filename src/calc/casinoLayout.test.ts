import { describe, expect, it } from 'vitest'
import { maxTables, type DealKind } from './casinoDeal'
import { casinoLayout, layoutBoxes, MAX_CASINO_SEATS, MIN_WIDTH, overlaps } from './casinoLayout'

const KINDS: DealKind[] = ['holdem', 'omaha']

// Все раскладки, что может раздать экран: 2–10 участников и столов — сколько хватит колоды
function every(): { kind: DealKind; n: number; m: number }[] {
  const out: { kind: DealKind; n: number; m: number }[] = []
  for (const kind of KINDS)
    for (let n = 2; n <= MAX_CASINO_SEATS; n++) for (let m = 1; m <= maxTables(kind, n); m++) out.push({ kind, n, m })
  return out
}

describe('раскладка казино-стола', () => {
  it('холдем на 10 и омаха на пределе колоды — есть среди раскладок', () => {
    const all = every()
    expect(all).toContainEqual({ kind: 'holdem', n: 10, m: 5 })
    expect(all).toContainEqual({ kind: 'omaha', n: 6, m: 5 })
    expect(all).toContainEqual({ kind: 'omaha', n: 10, m: 1 })
  })

  it('каждый участник сидит ровно один раз, места — по часовой: верх слева направо, низ справа налево', () => {
    for (const { kind, n, m } of every()) {
      const l = casinoLayout(kind, n, m)
      const seated = [...l.top.flat(), ...l.bottom.flat()]
      expect([...seated].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i))
      for (const row of [...l.top, ...l.bottom]) expect(row.length).toBeLessThanOrEqual(l.perRow)
    }
    const l = casinoLayout('holdem', 6, 5)
    expect(l.top).toEqual([[0, 1, 2]])
    expect(l.bottom).toEqual([[5, 4, 3]])
  })

  it('на 320 px без полей — без прокрутки вбок: ширина не больше 18rem', () => {
    for (const { kind, n, m } of every()) {
      const l = casinoLayout(kind, n, m)
      expect(l.width).toBeLessThanOrEqual(MIN_WIDTH)
      const { seats, center } = layoutBoxes(l)
      for (const b of [...seats, center]) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w).toBeLessThanOrEqual(l.width + 1e-6)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y + b.h).toBeLessThanOrEqual(l.height + 1e-6)
      }
    }
  })

  it('места не наезжают ни на столы, ни друг на друга', () => {
    for (const { kind, n, m } of every()) {
      const { seats, center } = layoutBoxes(casinoLayout(kind, n, m))
      expect(seats.filter(Boolean)).toHaveLength(n)
      seats.forEach((a, i) => {
        expect(overlaps(a, center), `${kind} ${n}×${m}: место ${i} на столах`).toBe(false)
        seats.forEach((b, k) => k > i && expect(overlaps(a, b), `${kind} ${n}×${m}: места ${i} и ${k}`).toBe(false))
      })
    }
  })

  it('столы — колонкой: высота центра растёт со столами, карты не сжимаются', () => {
    const one = casinoLayout('holdem', 10, 1)
    const five = casinoLayout('holdem', 10, 5)
    expect(five.center.h).toBeGreaterThan(4 * one.center.h)
    expect(five.height - one.height).toBeCloseTo(five.center.h - one.center.h)
    expect(five.boardCard).toEqual(one.boardCard)
    expect(five.hand).toEqual(one.hand)
  })

  it('холдем — по четыре места в ряду, омаха — по три: четыре карты руки мельче', () => {
    expect(casinoLayout('holdem', 10, 5).perRow).toBe(4)
    expect(casinoLayout('omaha', 10, 1).perRow).toBe(3)
    expect(casinoLayout('omaha', 10, 1).hand.w).toBeLessThan(casinoLayout('holdem', 10, 1).hand.w)
    // 10 омахой: по пять сверху и снизу — в два ряда, длинный первым
    expect(casinoLayout('omaha', 10, 1).top).toEqual([[0, 1, 2], [3, 4]])
    expect(casinoLayout('omaha', 10, 1).bottom).toEqual([[9, 8, 7], [6, 5]])
  })

  it('больше 10 участников или ноль столов — ошибка', () => {
    expect(() => casinoLayout('holdem', MAX_CASINO_SEATS + 1, 1)).toThrow('до 10')
    expect(() => casinoLayout('holdem', 0, 1)).toThrow()
    expect(() => casinoLayout('holdem', 4, 0)).toThrow('Столов')
  })

  it('пересечение: общая сторона — не наезд', () => {
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false)
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true)
  })
})
