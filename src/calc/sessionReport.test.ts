import { describe, expect, it } from 'vitest'
import { HOLDEM_GAME, OMAHA_GAME, type GameDef } from '../poker/game'
import type { Card } from '../poker/cards'
import type { HistoryHand } from '../poker/history'
import type { EveningTable, SavedHand } from './evenings'
import { eveningResult } from './evenings'
import { CHART_HEIGHT, CHART_WIDTH, chartView, premiumOf, sessionReport, sessionView } from './sessionReport'

const NBSP = ' '

const TABLE: EveningTable = { me: 'me', game: 'holdem', limit: 'nolimit', sb: 5, bb: 10, ante: 0, maxSeats: 6, tournament: false }
const SEATS = [
  { id: 'me', name: 'Вы', chips: 10_000 },
  { id: 'bot', name: 'Бот', chips: 10_000 },
]

type Opts = { bb?: number; game?: GameDef; mine?: Card[]; live?: boolean; table?: EveningTable }

// Хедз-ап: кнопка — я (малый), бот — большой; оба ставят до x, банк 2x берёт winner (null — пополам).
// Мой итог: +x, −x или 0
function hand(number: number, x: number, winner: 'me' | 'bot' | null, o: Opts = {}): SavedHand {
  const bb = o.bb ?? 10
  const log = [
    { street: 'preflop' as const, playerId: 'me', type: 'raise' as const, bet: x, allIn: false },
    { street: 'preflop' as const, playerId: 'bot', type: 'call' as const, bet: x, allIn: false },
  ]
  const payouts = winner ? { [winner]: 2 * x } : { me: x, bot: x }
  const h: HistoryHand = {
    number,
    pots: [{ amount: 2 * x, winners: winner ? [winner] : ['me', 'bot'] }],
    payouts,
    ...(o.live
      ? { live: { seats: SEATS, button: 0, log } }
      : {
          record: {
            game: o.game ?? HOLDEM_GAME,
            sb: bb / 2,
            bb,
            seats: SEATS,
            button: 0,
            board: [],
            log,
            shown: {},
            hands: {},
            hidden: null,
          },
        }),
  }
  return {
    evening: 'bots-1',
    code: null,
    startedAt: 1000,
    number,
    hand: h,
    table: o.table ?? TABLE,
    ...(o.mine ? { mine: o.mine } : {}),
  }
}

describe('отчёт сессии: премиум-руки', () => {
  it('AA–JJ и AK; AKs против AKo; остальное — не премиум', () => {
    expect(premiumOf(['Ah', 'Ad'])).toBe('AA')
    expect(premiumOf(['Kc', 'Ks'])).toBe('KK')
    expect(premiumOf(['Qh', 'Qd'])).toBe('QQ')
    expect(premiumOf(['Jh', 'Jc'])).toBe('JJ')
    expect(premiumOf(['Ah', 'Kh'])).toBe('AKs')
    expect(premiumOf(['Kh', 'Ah'])).toBe('AKs')
    expect(premiumOf(['Ah', 'Kd'])).toBe('AKo')
    expect(premiumOf(['Th', 'Td'])).toBeNull()
    expect(premiumOf(['Ah', 'Qh'])).toBeNull()
    expect(premiumOf(['Ah', 'Ad', 'Kc', 'Ks'])).toBeNull()
  })

  it('в счёт — холдем с моими картами; без карт и не холдем — нет; итог премиум-рук в ББ', () => {
    const r = sessionReport([
      hand(1, 100, 'me', { mine: ['Ah', 'Ad'] }), // +10 ББ, премиум
      hand(2, 50, 'bot', { mine: ['Ah', 'Kd'] }), // −5 ББ, премиум
      hand(3, 30, 'me', { mine: ['7h', '2d'] }), // не премиум
      hand(4, 200, 'me'), // мои карты не записаны — не в счёт
      hand(5, 20, 'me', { live: true }), // живые карты — не в счёт
    ])
    expect(r?.premium).toEqual({ hands: 3, premium: 2, net: 500 })
    expect(sessionView(r!).premium).toBe(`Премиум: 2 из 3 раздач (67${NBSP}%), итог с них +5${NBSP}ББ`)
  })

  it('не холдем — строки нет; холдем без моих карт — тоже', () => {
    const omaha = sessionReport([hand(1, 100, 'me', { game: OMAHA_GAME, mine: ['Ah', 'Ad', 'Kc', 'Ks'] })])
    expect(omaha?.premium).toBeNull()
    expect(sessionView(omaha!).premium).toBeNull()
    expect(sessionReport([hand(1, 100, 'me')])?.premium).toBeNull()
  })

  it('премиум не пришёл — без итога; «из 1 раздачи»', () => {
    const r = sessionReport([hand(1, 100, 'me', { mine: ['7h', '2d'] })])
    expect(sessionView(r!).premium).toBe(`Премиум: 0 из 1 раздачи (0${NBSP}%)`)
  })
})

