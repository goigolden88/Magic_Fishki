import { describe, expect, it } from 'vitest'
import { maxTables, type DealKind } from './casinoDeal'
import {
  boardCols,
  casinoLayout,
  layoutBoxes,
  MAX_CASINO_SEATS,
  MIN_WIDTH,
  overlaps,
  WIDE_WIDTH,
} from './casinoLayout'

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

  it('на 320 px без полей — без прокрутки вбок: ширина не больше 16rem', () => {
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

  it('строка победителя (Р-50): пять мелких карт — внутри стола, высота стола — с их рядом', () => {
    for (const { kind, n, m } of every()) {
      const l = casinoLayout(kind, n, m)
      expect(l.winRow.w).toBeLessThanOrEqual(l.board.w - 0.6) // без полей стола
      expect(l.winRow.w).toBeGreaterThanOrEqual(5 * l.winCard.w)
      expect(l.winRow.h).toBeGreaterThanOrEqual(l.winCard.h)
      expect(l.winCard.w).toBeLessThan(l.boardCard.w)
      // стол: подпись, пять карт, строка победителя с её рядом и поля — ряд учтён в высоте
      expect(l.board.h).toBeGreaterThanOrEqual(l.boardCard.h + l.winRow.h + 1.4)
      expect(l.center.h).toBeCloseTo(m * l.board.h + (m - 1) * 0.3)
    }
  })

  it('по три места в ряду; у омахи четыре карты руки мельче', () => {
    expect(casinoLayout('holdem', 10, 5).perRow).toBe(3)
    expect(casinoLayout('omaha', 10, 1).perRow).toBe(3)
    expect(casinoLayout('holdem', 10, 5).top).toEqual([[0, 1, 2], [3, 4]])
    expect(casinoLayout('omaha', 10, 1).hand.w).toBeLessThan(casinoLayout('holdem', 10, 1).hand.w)
    // 10 омахой: по пять сверху и снизу — в два ряда, длинный первым
    expect(casinoLayout('omaha', 10, 1).top).toEqual([[0, 1, 2], [3, 4]])
    expect(casinoLayout('omaha', 10, 1).bottom).toEqual([[9, 8, 7], [6, 5]])
  })

  it('широкое окно (Р-53): не шире колонки экрана, места не наезжают ни на столы, ни друг на друга', () => {
    for (const { kind, n, m } of every()) {
      const l = casinoLayout(kind, n, m, true)
      expect(l.wide).toBe(true)
      expect(l.width).toBeLessThanOrEqual(WIDE_WIDTH)
      const { seats, center } = layoutBoxes(l)
      expect(seats.filter(Boolean)).toHaveLength(n)
      for (const b of [...seats, center]) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w).toBeLessThanOrEqual(l.width + 1e-6)
        expect(b.y + b.h).toBeLessThanOrEqual(l.height + 1e-6)
      }
      seats.forEach((a, i) => {
        expect(overlaps(a, center), `${kind} ${n}×${m}: место ${i} на столах`).toBe(false)
        seats.forEach((b, k) => k > i && expect(overlaps(a, b), `${kind} ${n}×${m}: места ${i} и ${k}`).toBe(false))
      })
    }
  })

  it('широкое окно: столы рядами по 2–3, четыре — 2 × 2; каждый участник — ровно один раз', () => {
    expect([1, 2, 3, 4, 5].map(boardCols)).toEqual([1, 2, 3, 2, 3])
    const five = casinoLayout('holdem', 10, 5, true)
    expect(five.cols).toBe(3)
    expect(five.center.w).toBeCloseTo(3 * five.board.w + 2 * 0.3)
    expect(five.center.h).toBeCloseTo(2 * five.board.h + 0.3) // два ряда: 3 + 2
    const four = casinoLayout('holdem', 8, 4, true)
    expect(four.cols).toBe(2)
    expect(four.center.h).toBeCloseTo(2 * four.board.h + 0.3)
    // Места — в ряд на всю ширину: 10 участников — по пять сверху и снизу одним рядом
    expect(five.top).toEqual([[0, 1, 2, 3, 4]])
    expect(five.bottom).toEqual([[9, 8, 7, 6, 5]])
    for (const { kind, n, m } of every()) {
      const l = casinoLayout(kind, n, m, true)
      const seated = [...l.top.flat(), ...l.bottom.flat()]
      expect([...seated].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i))
    }
  })

  it('широкое окно (Р-60): строка победителя — под картами стола, карты руки не меньше половины карт стола', () => {
    for (const { kind, n, m } of every()) {
      const phone = casinoLayout(kind, n, m)
      const wide = casinoLayout(kind, n, m, true)
      // стол той же ширины, что на телефоне: пять карт стола и поля; ряд карт победителя — внутри
      expect(wide.board.w).toBe(phone.board.w)
      expect(wide.winRow.w).toBeLessThanOrEqual(wide.board.w - 0.6)
      // карты руки читаемые: не меньше половины карты стола, крупнее, чем на телефоне
      expect(wide.winCard.w).toBeGreaterThanOrEqual(wide.boardCard.w / 2)
      expect(wide.winCard.h).toBeGreaterThanOrEqual(wide.boardCard.h / 2)
      expect(wide.winCard.w).toBeGreaterThan(phone.winCard.w)
      expect(wide.winRow.h).toBeGreaterThanOrEqual(wide.winCard.h)
      // стол выше телефонного на вторую строку «Имя · рука» и на разницу рядов карт победителя
      expect(wide.board.h).toBeCloseTo(phone.board.h + 0.96 + wide.winRow.h - phone.winRow.h)
      expect(wide.boardCard).toEqual(phone.boardCard)
      expect(wide.hand).toEqual(phone.hand)
      expect(wide.seat).toEqual(phone.seat)
    }
  })

  it('широкое окно: 1, 2, 3, 6 столов — полными рядами, 5 — 3 + 2, высота — по рядам', () => {
    const cases: [number, number, number][] = [
      [1, 1, 1],
      [2, 2, 1],
      [3, 3, 1],
      [5, 3, 2],
      [6, 3, 2],
    ]
    for (const [m, cols, boardRows] of cases) {
      const l = casinoLayout('holdem', 2, m, true)
      expect(l.cols).toBe(cols)
      expect(l.center.w).toBeCloseTo(cols * l.board.w + (cols - 1) * 0.3)
      expect(l.center.h).toBeCloseTo(boardRows * l.board.h + (boardRows - 1) * 0.3)
    }
  })

  it('телефон — как прежде: столы колонкой, по столу в ряду', () => {
    for (const { kind, n, m } of every()) {
      const l = casinoLayout(kind, n, m)
      expect(l.wide).toBe(false)
      expect(l.cols).toBe(1)
      expect(l.center.w).toBe(l.board.w)
      expect(casinoLayout(kind, n, m, false)).toEqual(l)
    }
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
