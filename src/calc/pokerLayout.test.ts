import { describe, expect, it } from 'vitest'
import {
  aroundTable,
  betSide,
  betSlider,
  dockOf,
  SEAT_H,
  SEAT_W,
  seatSpots,
  sliderAmount,
  sliderIndex,
  stepAmount,
  waitLine,
} from './pokerLayout'

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
    expect(seatSpots(4)).toEqual([
      { x: 50, y: 100 },
      { x: 0, y: 45 },
      { x: 50, y: 0 },
      { x: 100, y: 45 },
    ])
    // Один — только я; двое — друг напротив друга
    expect(seatSpots(1)).toEqual([{ x: 50, y: 100 }])
    expect(seatSpots(2)).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 0 },
    ])
  })

  it('от 2 до 10 мест: внутри рамки, по часовой, справа — зеркало левого, соседи не наезжают', () => {
    for (let n = 1; n <= 10; n++) {
      const spots = seatSpots(n)
      expect(spots).toHaveLength(n)
      for (const p of spots) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(100)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(100)
      }
      // Зеркало: место i и место n − i — по разные стороны на той же высоте
      for (let i = 1; i < n; i++) expect(spots[n - i]).toEqual({ x: 100 - spots[i].x, y: spots[i].y })
      if (n > 2) {
        expect(spots[1].x).toBeLessThan(50) // следующий за мной — слева
        expect(spots[n - 1].x).toBeGreaterThan(50) // предыдущий — справа
      }
      // Любые два места: по ширине не ближе места, или по высоте не ближе места
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = Math.abs(spots[i].x - spots[j].x)
          const dy = Math.abs(spots[i].y - spots[j].y)
          expect(dx >= SEAT_W || dy >= SEAT_H, `${n} мест: ${i} и ${j}`).toBe(true)
        }
      }
    }
  })

  it('моё место шире прочих (в 1,3 раза) — соседи внизу дальше от него по ширине', () => {
    for (let n = 2; n <= 10; n++) {
      const [me, ...rest] = seatSpots(n)
      for (const p of rest) expect(Math.abs(p.x - me.x) >= 1.25 * SEAT_W || me.y - p.y >= SEAT_H).toBe(true)
    }
  })

  it('больше десяти — по кругу овала', () => {
    const spots = seatSpots(12)
    expect(spots).toHaveLength(12)
    expect(spots[0]).toEqual({ x: 50, y: 100 })
    expect(spots[6]).toEqual({ x: 50, y: 0 })
    expect(new Set(spots.map((p) => `${p.x}:${p.y}`)).size).toBe(12)
  })

  it('ставка — у края места, обращённого к центру', () => {
    expect(betSide({ x: 50, y: 100 })).toBe('above')
    expect(betSide({ x: 0, y: 45 })).toBe('right')
    expect(betSide({ x: 3, y: 0 })).toBe('right')
    expect(betSide({ x: 100, y: 20 })).toBe('left')
    expect(betSide({ x: 33, y: 0 })).toBe('below')
    expect(betSide({ x: 67, y: 0 })).toBe('below')
  })
})

describe('панель внизу экрана стола', () => {
  const view = (o: Partial<Parameters<typeof dockOf>[0]> = {}) => ({
    actions: null,
    stage: null,
    isHost: false,
    tournament: null,
    ...o,
  })

  it('свой ход — кнопки хода; раздача идёт без моего хода — полоса; между раздачами — кнопки ведущего', () => {
    expect(dockOf(view({ actions: { myTurn: true }, stage: 'flop' }))).toBe('turn')
    expect(dockOf(view({ actions: { myTurn: false }, stage: 'flop' }))).toBe('wait')
    // Сбросил или олл-ин — кнопок хода нет, раздача ещё идёт
    expect(dockOf(view({ stage: 'turn' }))).toBe('wait')
    expect(dockOf(view({ stage: 'showdown', isHost: true }))).toBe('wait')
    expect(dockOf(view({ isHost: true }))).toBe('host')
    expect(dockOf(view({ isHost: true, tournament: { ended: false } }))).toBe('host')
    // Между раздачами у игрока и в оконченном турнире — панели нет
    expect(dockOf(view())).toBe('none')
    expect(dockOf(view({ isHost: true, tournament: { ended: true } }))).toBe('none')
  })

  it('полоса: чей ход и секунды; торги закрыты при живых картах — кто отдаёт банк', () => {
    const v = { toActName: 'Аня', turnLeft: 12, stage: 'flop', stageLabel: 'Флоп', isHost: false, phoneCards: true }
    expect(waitLine(v)).toBe('Ждём хода · Аня · 12 с')
    expect(waitLine({ ...v, turnLeft: null })).toBe('Ждём хода · Аня')
    const showdown = { ...v, toActName: null, turnLeft: null, stage: 'showdown', stageLabel: 'Торги закрыты' }
    expect(waitLine(showdown)).toBe('Торги закрыты')
    expect(waitLine({ ...showdown, phoneCards: false })).toBe('Торги закрыты — ведущий отмечает победителя')
    expect(waitLine({ ...showdown, phoneCards: false, isHost: true })).toBe('Торги закрыты — отметьте победителя ниже')
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
