import { describe, expect, it } from 'vitest'
import { deckFor, HOLDEM_GAME } from '../poker/game'
import type { HandLogEntry, Street } from '../poker/hand'
import { finishedHand, keepHand, type HistoryHand } from '../poker/history'
import { EMPTY_HUD, HUD_FEW_HANDS, type HudCounts } from '../poker/hud'
import { createTable, type HandRecord, type HandResult, type Settings, type TableState } from '../poker/table'
import type { OwnGame } from '../poker/ownGame'
import { allin, award, call, check, fold, play, raise, stackedDeck, start, type Step } from '../poker/testing'
import { localEvening, roomEvening, savedHands, type EveningTable, type SavedHand } from './evenings'
import { allTimeHud, allTimeMore, handNet, moreView } from './pokerAllTime'
import { countsView } from './pokerView'

type Run = { state: TableState; history: HistoryHand[] }

// Стол с постоянными: regularId нет — гость
function table(players: { id: string; name: string; regularId?: string }[], settings: Partial<Settings>): Run {
  const [host, ...rest] = players
  const r = createTable(host.id, host.name, settings, 0, host.regularId ?? null)
  if (!r.ok) throw new Error(r.error)
  const sits: Step[] = rest.map((p) => ({
    from: p.id,
    msg: { type: 'sit', name: p.name, ...(p.regularId ? { regularId: p.regularId } : {}) },
  }))
  return { state: play(r.state, sits, false), history: [] }
}

// Шаги по одному, история вечера — как у телефона (finishedHand → keepHand)
function go(run: Run, steps: Step[]): Run {
  let { state, history } = run
  for (const step of steps) {
    const next = play(state, [step], false)
    history = keepHand(history, finishedHand(state, next))
    state = next
  }
  return { state, history }
}

// Живые карты: торги закрыты — ведущий отдаёт каждый банк первому из претендентов
function finish(run: Run): Run {
  const pots = run.state.hand?.pots ?? []
  return go(run, [award(run.state.hostId, pots.map((p) => [p.eligible[0]]))])
}

const checkDown = (ids: string[], streets: number): Step[] => Array.from({ length: streets }, () => ids.map(check)).flat()

const ZERO = { ...EMPTY_HUD }

function sum(...list: (HudCounts | undefined)[]): HudCounts {
  const out = { ...ZERO }
  for (const c of list) if (c) for (const k of Object.keys(out) as (keyof HudCounts)[]) out[k] += c[k] ?? 0
  return out
}

const PETYA = { id: 'r-petya', name: 'Петя' }
const KOLYA = { id: 'r-kolya', name: 'Коля' }
const VASYA = { id: 'r-vasya', name: 'Вася' }

// Вечер A — комната, карты на телефонах: Петя и Коля — постоянные, Вася — гость.
// Кнопка a0, малый a1, большой a2; во второй раздаче кнопка у a1
function eveningA(): { run: Run; saved: SavedHand[] } {
  let run = table(
    [
      { id: 'a0', name: 'Петя', regularId: PETYA.id },
      { id: 'a1', name: 'Вася' },
      { id: 'a2', name: 'Коля', regularId: KOLYA.id },
    ],
    { cards: 'phones' },
  )
  run = go(run, [start('a0', deckFor(HOLDEM_GAME)), raise('a0', 30), call('a1'), fold('a2'), ...checkDown(['a1', 'a0'], 3)])
  run = go(run, [start('a0', deckFor(HOLDEM_GAME)), raise('a1', 30), fold('a2'), call('a0'), check('a0'), raise('a1', 40), fold('a0')])
  return { run, saved: savedHands(roomEvening('KQ7MZP', run.state, 'a0'), run.history) }
}

// Вечер B — стол на телефоне, живые карты: Коля ведёт, Петя — постоянный, и гость тоже «Петя».
// Кнопка b0, малый b1, большой b2; во второй раздаче кнопка у b1
function eveningB(): { run: Run; saved: SavedHand[] } {
  let run = table(
    [
      { id: 'b0', name: 'Коля', regularId: KOLYA.id },
      { id: 'b1', name: 'Петя', regularId: PETYA.id },
      { id: 'b2', name: 'Петя' },
    ],
    {},
  )
  run = finish(go(run, [start('b0'), raise('b0', 30), call('b1'), fold('b2'), check('b1'), raise('b0', 40), fold('b1')]))
  run = finish(
    go(run, [start('b0'), raise('b1', 30), call('b2'), fold('b0'), check('b2'), raise('b1', 40), call('b2'), ...checkDown(['b2', 'b1'], 2)]),
  )
  return { run, saved: savedHands(localEvening('01B', run.state), run.history) }
}

