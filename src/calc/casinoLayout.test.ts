import { describe, expect, it } from 'vitest'
import { maxTables, type DealKind } from './casinoDeal'
import {
  boardCols,
  casinoLayout,
  layoutBoxes,
  MAX_CASINO_SEATS,
  MIN_WIDTH,
  overlaps,
  PHONE_COLS,
  PHONE_FIT,
  PHONE_MAX_WIDTH,
  phoneSpace,
  WIDE_WIDTH,
} from './casinoLayout'

const KINDS: DealKind[] = ['holdem', 'omaha']
const PHONE_390 = 19.88 // 390 px без полей по 16 px при rem = 18 px

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

  it('телефон: столы по два в ряду, высота растёт рядами столов, карты не сжимаются', () => {
    const one = casinoLayout('holdem', 10, 1)
    const five = casinoLayout('holdem', 10, 5)
    expect(one.cols).toBe(1)
    expect(five.cols).toBe(PHONE_COLS)
    expect(five.center.h).toBeCloseTo(3 * five.board.h + 2 * five.gap) // 2 + 2 + 1
    expect(five.height - one.height).toBeCloseTo(five.center.h - one.center.h)
    expect(five.boardCard).toEqual(one.boardCard)
    expect(five.hand).toEqual(one.hand)
  })

  it('строка победителя (Р-50): пять мелких карт — внутри стола, высота стола — с их рядом', () => {
    for (const { kind, n, m } of every()) {
      const l = casinoLayout(kind, n, m)
      expect(l.winRow.w).toBeLessThanOrEqual(l.board.w - 0.52) // без полей стола
      expect(l.winRow.w).toBeGreaterThanOrEqual(5 * l.winCard.w)
      expect(l.winRow.h).toBeGreaterThanOrEqual(l.winCard.h)
      expect(l.winCard.w).toBeLessThan(l.boardCard.w)
      // стол: подпись, пять карт, строка победителя с её рядом и поля — ряд учтён в высоте
      expect(l.board.h).toBeGreaterThanOrEqual(l.boardCard.h + l.winRow.h + 1.92)
      const boardRows = Math.ceil(m / l.cols)
      expect(l.center.h).toBeCloseTo(boardRows * l.board.h + (boardRows - 1) * l.gap)
    }
  })

  it('на 320 px: до пяти мест холдема в ряду, омаха — по три; у омахи четыре карты руки мельче', () => {
    expect(casinoLayout('holdem', 10, 5).perRow).toBe(5)
    expect(casinoLayout('omaha', 10, 1).perRow).toBe(3)
    // 10 холдемом не входят в ряд — пополам: по пять сверху и снизу
    expect(casinoLayout('holdem', 10, 5).top).toEqual([[0, 1, 2, 3, 4]])
    expect(casinoLayout('holdem', 10, 5).bottom).toEqual([[9, 8, 7, 6, 5]])
    expect(casinoLayout('omaha', 10, 1).hand.w).toBeLessThan(casinoLayout('holdem', 10, 1).hand.w)
    // 10 омахой: по пять сверху и снизу — в два ряда, длинный первым
    expect(casinoLayout('omaha', 10, 1).top).toEqual([[0, 1, 2], [3, 4]])
    expect(casinoLayout('omaha', 10, 1).bottom).toEqual([[9, 8, 7], [6, 5]])
  })

  it('ширина сукна на телефоне — колонка экрана в rem: от 16 до 40rem', () => {
    expect(phoneSpace(390, 18)).toBe(PHONE_390)
    expect(phoneSpace(375, 18)).toBe(19.05)
    expect(phoneSpace(320, 18)).toBe(MIN_WIDTH)
    expect(phoneSpace(280, 18)).toBe(MIN_WIDTH) // уже 320 px — не сжимается
    expect(phoneSpace(800, 18)).toBeCloseTo(33.77) // планшет: колонка экрана не шире 640 px
    expect(phoneSpace(800, 12)).toBe(PHONE_MAX_WIDTH)
  })

  it('телефон 390 × 844 (Р-66): 3–6 участников и 5 столов холдема — места одним рядом сверху, сукно не выше 22,5rem', () => {
    for (const space of [PHONE_390, phoneSpace(375, 18)]) {
      for (let n = 3; n <= 6; n++) {
        const l = casinoLayout('holdem', n, 5, false, space)
        expect(l.top, `${n} на ${space}rem`).toEqual([Array.from({ length: n }, (_, i) => i)])
        expect(l.bottom).toEqual([])
        expect(l.cols).toBe(2)
        expect(l.height, `${n} на ${space}rem`).toBeLessThanOrEqual(PHONE_FIT)
      }
    }
    // Число в описании (02-Экраны-учёта): 22,5rem = 405 px при rem = 18 px
    expect(PHONE_FIT * 18).toBe(405)
    // 2 участника — тоже одним рядом; 6 столов — те же три ряда столов
    expect(casinoLayout('holdem', 2, 5, false, PHONE_390).top).toEqual([[0, 1]])
    expect(casinoLayout('holdem', 6, 6, false, PHONE_390).height).toBeLessThanOrEqual(PHONE_FIT)
  })

  it('телефон 390: 7–10 участников не входят в ряд — пополам, сверху и снизу; экран листается', () => {
    for (let n = 7; n <= 10; n++) {
      const l = casinoLayout('holdem', n, 5, false, PHONE_390)
      expect(l.top.flat()).toHaveLength(Math.ceil(n / 2))
      expect(l.bottom.flat()).toHaveLength(Math.floor(n / 2))
      expect(l.height).toBeGreaterThan(PHONE_FIT)
    }
    expect(casinoLayout('holdem', 7, 5, false, PHONE_390).top).toEqual([[0, 1, 2, 3]])
    expect(casinoLayout('holdem', 7, 5, false, PHONE_390).bottom).toEqual([[6, 5, 4]])
    expect(casinoLayout('holdem', 3, 7, false, PHONE_390).height).toBeGreaterThan(PHONE_FIT) // 7 столов — четыре ряда
  })

  it('телефон: ранг и масть читаются — шрифт карты (0,6 её ширины) не мельче 0,5rem, у мест и стола — 0,6rem', () => {
    for (const kind of KINDS) {
      const l = casinoLayout(kind, 6, 1, false, PHONE_390)
      expect(l.hand.w * 0.6).toBeGreaterThanOrEqual(0.6)
      expect(l.boardCard.w * 0.6).toBeGreaterThanOrEqual(0.6)
      expect(l.winCard.w * 0.6).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('телефон на любой ширине от 320 px до планшета: не шире сукна, места не наезжают ни на столы, ни друг на друга', () => {
    for (const space of [MIN_WIDTH, phoneSpace(375, 18), PHONE_390, phoneSpace(430, 18), phoneSpace(800, 18)]) {
      for (const { kind, n, m } of every()) {
        const l = casinoLayout(kind, n, m, false, space)
        const label = `${kind} ${n}×${m} на ${space}rem`
        expect(l.width, label).toBeLessThanOrEqual(space + 1e-6)
        expect(l.center.w + 1, `${label}: столы внутри бортика`).toBeLessThanOrEqual(space + 1e-6)
        const seated = [...l.top.flat(), ...l.bottom.flat()]
        expect([...seated].sort((a, b) => a - b), label).toEqual(Array.from({ length: n }, (_, i) => i))
        for (const row of [...l.top, ...l.bottom]) expect(row.length).toBeLessThanOrEqual(l.perRow)
        const { seats, center } = layoutBoxes(l)
        for (const b of [...seats, center]) {
          expect(b.x, label).toBeGreaterThanOrEqual(0)
          expect(b.x + b.w, label).toBeLessThanOrEqual(l.width + 1e-6)
          expect(b.y + b.h, label).toBeLessThanOrEqual(l.height + 1e-6)
        }
        seats.forEach((a, i) => {
          expect(overlaps(a, center), `${label}: место ${i} на столах`).toBe(false)
          seats.forEach((b, k) => k > i && expect(overlaps(a, b), `${label}: места ${i} и ${k}`).toBe(false))
        })
      }
    }
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
      // ряд карт победителя — внутри стола
      expect(wide.winRow.w).toBeLessThanOrEqual(wide.board.w - 0.6)
      // карты руки читаемые: не меньше половины карты стола, крупнее, чем на телефоне
      expect(wide.winCard.w).toBeGreaterThanOrEqual(wide.boardCard.w / 2)
      expect(wide.winCard.h).toBeGreaterThanOrEqual(wide.boardCard.h / 2)
      expect(wide.winCard.w).toBeGreaterThan(phone.winCard.w)
      expect(wide.winRow.h).toBeGreaterThanOrEqual(wide.winCard.h)
      // стол: подпись и строка победителя (1,4), вторая строка «Имя · рука» (0,96), ряд карт победителя и поля
      expect(wide.board.h).toBeCloseTo(wide.boardCard.h + 1.4 + 0.96 + wide.winRow.h + 0.6)
      // карты на широком окне крупнее телефонных (Р-66)
      expect(wide.boardCard.w).toBeGreaterThan(phone.boardCard.w)
      expect(wide.hand.w).toBeGreaterThan(phone.hand.w)
    }
  })

  it('широкое окно — как до Р-66: те же размеры, места пополам, ширина сукна на телефоне не влияет', () => {
    const five = casinoLayout('holdem', 10, 5, true)
    expect(five).toMatchObject({
      hand: { w: 1.7, h: 2.35 },
      seat: { w: 4.8, h: 4.75 },
      boardCard: { w: 2.2, h: 3.05 },
      board: { w: 12.4, h: 8.16 },
      winCard: { w: 1.4, h: 1.95 },
      winRow: { w: 7.24, h: 2.15 },
      gap: 0.3,
      centerPad: 0.6,
      perRow: 12,
    })
    expect(casinoLayout('omaha', 3, 2, true)).toMatchObject({ hand: { w: 1.1, h: 1.55 }, seat: { w: 4.98, h: 3.95 } })
    // 3 участника — по-прежнему 2 сверху и 1 снизу
    expect(casinoLayout('holdem', 3, 5, true).top).toEqual([[0, 1]])
    expect(casinoLayout('holdem', 3, 5, true).bottom).toEqual([[2]])
    for (const { kind, n, m } of every()) {
      expect(casinoLayout(kind, n, m, true, PHONE_390)).toEqual(casinoLayout(kind, n, m, true))
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

  it('телефон (Р-66): столы по два в ряд, один стол — один; по умолчанию — ширина 320 px', () => {
    for (const { kind, n, m } of every()) {
      const l = casinoLayout(kind, n, m)
      expect(l.wide).toBe(false)
      expect(l.cols).toBe(Math.min(2, m))
      expect(l.center.w).toBeCloseTo(l.cols * l.board.w + (l.cols - 1) * l.gap)
      expect(casinoLayout(kind, n, m, false, MIN_WIDTH)).toEqual(l)
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
