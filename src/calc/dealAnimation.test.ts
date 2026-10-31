import { describe, expect, it } from 'vitest'
import {
  DEAL_TOTAL_MS,
  STREET_TOTAL_MS,
  dealFlights,
  dealPlan,
  flightsEnd,
  streetFlights,
  type DealSnapshot,
} from './dealAnimation'

const snap = (s: Partial<DealSnapshot> = {}): DealSnapshot => ({
  hand: 1,
  playing: true,
  board: [],
  seats: [0, 1, 2],
  button: 0,
  cards: 2,
  ...s,
})

// Задержки идут не убывая — карты летят по очереди
const ordered = (delays: number[]) => delays.every((d, i) => i === 0 || d >= delays[i - 1])

describe('анимация раздачи: карты по местам', () => {
  it('по одной каждому по кругу с места после кнопки, затем второй круг', () => {
    const f = dealFlights([0, 2, 5], 2, 2)
    expect(f.map((x) => x.key)).toEqual(['seat-5:0', 'seat-0:0', 'seat-2:0', 'seat-5:1', 'seat-0:1', 'seat-2:1'])
    expect(ordered(f.map((x) => x.delay))).toBe(true)
    expect(f[0].delay).toBe(0)
  })

  it('мест мало — карты через ровный промежуток, раздача короче предела', () => {
    const f = dealFlights([0, 1], 0, 2)
    expect(f.map((x) => x.delay)).toEqual([0, 150, 300, 450])
    expect(flightsEnd(f)).toBe(850)
  })

  it('при любом числе мест и карт — не дольше 1,5 с; омаха на 10 мест — карты летят чаще', () => {
    for (let n = 1; n <= 10; n++) {
      for (const k of [2, 4]) {
        const f = dealFlights(
          Array.from({ length: n }, (_, i) => i),
          3,
          k,
        )
        expect(f).toHaveLength(n * k)
        expect(flightsEnd(f)).toBeLessThanOrEqual(DEAL_TOTAL_MS)
        expect(ordered(f.map((x) => x.delay))).toBe(true)
      }
    }
    const omaha = dealFlights(
      Array.from({ length: 10 }, (_, i) => i),
      0,
      4,
    )
    const holdem2 = dealFlights([0, 1], 0, 2)
    expect(omaha[1].delay - omaha[0].delay).toBeLessThan(holdem2[1].delay - holdem2[0].delay)
    expect(flightsEnd(omaha)).toBe(DEAL_TOTAL_MS)
  })

  it('нет мест или карт — нечего проигрывать', () => {
    expect(dealFlights([], 0, 2)).toEqual([])
    expect(dealFlights([0, 1], 0, 0)).toEqual([])
  })
})

describe('анимация раздачи: общие карты', () => {
  it('флоп — три по одной, не дольше 1 с', () => {
    const f = streetFlights(0, 3)
    expect(f.map((x) => x.key)).toEqual(['board:0', 'board:1', 'board:2'])
    expect(f.map((x) => x.delay)).toEqual([0, 200, 400])
    expect(flightsEnd(f)).toBeLessThanOrEqual(STREET_TOTAL_MS)
  })

  it('тёрн и ривер — одной картой', () => {
    expect(streetFlights(3, 4)).toEqual([{ key: 'board:3', delay: 0, ms: 300 }])
    expect(streetFlights(4, 5)).toEqual([{ key: 'board:4', delay: 0, ms: 300 }])
  })

  it('все пять сразу (олл-ин) — тоже не дольше 1 с', () => {
    expect(flightsEnd(streetFlights(0, 5))).toBeLessThanOrEqual(STREET_TOTAL_MS)
  })
})

describe('анимация раздачи: что проиграть при смене стола', () => {
  it('стол только открыли — карты уже лежат', () => {
    expect(dealPlan(null, snap())).toBeNull()
  })

  it('новая раздача — по местам с места после кнопки', () => {
    const p = dealPlan(snap({ hand: 3, playing: false, board: ['As', 'Kd', '2c'] }), snap({ hand: 4, button: 1 }))
    expect(p?.kind).toBe('deal')
    expect(p?.flights.map((f) => f.key).slice(0, 3)).toEqual(['seat-2:0', 'seat-0:0', 'seat-1:0'])
  })

  it('кнопка у последнего места — первым сдаётся первое место', () => {
    const p = dealPlan(snap({ hand: 1 }), snap({ hand: 2, button: 2 }))
    expect(p?.flights[0].key).toBe('seat-0:0')
  })

  it('кнопка у места вне раздачи — с ближайшего после неё', () => {
    const p = dealPlan(snap({ hand: 1 }), snap({ hand: 2, seats: [0, 3, 6], button: 4 }))
    expect(p?.flights[0].key).toBe('seat-6:0')
  })

  it('та же раздача, открылся флоп — три карты стола; тёрн — одна', () => {
    const flop = dealPlan(snap(), snap({ board: ['As', 'Kd', '2c'] }))
    expect(flop).toMatchObject({ kind: 'street' })
    expect(flop?.flights.map((f) => f.key)).toEqual(['board:0', 'board:1', 'board:2'])
    const turn = dealPlan(snap({ board: ['As', 'Kd', '2c'] }), snap({ board: ['As', 'Kd', '2c', '9h'] }))
    expect(turn?.flights.map((f) => f.key)).toEqual(['board:3'])
  })

  it('ничего не сменилось, раздача кончилась или карт на экране нет — ничего', () => {
    expect(dealPlan(snap(), snap())).toBeNull()
    expect(dealPlan(snap({ hand: 1 }), snap({ hand: 2, playing: false }))).toBeNull()
    expect(dealPlan(snap({ hand: 1 }), snap({ hand: 2, cards: 0 }))).toBeNull()
  })

  it('общие карты прошлой раздачи не проигрываются заново в новой', () => {
    const p = dealPlan(snap({ hand: 1, playing: false, board: ['As', 'Kd', '2c'] }), snap({ hand: 2, board: [] }))
    expect(p?.kind).toBe('deal')
  })
})