describe('покер за всё время: хай/лоу своей игры (#227)', () => {
  it('взявший только лоу — тоже взял банк: HUD как у стола, выигрыш на вскрытии засчитан обоим', () => {
    const o8: OwnGame = { id: 'own-h8', name: 'Холдем хай/лоу', hole: 2, fromHand: 'any', deck: 52, order: 'standard', board: [3, 1, 1], limit: 'nolimit', hiLo: true }
    let run = table(
      [
        { id: 'a0', name: 'Петя', regularId: PETYA.id },
        { id: 'a1', name: 'Коля', regularId: KOLYA.id },
      ],
      { cards: 'phones', games: [o8], game: o8.id },
    )
    // Сдают с a1: у Коли лоу 7-4-3-2-A, у Пети тройка королей — банк пополам
    const deck = stackedDeck([['Ac', '2c'], ['Kh', 'Ks']], ['Kd', '7h', '3s', '4d', '8c'])
    run = go(run, [start('a0', deck), allin('a0'), call('a1')])
    const saved = savedHands(roomEvening('KQ7MZP', run.state, 'a0'), run.history)
    expect(saved[0].hand.pots).toEqual([{ amount: 2000, winners: ['a0', 'a1'] }])
    expect(saved[0].hand.record?.split).toEqual([{ hi: ['a0'], lo: ['a1'] }])
    expect(allTimeHud(PETYA, saved)).toEqual(sum(run.state.hud?.a0))
    expect(allTimeHud(KOLYA, saved)).toEqual(sum(run.state.hud?.a1))
    expect(allTimeHud(KOLYA, saved)).toMatchObject({ showdowns: 1, showdownWins: 1 })
    expect(allTimeHud(PETYA, saved)).toMatchObject({ showdowns: 1, showdownWins: 1 })
    // Кто сколько выиграл: банк 2 000 пополам — итог у обоих ноль
    expect(handNet(saved[0].hand.record!, saved[0].hand.payouts)).toEqual({ a0: 0, a1: 0 })
  })
})

describe('покер за всё время: HUD постоянного по сохранённым вечерам', () => {
  const a = eveningA()
  const b = eveningB()
  const all = [...a.saved, ...b.saved]

  it('сумма двух вечеров — как HUD вечера за столом на тех же раздачах', () => {
    expect(a.saved).toHaveLength(2)
    expect(b.saved).toHaveLength(2)
    expect(a.saved.every((s) => s.hand.record)).toBe(true) // карты на телефонах — запись раздачи
    expect(b.saved.every((s) => s.hand.live)).toBe(true) // живые карты — места и ходы раздачи

    const petya = allTimeHud(PETYA, all)
    expect(petya).toEqual(sum(a.run.state.hud?.a0, b.run.state.hud?.b1))
    expect(petya.hands).toBe(4)
    expect(petya.pfr).toBeGreaterThan(0)
    expect(petya.cbs).toBeGreaterThan(0)
    expect(allTimeHud(KOLYA, all)).toEqual(sum(a.run.state.hud?.a2, b.run.state.hud?.b0))
  })

  it('гость с именем постоянного не засчитывается постоянному', () => {
    // Гость «Петя» в вечере B входил в раздачи — у постоянного Пети его чисел нет
    expect(b.run.state.hud?.b2?.vpip).toBeGreaterThan(0)
    expect(allTimeHud(PETYA, b.saved)).toEqual(b.run.state.hud?.b1)
    // Вася в вечере A — гость: постоянному Васе ничего
    expect(allTimeHud(VASYA, all)).toEqual(ZERO)
  })

  it('удалённый вечер — его раздачи уходят из счёта', () => {
    expect(allTimeHud(PETYA, b.saved)).toEqual(sum(b.run.state.hud?.b1))
    expect(allTimeHud(PETYA, [])).toEqual(ZERO)
  })

  it('не играл в покер — раздач нет, блока нет', () => {
    const none = allTimeHud({ id: 'r-masha', name: 'Маша' }, all)
    expect(none).toEqual(ZERO)
    expect(countsView(none)).toBeNull()
  })

  it('записи до Р-55 — по имени; двое с этим именем в раздаче — раздача не в счёт', () => {
    const old = all.map(({ table: t, ...rest }) => ({ ...rest, ...(t ? { table: { ...t, regulars: undefined } } : {}) }))
    // В вечере B два «Пети» — не различить, только вечер A
    expect(allTimeHud(PETYA, old)).toEqual(sum(a.run.state.hud?.a0))
    expect(allTimeHud(KOLYA, old)).toEqual(sum(a.run.state.hud?.a2, b.run.state.hud?.b0))
    // Гость Вася в старых записях не отличить от постоянного
    expect(allTimeHud(VASYA, old)).toEqual(a.run.state.hud?.a1)
  })

  it('мало раздач — как строка HUD у места', () => {
    const view = countsView(allTimeHud(PETYA, all))
    expect(view).toMatchObject({ hands: 4, few: true })
    expect(countsView({ ...ZERO, hands: HUD_FEW_HANDS, vpip: 15 })).toMatchObject({ few: false, vpip: 50 })
  })
})