describe('отчёт сессии: топ раздач', () => {
  it('до трёх в плюс и в минус, по ББ; ничья — ни там, ни там', () => {
    const r = sessionReport([
      hand(1, 100, 'me'),
      hand(2, 300, 'me'),
      hand(3, 50, 'me'),
      hand(4, 200, 'me'),
      hand(5, 40, 'bot'),
      hand(6, 500, 'bot'),
      hand(7, 70, null),
    ])!
    expect(r.best.map((o) => o.number)).toEqual([2, 4, 1])
    expect(r.worst.map((o) => o.number)).toEqual([6, 5])
    expect(r.best[0]).toMatchObject({ chips: 300, bb: 10, evening: 'bots-1' })
    const v = sessionView(r)
    expect(v.best[0]).toEqual({ number: 2, plus: true, result: `+30${NBSP}ББ · +300` })
    expect(v.worst[0]).toEqual({ number: 6, plus: false, result: `−50${NBSP}ББ · −500` })
  })

  it('в ББ своей раздачи: в турнире больший выигрыш фишками может быть меньше в ББ; равенство — позднее выше', () => {
    const r = sessionReport([
      hand(1, 100, 'me', { bb: 10 }), // 10 ББ
      hand(2, 400, 'me', { bb: 100 }), // 4 ББ
      hand(3, 200, 'me', { bb: 20 }), // 10 ББ — позднее, выше первой
    ])!
    expect(r.best.map((o) => o.number)).toEqual([3, 1, 2])
  })

  it('живые карты — итог по блайндам стола, как в «Итоге вечера»', () => {
    const records = [hand(1, 100, 'me', { live: true }), hand(2, 30, 'bot', { live: true })]
    const r = sessionReport(records)!
    expect(r.best).toMatchObject([{ number: 1, chips: 100, bb: 10 }])
    expect(r.worst).toMatchObject([{ number: 2, chips: -30, bb: 10 }])
    // Итог отчёта сходится с моей строкой «Итога вечера»
    const mine = eveningResult(records).players.find((p) => p.me)!
    expect(r.net).toBe(Math.round(mine.bb * 100))
  })

  it('живые карты в турнире — блайнды не записаны: раздача не в счёт', () => {
    const tournament = { ...TABLE, tournament: true }
    const r = sessionReport([hand(1, 100, 'me', { live: true, table: tournament }), hand(2, 30, 'bot', { table: tournament })])!
    expect(r.hands).toBe(1)
    expect(r.best).toEqual([])
    expect(r.worst.map((o) => o.number)).toEqual([2])
  })

  it('меня в вечере нет (стол на одном телефоне) или моих раздач нет — отчёта нет', () => {
    const local = { ...TABLE, me: null }
    expect(sessionReport([hand(1, 100, 'me', { table: local })])).toBeNull()
    expect(sessionReport([])).toBeNull()
    const away = { ...TABLE, me: 'gone' }
    expect(sessionReport([hand(1, 100, 'me', { table: away })])).toBeNull()
  })
})

describe('отчёт сессии: накопленный итог и график', () => {
  it('по номеру раздачи, в сотых ББ своей раздачи; bb/100 — сумма на число раздач', () => {
    const r = sessionReport([
      hand(3, 25, 'bot', { bb: 20 }), // −1,25 ББ
      hand(1, 100, 'me', { bb: 10 }), // +10 ББ
      hand(2, 50, 'bot', { bb: 10 }), // −5 ББ
    ])!
    expect(r.curve).toEqual([0, 1000, 500, 375])
    expect(r.net).toBe(375)
    expect(r.hands).toBe(3)
    const v = sessionView(r)
    // 375 сотых ББ за 3 раздачи — 125 ББ на сто раздач
    expect(v.bb100).toBe(`Итог вечера: +125,0 bb/100 · раздач 3 (+3,8${NBSP}ББ)`)
    expect(v.chart).toBeNull()
    expect(v.note).toBe('мало раздач для графика')
  })

  it('с 10 раздач — график: ноль отмечен, x — по раздачам, y — сверху вниз', () => {
    const records = Array.from({ length: 10 }, (_, i) => hand(i + 1, 100, i < 5 ? 'me' : 'bot'))
    const v = sessionView(sessionReport(records)!)
    expect(v.note).toBeNull()
    expect(v.chart).not.toBeNull()
    const pts = v.chart!.points.split(' ').map((p) => p.split(',').map(Number))
    expect(pts).toHaveLength(11)
    expect(pts[0]).toEqual([0, CHART_HEIGHT]) // старт с нуля, ноль — внизу: итог ниже нуля не уходил
    expect(pts[5]).toEqual([50, 0]) // вершина: +50 ББ
    expect(pts[10]).toEqual([CHART_WIDTH, CHART_HEIGHT])
    expect(v.chart!.zero).toBe(CHART_HEIGHT)
    expect(v.bb100).toBe(`Итог вечера: 0,0 bb/100 · раздач 10 (0${NBSP}ББ)`)
  })

  it('ноль — между верхом и низом; всё на нуле — линия посередине', () => {
    expect(chartView([0, 100, -300]).zero).toBe(10)
    expect(chartView([0, 0, 0])).toMatchObject({ points: `0,20 50,20 100,20`, zero: 20 })
  })
})
