import { describe, expect, it } from 'vitest'
import { aroundTable, betSlider, seatSpot, sliderAmount, sliderIndex, stepAmount } from './pokerLayout'

const seats = (me: number, n = 5) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, isMe: i === me }))

describe('рассадка вокруг стола', () => {
  it('я — первым, дальше по порядку мест по кругу', () => {
    expect(aroundTable(seats(2)).map((s) => s.id)).toEqual(['p2', 'p3', 'p4', 'p0', 'p1'])
    expect(aroundTable(seats(0)).map((s) => s.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(aroundTable(seats(4)).map((s) => s.id)).toEqual(['p4', 'p0', 'p1', 'p2', 'p3'])
    // Меня нет за столом — по порядку мест
    expect(aroundTable(seats(-1)).map((s) => s.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
  })

  it('первое место — внизу по центру, следующие — по часовой: влево, вверх, вправо', () => {
    expect(seatSpot(0, 4)).toEqual({ x: 50, y: 100 })
    expect(seatSpot(1, 4)).toEqual({ x: 0, y: 50 })
    expect(seatSpot(2, 4)).toEqual({ x: 50, y: 0 })
    expect(seatSpot(3, 4)).toEqual({ x: 100, y: 50 })
    // Двое — друг напротив друга
    expect(seatSpot(1, 2)).toEqual({ x: 50, y: 0 })
  })

  it('девять мест — все внутри рамки и разные; ставка — ближе к центру', () => {
    const spots = Array.from({ length: 9 }, (_, i) => seatSpot(i, 9))
    for (const p of spots) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(100)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(100)
    }
    expect(new Set(spots.map((p) => `${p.x}:${p.y}`)).size).toBe(9)
    expect(spots[1].x).toBeLessThan(50) // следующий за мной — слева
    expect(spots[8].x).toBeGreaterThan(50) // предыдущий — справа
    expect(seatSpot(0, 9, 0.6)).toEqual({ x: 50, y: 80 })
    expect(seatSpot(2, 4, 0)).toEqual({ x: 50, y: 50 })
  })
})

describe('ползунок ставки', () => {
  it('от минимума до олл-ина шагом малого блайнда; последний шаг — до олл-ина', () => {
    const s = betSlider({ min: 20, max: 1003 }, 5)
    expect(s).toEqual({ min: 20, max: 1003, step: 5, steps: 197 })
    if (!s) return
    expect(sliderAmount(s, 0)).toBe(20)
    expect(sliderAmount(s, 1)).toBe(25)
    expect(sliderAmount(s, 196)).toBe(1000)
    expect(sliderAmount(s, 197)).toBe(1003)
    expect(sliderAmount(s, -3)).toBe(20)
    expect(sliderAmount(s, 500)).toBe(1003)
  })

  it('повысить нельзя или можно только олл-ин — ползунка нет', () => {
    expect(betSlider(null, 5)).toBeNull()
    expect(betSlider({ min: 15, max: 15 }, 5)).toBeNull()
    expect(betSlider({ min: 20, max: 15 }, 5)).toBeNull()
    // Шаг не меньше фишки
    expect(betSlider({ min: 2, max: 10 }, 0)).toEqual({ min: 2, max: 10, step: 1, steps: 8 })
  })

  it('своя сумма и быстрые кнопки двигают ползунок к ближайшему шагу', () => {
    const s = betSlider({ min: 20, max: 1000 }, 5)!
    expect(sliderIndex(s, 20)).toBe(0)
    expect(sliderIndex(s, 22)).toBe(0)
    expect(sliderIndex(s, 23)).toBe(1)
    expect(sliderIndex(s, 35)).toBe(3)
    expect(sliderIndex(s, 1000)).toBe(s.steps)
    expect(sliderIndex(s, 5000)).toBe(s.steps)
    expect(sliderIndex(s, 3)).toBe(0)
  })

  it('колесо мыши — на шаг; сумма между шагами — к соседнему шагу; не за границы', () => {
    const s = betSlider({ min: 20, max: 1003 }, 5)!
    expect(stepAmount(s, 20, 1)).toBe(25)
    expect(stepAmount(s, 25, -1)).toBe(20)
    expect(stepAmount(s, 20, -1)).toBe(20)
    expect(stepAmount(s, 22, 1)).toBe(25)
    expect(stepAmount(s, 22, -1)).toBe(20)
    expect(stepAmount(s, 1000, 1)).toBe(1003)
    expect(stepAmount(s, 1003, 1)).toBe(1003)
    expect(stepAmount(s, 1003, -1)).toBe(1000)
  })
})