// 3-бет, WTSD, W$SD, bb/100, лучшие и худшие (#197) — на записях, посчитанных руками.
// За столом p — Петя, k — Коля, v — Вася, все трое постоянные; блайнды 5/10
const NBSP = ' '
const MINUS = '−'

const m =(street: Street, playerId: string, type: HandLogEntry['type'], bet: number, allIn = false): HandLogEntry => ({
  street,
  playerId,
  type,
  bet,
  allIn,
})

const TABLE: EveningTable = {
  me: null,
  game: 'holdem',
  limit: 'nolimit',
  sb: 5,
  bb: 10,
  ante: 0,
  maxSeats: 9,
  tournament: false,
  regulars: { p: PETYA.id, k: KOLYA.id, v: VASYA.id },
}

const ROOM = { id: 'KQ7MZP-1', code: 'KQ7MZP', startedAt: new Date(2026, 9, 9, 20).getTime() }
const PHONE = { id: 'local-01B', code: null, startedAt: new Date(2026, 9, 16, 20).getTime() }

const seats3 = (p: number, k: number, v: number) => [
  { id: 'p', name: 'Петя', chips: p },
  { id: 'k', name: 'Коля', chips: k },
  { id: 'v', name: 'Вася', chips: v },
]

function saved(
  evening: { id: string; code: string | null; startedAt: number },
  number: number,
  r: Pick<HandRecord, 'seats' | 'button' | 'log'> & { ante?: number },
  pots: HandResult['pots'],
  payouts: Record<string, number>,
): SavedHand {
  const record: HandRecord = { game: HOLDEM_GAME, sb: 5, bb: 10, board: [], shown: {}, hands: {}, hidden: null, ...r }
  return { evening: evening.id, code: evening.code, startedAt: evening.startedAt, number, hand: { number, pots, payouts, record }, table: TABLE }
}

// 1. Кнопка p, малый k, большой v. p открылся 30, k перерейзил до 90 (3-бет), v пас, p колл; чек до вскрытия, банк 190 — k.
//    Итог: p −90 (−9 ББ), k +100 (+10 ББ), v −10 (−1 ББ)
const H1 = saved(
  ROOM,
  1,
  {
    seats: seats3(1000, 1000, 1000),
    button: 0,
    log: [
      m('preflop', 'p', 'raise', 30),
      m('preflop', 'k', 'raise', 90),
      m('preflop', 'v', 'fold', 10),
      m('preflop', 'p', 'call', 90),
      ...(['flop', 'turn', 'river'] as Street[]).flatMap((s) => [m(s, 'k', 'check', 0), m(s, 'p', 'check', 0)]),
    ],
  },
  [{ amount: 190, winners: ['k'] }],
  { k: 190 },
)

