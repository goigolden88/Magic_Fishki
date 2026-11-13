import { describe, expect, it } from 'vitest'
import {
  BET_STEP_DEFAULT,
  betShareText,
  betSide,
  betSlider,
  betStepChips,
  dockOf,
  parseBetStep,
  potShareAmount,
  SEAT_H,
  SEAT_W,
  seatSpots,
  SLIDER_TRACK,
  sliderAmount,
  sliderIndex,
  SNAP_WIDTH,
  spotsBySeat,
  stepAmount,
  waitLine,
  type BetSlider,
  type BetSpot,
} from './pokerLayout'

describe('рассадка вокруг стола', () => {
  it('точки по номерам мест: моё — внизу, дальше по номерам по часовой', () => {
    const spots = seatSpots(5)
    // Я на месте 2: место 2 — точка 0, место 3 — точка 1 … место 1 — точка 4
    expect(spotsBySeat(5, 2)).toEqual([spots[3], spots[4], spots[0], spots[1], spots[2]])
    expect(spotsBySeat(5, 0)).toEqual(spots)
    // Меня нет за столом (стол на одном телефоне) — внизу место 0
    expect(spotsBySeat(5, null)).toEqual(spots)
  })

  it('на все места стола — и свободные: точки разные, соседи не наезжают, моё — внизу', () => {
    for (let n = 2; n <= 10; n++) {
      for (let me = 0; me < n; me++) {
        const spots = spotsBySeat(n, me)
        expect(spots).toHaveLength(n)
        expect(spots[me]).toEqual({ x: 50, y: 100 })
        expect(new Set(spots.map((p) => `${p.x}:${p.y}`)).size).toBe(n)
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const dx = Math.abs(spots[i].x - spots[j].x)
            const dy = Math.abs(spots[i].y - spots[j].y)
            expect(dx >= SEAT_W || dy >= SEAT_H, `${n} мест, я на ${me}: ${i} и ${j}`).toBe(true)
          }
        }
        // Следующий за мной по номеру — слева от меня, предыдущий — справа
        if (n > 2) {
          expect(spots[(me + 1) % n].x).toBeLessThan(50)
          expect(spots[(me + n - 1) % n].x).toBeGreaterThan(50)
        }
      }
    }
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

  it('ставка — у края места со стороны стола; у моего места — сбоку: над ним центр стола', () => {
    expect(betSide({ x: 50, y: 100 })).toBe('right')
    expect(betSide({ x: 70, y: 80 })).toBe('left')
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

// Ползунок ставки (Р-69): после флопа — доли банка после колла, до флопа — ББ; прилипание; колесо и «−»/«+»
describe('ползунок ставки', () => {
  // После флопа: ставки круга нет, банк 1 000 (10 ББ), стек 100 ББ
  const FLOP: BetSpot = { preflop: false, currentBet: 0, pot: 1000, bb: 100, pre: [] }
  // До флопа: ББ 10, банк после колла 25, быстрые 2,5, 3, 4 ББ
  const PRE: BetSpot = { preflop: true, currentBet: 10, pot: 25, bb: 10, pre: [25, 30, 40] }

  // Сумма на каждом положении дорожки
  const walk = (s: BetSlider) => Array.from({ length: SLIDER_TRACK + 1 }, (_, p) => sliderAmount(s, p))
  const count = (list: number[], f: (a: number) => boolean) => list.filter(f).length

  it('края — ровно минимум и олл-ин; суммы целые, по порядку, не за границы', () => {
    for (const [spot, min, max] of [
      [FLOP, 100, 10000],
      [PRE, 20, 1000],
    ] as const) {
      const s = betSlider({ min, max, spot })!
      const all = walk(s)
      expect(all[0]).toBe(min)
      expect(all[SLIDER_TRACK]).toBe(max)
      expect(sliderAmount(s, -5)).toBe(min)
      expect(sliderAmount(s, SLIDER_TRACK + 50)).toBe(max)
      expect(all.every((a) => Number.isInteger(a) && a >= min && a <= max)).toBe(true)
      expect(all.every((a, i) => i === 0 || a >= all[i - 1])).toBe(true)
    }
  })

  it('после флопа: до банка — каждый целый процент; дальше — целыми ББ, к олл-ину крупнее', () => {
    const s = betSlider({ min: 100, max: 10000, spot: FLOP })!
    const all = walk(s)
    const seen = new Set(all)
    for (let pct = 10; pct <= 100; pct++) expect(seen.has(potShareAmount(FLOP, pct))).toBe(true)
    // До банка — больше половины дорожки
    expect(sliderIndex(s, 1000)).toBeGreaterThan(SLIDER_TRACK / 2)
    // Выше банка — только целые ББ и олл-ин
    expect(all.filter((a) => a > 1000).every((a) => a % 100 === 0 || a === 10000)).toBe(true)
    // Первые 10 ББ над банком занимают дорожки больше, чем последние 10 ББ до олл-ина
    expect(count(all, (a) => a > 1000 && a <= 2000)).toBeGreaterThan(count(all, (a) => a > 9000 && a < 10000) * 3)
  })

  it('после флопа: прилипает к 33, 50, 66, 75 и 100 % банка; между ними — любое значение', () => {
    const s = betSlider({ min: 100, max: 10000, spot: FLOP })!
    expect(s.snaps).toEqual([330, 500, 660, 750, 1000])
    const all = walk(s)
    for (const a of s.snaps) {
      expect(count(all, (x) => x === a)).toBeGreaterThanOrEqual(SNAP_WIDTH)
      // Сумма точки — середина её полоски
      expect(sliderAmount(s, sliderIndex(s, a))).toBe(a)
    }
    // Соседние проценты — не полоска: несколько положений
    for (const a of [650, 670, 740, 760]) expect(count(all, (x) => x === a)).toBeLessThan(SNAP_WIDTH / 2)
    // 68…74 % — все ставятся
    for (let pct = 67; pct <= 74; pct++) expect(all).toContain(potShareAmount(FLOP, pct))
  })

  it('своя сумма и быстрые кнопки ставят ползунок туда, где эта сумма', () => {
    const s = betSlider({ min: 100, max: 10000, spot: FLOP })!
    for (const a of [100, 200, 420, 900, 10000]) expect(sliderAmount(s, sliderIndex(s, a))).toBe(a)
    expect(sliderIndex(s, 50)).toBe(0)
    expect(sliderIndex(s, 20000)).toBe(SLIDER_TRACK)
    // Сумма не на шкале — ближайшее положение, сумма рядом
    expect(Math.abs(sliderAmount(s, sliderIndex(s, 3333)) - 3333)).toBeLessThanOrEqual(100)
  })

  it('до флопа: шкала в ББ по 0,1, прилипает к быстрым суммам; выше — целыми ББ', () => {
    const s = betSlider({ min: 20, max: 1000, spot: PRE })!
    expect(s.snaps).toEqual([25, 30, 40])
    const all = walk(s)
    for (const a of [25, 30, 40]) expect(count(all, (x) => x === a)).toBeGreaterThanOrEqual(SNAP_WIDTH)
    for (let a = 20; a <= 40; a++) expect(all).toContain(a)
    expect(all.filter((a) => a > 40).every((a) => a % 10 === 0 || a === 1000)).toBe(true)
    // После чужого рейза до 30 — к «×2,5» и «×3»
    const raised = betSlider({ min: 50, max: 990, spot: { ...PRE, currentBet: 30, pot: 70, pre: [75, 90] } })!
    expect(raised.snaps).toEqual([75, 90])
  })

  it('олл-ин меньше банка — вся дорожка мелко; пот-лимит — правый край «Пот», без лишней точки', () => {
    const short = betSlider({ min: 100, max: 600, spot: FLOP })!
    expect(short.fine).toBe(1)
    expect(short.snaps).toEqual([330, 500])
    expect(walk(short).filter((a) => a !== 600).every((a) => a % 10 === 0)).toBe(true)
    const pot = betSlider({ min: 100, max: 1000, spot: FLOP })!
    expect(pot.snaps).toEqual([330, 500, 660, 750])
    expect(sliderAmount(pot, SLIDER_TRACK)).toBe(1000)
    // Минимум выше банка — вся дорожка крупно, точек ниже минимума нет
    const big = betSlider({ min: 2000, max: 10000, spot: FLOP })!
    expect([big.fine, big.snaps.length]).toEqual([0, 0])
    expect(walk(big)[1]).toBeGreaterThanOrEqual(2000)
  })

  it('повысить нельзя или можно только олл-ин — ползунка нет', () => {
    expect(betSlider(null)).toBeNull()
    expect(betSlider({ min: 15, max: 15, spot: PRE })).toBeNull()
    expect(betSlider({ min: 20, max: 15, spot: PRE })).toBeNull()
  })

  it('колесо и «−»/«+» — на шаг от суммы; у минимума и олл-ина упирается', () => {
    const s = { min: 20, max: 1003 }
    expect(stepAmount(s, 20, 1, 10)).toBe(30)
    expect(stepAmount(s, 27, 1, 10)).toBe(37)
    expect(stepAmount(s, 25, -1, 10)).toBe(20)
    expect(stepAmount(s, 20, -1, 10)).toBe(20)
    expect(stepAmount(s, 1000, 1, 10)).toBe(1003)
    expect(stepAmount(s, 1003, 1, 10)).toBe(1003)
    expect(stepAmount(s, 1003, -1, 10)).toBe(993)
    expect(stepAmount(s, 5000, -1, 10)).toBe(1003)
    // Шаг — 1 ББ (сначала) или 0,5 ББ, целый и не меньше фишки
    expect(BET_STEP_DEFAULT).toBe('bb')
    expect([betStepChips('bb', 10), betStepChips('half', 10), betStepChips('half', 5), betStepChips('bb', 0)]).toEqual([10, 5, 3, 1])
  })

  it('шаг из памяти и копии: годный — как есть, иначе не задан', () => {
    expect([parseBetStep('bb'), parseBetStep('half'), parseBetStep('quarter'), parseBetStep(null)]).toEqual(['bb', 'half', null, null])
  })

  it('подпись под суммой: доля банка и сумма — в ББ или фишках', () => {
    const plain = (t: string) => t.replace(/ /g, ' ')
    const spot: BetSpot = { preflop: false, currentBet: 0, pot: 1818, bb: 100, pre: [] }
    expect(plain(betShareText(spot, 1200, 100))).toBe('66 % банка · 12 ББ')
    expect(plain(betShareText(spot, 1200, null))).toBe('66 % банка · 1 200')
    // Рейз до 300 при ставке 100 и банке после колла 400 — половина банка
    expect(plain(betShareText({ ...spot, currentBet: 100, pot: 400 }, 300, null))).toBe('50 % банка · 300')
    expect(plain(betShareText({ ...spot, currentBet: 100 }, 100, null))).toBe('100')
  })
})