// 2. Анте 2. Кнопка k, малый v, большой p. k открылся 25, v и p — колл (у обоих случай 3-бета, перерейза нет).
//    Флоп: v чек, p ставит 40, k и v пас — 40 вернулись p, банк 81 его без вскрытия.
//    Вложено: p 2 + 25 = 27, k 27, v 27. Итог: p +54 (+5,4 ББ), k −27, v −27
const H2 = saved(
  ROOM,
  2,
  {
    seats: seats3(1000, 1000, 1000),
    button: 1,
    ante: 2,
    log: [
      m('preflop', 'p', 'ante', 2),
      m('preflop', 'k', 'ante', 2),
      m('preflop', 'v', 'ante', 2),
      m('preflop', 'k', 'raise', 25),
      m('preflop', 'v', 'call', 25),
      m('preflop', 'p', 'call', 25),
      m('flop', 'v', 'check', 0),
      m('flop', 'p', 'raise', 40),
      m('flop', 'k', 'fold', 0),
      m('flop', 'v', 'fold', 0),
    ],
  },
  [{ amount: 81, winners: ['p'] }],
  { p: 81 },
)

// 3. Побочный банк. Стеки p 100, k 300, v 1000; кнопка v, малый p, большой k. v открылся 30, p олл-ин 100
//    (3-бет олл-ином), k олл-ин 300, v колл. Основной 300 — p, побочный 400 (k и v) — v.
//    Итог: p +200 (+20 ББ), k −300 (−30 ББ), v +100 (+10 ББ)
const H3 = saved(
  ROOM,
  3,
  {
    seats: seats3(100, 300, 1000),
    button: 2,
    log: [
      m('preflop', 'v', 'raise', 30),
      m('preflop', 'p', 'allin', 100, true),
      m('preflop', 'k', 'allin', 300, true),
      m('preflop', 'v', 'call', 300),
    ],
  },
  [
    { amount: 300, winners: ['p'] },
    { amount: 400, winners: ['v'] },
  ],
  { p: 300, v: 400 },
)

// 4. Живые карты — записи нет: в лучшие и худшие не входит, в HUD (и bb/100, #241) — входит.
//    p открылся 30, k и v пас: 20 вернулись p, банк 25 его. Итог: p +15, k −5, v −10
const H4: SavedHand = {
  evening: PHONE.id,
  code: null,
  startedAt: PHONE.startedAt,
  number: 1,
  hand: {
    number: 1,
    pots: [{ amount: 25, winners: ['p'] }],
    payouts: { p: 25 },
    live: { seats: seats3(1000, 1000, 1000), button: 0, log: [m('preflop', 'p', 'raise', 30), m('preflop', 'k', 'fold', 5), m('preflop', 'v', 'fold', 10)] },
  },
  table: TABLE,
}

// 5. Блайнды без хода: кнопка p, малый k, большой v; p и k пас — у v своя половина вернулась, банк 10 его.
//    Итог: p 0, k −5 (−0,5 ББ), v +5 (+0,5 ББ)
const H5 = saved(
  PHONE,
  2,
  { seats: seats3(1000, 1000, 1000), button: 0, log: [m('preflop', 'p', 'fold', 0), m('preflop', 'k', 'fold', 5)] },
  [{ amount: 10, winners: ['v'] }],
  { v: 10 },
)

const HANDS = [H1, H2, H3, H4, H5]

describe('покер за всё время: 3-бет, вскрытия, bb/100 и лучшие раздачи (#197)', () => {
  it('итог раздачи: выплаты минус вложенное — с блайндами, анте, возвратом и побочными', () => {
    const net = (s: SavedHand) => handNet(s.hand.record as HandRecord, s.hand.payouts)
    expect(net(H1)).toEqual({ p: -90, k: 100, v: -10 })
    expect(net(H2)).toEqual({ p: 54, k: -27, v: -27 })
    expect(net(H3)).toEqual({ p: 200, k: -300, v: 100 })
    expect(net(H5)).toEqual({ p: 0, k: -5, v: 5 })
  })

  it('страддл (#222): во вложенном, но не VPIP и не PFR', () => {
    // Втроём страддл — кнопка p (20). k уравнивает, v пас, p чек; чек до вскрытия, банк 50 — k.
    // Итог: p −20, k +30, v −10
    const straddle = saved(
      ROOM,
      6,
      {
        seats: seats3(1000, 1000, 1000),
        button: 0,
        log: [
          m('preflop', 'p', 'straddle', 20),
          m('preflop', 'k', 'call', 20),
          m('preflop', 'v', 'fold', 10),
          m('preflop', 'p', 'check', 20),
          ...(['flop', 'turn', 'river'] as Street[]).flatMap((s) => [m(s, 'k', 'check', 0), m(s, 'p', 'check', 0)]),
        ],
      },
      [{ amount: 50, winners: ['k'] }],
      { k: 50 },
    )
    expect(handNet(straddle.hand.record as HandRecord, straddle.hand.payouts)).toEqual({ p: -20, k: 30, v: -10 })
    expect(allTimeHud(PETYA, [straddle])).toMatchObject({ hands: 1, vpip: 0, pfr: 0, raises: 0, calls: 0, net: -200 })
    expect(allTimeHud(KOLYA, [straddle])).toMatchObject({ hands: 1, vpip: 1, pfr: 0, calls: 1, net: 300 })
  })

  // С #241 3-бет, WTSD, W$SD и bb/100 считает HUD (allTimeHud) — и по живой раздаче 4: там итог —
  // по выплатам и банкам, блайнды — стола вечера. Сотые ББ: H1 −9, H2 +5,4, H3 +20, H4 +1,5 (p 25 − 10), H5 0
  it('Петя: 3-бет 1 из 2, фолд на 3-бет 0 из 1, WTSD 2 из 3, W$SD 1 из 2, bb/100 по пяти раздачам', () => {
    const hud = allTimeHud(PETYA, HANDS)
    expect(hud).toMatchObject({
      hands: 5,
      threeBetChances: 2, // 2 — колл, 3 — олл-ин; в 1 сам открывал
      threeBets: 1,
      foldTo3BetChances: 1, // в 1 открыл, получил 3-бет и уравнял
      foldsTo3Bet: 0,
      flops: 3, // флоп в 1, 2, 3; вскрытие в 1 и 3
      showdowns: 2,
      showdownWins: 1, // основной банк в 3
      netHands: 5,
      net: -900 + 540 + 2000 + 150 + 0,
    })
    expect(countsView(hud)).toMatchObject({ threeBet: 50, foldTo3Bet: 0, wtsd: 67, wsd: 50, bb100: '+358,0' })
    const more = allTimeMore(PETYA, HANDS)
    expect(more.hands).toBe(4) // лучшие и худшие — без живой раздачи
    expect(more.best.map((o) => [o.number, o.chips])).toEqual([
      [3, 200],
      [2, 54],
    ])
    expect(more.worst.map((o) => [o.number, o.chips])).toEqual([[1, -90]])
  })

  it('Коля: 3-бет 1 из 2 (в живой 4 — пас), без вскрытия после паса на флопе; худшие — три', () => {
    const hud = allTimeHud(KOLYA, HANDS)
    // В 3 перед ним два рейза — не случай; в 2 открыл, 3-бета не было — не случай фолда
    expect(hud).toMatchObject({ threeBetChances: 2, threeBets: 1, foldTo3BetChances: 0, flops: 3, showdowns: 2, showdownWins: 1 })
    expect(hud).toMatchObject({ netHands: 5, net: 1000 - 270 - 3000 - 50 - 50 })
    expect(countsView(hud)).toMatchObject({ threeBet: 50, foldTo3Bet: null, bb100: `${MINUS}474,0` })
    const more = allTimeMore(KOLYA, HANDS)
    expect(more.hands).toBe(4)
    expect(more.best.map((o) => o.number)).toEqual([1])
    expect(more.worst.map((o) => [o.evening, o.number])).toEqual([
      [ROOM.id, 3],
      [ROOM.id, 2],
      [PHONE.id, 2],
    ])
  })

  it('Вася: побочный банк — выигрыш на вскрытии; открыл и получил 4-бет — не фолд на 3-бет', () => {
    const hud = allTimeHud(VASYA, HANDS)
    expect(hud).toMatchObject({ threeBetChances: 2, threeBets: 0, foldTo3BetChances: 0, flops: 2, showdowns: 1, showdownWins: 1 })
    expect(hud).toMatchObject({ netHands: 5, net: -100 - 270 + 1000 - 100 + 50 })
    expect(countsView(hud)).toMatchObject({ threeBet: 0, wtsd: 50, wsd: 100, bb100: '+116,0' })
    const more = allTimeMore(VASYA, HANDS)
    expect(more.best.map((o) => o.number)).toEqual([3, 2])
    expect(more.worst.map((o) => o.number)).toEqual([2, 1])
  })

  it('турнир на живых картах: блайнды раздачи неизвестны — в bb/100 не идёт, в остальное — идёт', () => {
    const tournament = { ...H4, table: { ...TABLE, tournament: true } }
    expect(allTimeHud(PETYA, [tournament])).toMatchObject({ hands: 1, netHands: 0, net: 0 })
    expect(countsView(allTimeHud(PETYA, [tournament]))?.bb100).toBeNull()
    expect(allTimeHud(KOLYA, [tournament])).toMatchObject({ threeBetChances: 1, threeBets: 0 })
  })

  it('показ лучших и худших: строки раздач', () => {
    const view = moreView(allTimeMore(PETYA, HANDS))
    expect(view).toEqual({
      best: [
        { evening: ROOM.id, number: 3, day: '2026-10-09', table: 'Стол KQ7MZP', result: `+20${NBSP}ББ` },
        { evening: ROOM.id, number: 2, day: '2026-10-09', table: 'Стол KQ7MZP', result: `+5,4${NBSP}ББ` },
      ],
      worst: [{ evening: ROOM.id, number: 1, day: '2026-10-09', table: 'Стол KQ7MZP', result: `${MINUS}9${NBSP}ББ` }],
    })
    expect(moreView(allTimeMore(KOLYA, HANDS))?.worst[2]).toMatchObject({
      day: '2026-10-16',
      table: 'Стол на телефоне',
      result: `${MINUS}0,5${NBSP}ББ`,
    })
  })

  it('нет раздач с записью — нет и лучших с худшими; HUD по живым — есть', () => {
    const none = allTimeMore(PETYA, [H4])
    expect(none).toEqual({ hands: 0, best: [], worst: [] })
    expect(moreView(none)).toBeNull()
    expect(moreView(allTimeMore(PETYA, []))).toBeNull()
    expect(moreView(allTimeMore(PETYA, eveningB().saved))).toBeNull()
    expect(countsView(allTimeHud(PETYA, eveningB().saved))).toMatchObject({ hands: 2, wtsd: 50 })
  })

  it('случаев не меньше порога — не приглушено; при равном итоге выше позднее', () => {
    const many = Array.from({ length: HUD_FEW_HANDS }, (_, i) => ({ ...H3, number: i + 1, hand: { ...H3.hand, number: i + 1 } }))
    expect(countsView(allTimeHud(PETYA, many))).toMatchObject({ few: false, threeBet: 100, wtsd: 100, wsd: 100, bb100: '+2000,0' })
    const view = moreView(allTimeMore(PETYA, many))
    expect(view?.best.map((o) => o.number)).toEqual([HUD_FEW_HANDS, HUD_FEW_HANDS - 1, HUD_FEW_HANDS - 2])
    expect(view?.worst).toEqual([])
    // Ни одного случая — «—», а не ноль
    expect(countsView(allTimeHud(PETYA, [H5]))).toMatchObject({ threeBet: null, foldTo3Bet: null, wtsd: null, wsd: null, bb100: '0,0' })
  })

  it('по раздачам живого стола: итоги раздач сходятся в ноль и складываются в стеки стола', () => {
    const { run, saved: hands } = eveningA()
    const sums = new Map<string, number>()
    for (const s of hands) {
      const net = handNet(s.hand.record as HandRecord, s.hand.payouts)
      expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0)
      for (const [id, chips] of Object.entries(net)) sums.set(id, (sums.get(id) ?? 0) + chips)
    }
    for (const p of run.state.players) expect(sums.get(p.id)).toBe(p.chips - p.buyIn)
  })
})
