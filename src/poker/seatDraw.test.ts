import { describe, expect, it } from 'vitest'
import { shuffleSeatsNow, startLocalTable } from '../calc/localTable'
import { tableView } from '../calc/pokerView'
import { buildDeck, HOLDEM, type Card } from './cards'
import { shuffle } from './game'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { drawSeats, drawValue, drawWinner, SHUFFLE_BETWEEN, SHUFFLE_NO_DECK, SHUFFLE_TOURNAMENT } from './seatDraw'
import { handle, type TableState } from './table'
import { award, fold, MODES, newTable, play, start, type Step } from './testing'
import type { RandomBytes } from './tokens'
import { DEFAULT_TOURNAMENT } from './tournament'

const FULL = buildDeck(HOLDEM)
const send = (s: TableState, from: string, body: ClientBody, deck?: Card[], now = 0) =>
  handle(s, from, { v: PROTOCOL_VERSION, ...body }, now, deck)
const shuffleStep = (from: string, deck: Card[], now = 0): Step => ({ from, msg: { type: 'shuffleSeats' }, deck, now })
const seats = (s: TableState) => Object.fromEntries(s.players.map((p) => [p.id, p.seat]))
// Колода, где первыми лягут заданные карты: сначала ключи рассадки (по игрокам в порядке мест), затем карты розыгрыша
const stacked = (top: Card[]) => [...top, ...FULL.filter((c) => !top.includes(c))]
// Детерминированная «случайность» для shuffle: байты по кругу от seed
const bytes = (seed: number): RandomBytes => {
  let x = seed
  return (b) => {
    for (let i = 0; i < b.length; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0
      b[i] = x >>> 24
    }
    return b
  }
}

describe('розыгрыш кнопки: старшая карта, равенство — масть', () => {
  it('ранг старше — старше; туз — старший, двойка — младшая', () => {
    expect(drawValue('As')).toBeGreaterThan(drawValue('Kc'))
    expect(drawValue('2s')).toBeLessThan(drawValue('3c'))
    expect(drawValue('Tc')).toBeGreaterThan(drawValue('9s'))
  })

  it('равные по рангу — ♠ > ♥ > ♦ > ♣', () => {
    expect([drawValue('Qs'), drawValue('Qh'), drawValue('Qd'), drawValue('Qc')]).toEqual(
      [...[drawValue('Qs'), drawValue('Qh'), drawValue('Qd'), drawValue('Qc')]].sort((a, b) => b - a),
    )
    expect(drawWinner({ a: 'Kh', b: 'Ks', c: 'Kd' })).toBe('b')
    expect(drawWinner({ a: 'Jc', b: 'Jd' })).toBe('b')
  })

  it('все 52 карты — разной силы', () => {
    expect(new Set(FULL.map(drawValue)).size).toBe(52)
  })

  it('старшая карта — у одного, остальное не важно', () => {
    expect(drawWinner({ a: '9s', b: 'Ac', c: 'Kh' })).toBe('b')
    expect(drawWinner({})).toBeNull()
  })
})

describe('перемешивание по колоде', () => {
  const players = [
    { id: 'a', seat: 0 },
    { id: 'b', seat: 3 },
    { id: 'c', seat: 5 },
    { id: 'd', seat: 8 },
  ]

  it('порядок — по первым картам колоды; места — те же занятые; карты розыгрыша — следующие, по новым местам', () => {
    // Ключи по игрокам в порядке мест: a — Kh, b — 2c, c — 9d, d — 5s. По порядку колоды: b, d, c, a
    const deck = stacked(['Kh', '2c', '9d', '5s', 'Ac', '7h', 'Qs', '3d'])
    const r = drawSeats(players, ['a', 'b', 'c', 'd'], deck)
    expect(r.seats).toEqual({ b: 0, d: 3, c: 5, a: 8 })
    // Карты розыгрыша — по новым местам: b, d, c, a
    expect(r.cards).toEqual({ b: 'Ac', d: '7h', c: 'Qs', a: '3d' })
    expect(r.button).toBe('b')
  })

  it('на любой колоде: все остались за столом, места разные, свободные места не съедены', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const deck = shuffle(FULL, bytes(seed))
      const r = drawSeats(players, ['a', 'b', 'c', 'd'], deck)
      expect(Object.keys(r.seats).sort()).toEqual(['a', 'b', 'c', 'd'])
      expect(Object.values(r.seats).sort((x, y) => x - y)).toEqual([0, 3, 5, 8])
      expect(Object.keys(r.cards).sort()).toEqual(['a', 'b', 'c', 'd'])
      expect(new Set(Object.values(r.cards)).size).toBe(4)
      expect(r.button).toBe(drawWinner(r.cards))
    }
  })

  it('рассадка меняется от колоды к колоде', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) seen.add(JSON.stringify(drawSeats(players, ['a', 'b', 'c', 'd'], shuffle(FULL, bytes(seed))).seats))
    expect(seen.size).toBeGreaterThan(5)
  })

  it('карта розыгрыша — только играющим', () => {
    const r = drawSeats(players, ['a', 'c'], stacked(['Kh', '2c', '9d', '5s', 'Ac', '7h']))
    expect(Object.keys(r.cards).sort()).toEqual(['a', 'c'])
    expect(Object.values(r.seats).sort((x, y) => x - y)).toEqual([0, 3, 5, 8])
  })
})

describe.each(MODES)('«Перемешать места» за столом — %s', (_, roundtrip) => {
  // p0 — место 0, p1 — 1, p2 — 2. Ключи: p0 — 5c, p1 — Td, p2 — 3h → порядок p2, p0, p1
  // Розыгрыш по новым местам (p2, p0, p1): 4s, Kd, Ks — старшая у p1 (♠ старше ♦)
  const deck = stacked(['5c', 'Td', '3h', '4s', 'Kd', 'Ks'])

  it('ведущий перемешивает: новые места, карты розыгрыша, баттон — у старшей', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], { maxSeats: 6 }), [shuffleStep('p0', deck, 500)], roundtrip)
    expect(seats(s)).toEqual({ p2: 0, p0: 1, p1: 2 })
    expect(s.seatDraw).toEqual({ at: 500, cards: { p2: '4s', p0: 'Kd', p1: 'Ks' }, button: 'p1' })
  })

  it('стеки, закуп, журнал фишек и докупы — те же', () => {
    const before = play(newTable(['p0', 'p1', 'p2'], {}, { p1: 700 }), [{ from: 'p2', msg: { type: 'rebuy', amount: 300 } }], roundtrip)
    const after = play(before, [shuffleStep('p0', deck)], roundtrip)
    const money = (s: TableState) => s.players.map((p) => [p.id, p.chips, p.buyIn]).sort()
    expect(money(after)).toEqual(money(before))
    expect(after.chipLog).toEqual(before.chipLog)
    expect(after.rebuyRequests).toEqual(before.rebuyRequests)
    expect(after.hostId).toBe(before.hostId)
  })

  it('первая раздача после розыгрыша — с этим баттоном, розыгрыш снимается', () => {
    const s = play(newTable(['p0', 'p1', 'p2']), [shuffleStep('p0', deck), start('p0')], roundtrip)
    const hand = s.hand!
    expect(hand.seats[hand.button].id).toBe('p1')
    expect(s.buttonSeat).toBe(2)
    expect(s.seatDraw).toBeNull()
  })

  it('не от прошлой кнопки: и после раздач баттон — у старшей карты', () => {
    const one = play(newTable(['p0', 'p1', 'p2']), [start('p0')], roundtrip)
    const h = one.hand!
    const order = [0, 1, 2].map((k) => h.seats[(h.button + k) % 3].id)
    const done = play(one, [fold(order[0]), fold(order[1]), award('p0', [[order[2]]])], roundtrip)
    expect(done.buttonSeat).toBe(0)
    // Без розыгрыша кнопка ушла бы на место 1. Ключи: p0 — 2c, p1 — 2d, p2 — 2h; в колоде 2h < 2d < 2c →
    // p2 — место 0, p1 — 1, p0 — 2; карты по новым местам: p2, p1, p0
    const keys = ['2c', '2d', '2h']
    const far = play(done, [shuffleStep('p0', stacked([...keys, '9c', '9d', '9s'])), start('p0')], roundtrip)
    expect(far.hand!.seats[far.hand!.button].id).toBe('p0')
    expect(far.buttonSeat).toBe(2)
    const back = play(done, [shuffleStep('p0', stacked([...keys, 'As', '9h', '9d'])), start('p0')], roundtrip)
    expect(back.hand!.seats[back.hand!.button].id).toBe('p2')
    expect(back.buttonSeat).toBe(0)
  })

  it('пропускающий раздачи и без фишек — без карты розыгрыша, но пересаживается', () => {
    const s = play(
      newTable(['p0', 'p1', 'p2', 'p3'], {}, { p3: 0 }),
      [{ from: 'p2', msg: { type: 'sitOut', sittingOut: true } }, shuffleStep('p0', shuffle(FULL, bytes(7)))],
      roundtrip,
    )
    expect(Object.keys(s.seatDraw!.cards).sort()).toEqual(['p0', 'p1'])
    expect(Object.values(seats(s)).sort()).toEqual([0, 1, 2, 3])
  })

  it('свободные места не съедены', () => {
    const base = play(newTable(['p0', 'p1', 'p2'], { maxSeats: 9 }), [{ from: 'p1', msg: { type: 'moveSeat', seat: 6 } }], roundtrip)
    for (let seed = 1; seed <= 10; seed++) {
      const s = play(base, [shuffleStep('p0', shuffle(FULL, bytes(seed)))], roundtrip)
      expect(Object.values(seats(s)).sort()).toEqual([0, 2, 6])
    }
  })

  it('во время раздачи — отказ; только ведущий; без колоды — отказ', () => {
    const s = play(newTable(['p0', 'p1', 'p2']), [start('p0')], roundtrip)
    expect(send(s, 'p0', { type: 'shuffleSeats' }, deck)).toEqual({ ok: false, error: SHUFFLE_BETWEEN })
    const idle = newTable(['p0', 'p1', 'p2'])
    expect(send(idle, 'p1', { type: 'shuffleSeats' }, deck)).toEqual({ ok: false, error: 'Это может только ведущий' })
    expect(send(idle, 'p0', { type: 'shuffleSeats' })).toEqual({ ok: false, error: SHUFFLE_NO_DECK })
    expect(send(idle, 'p0', { type: 'shuffleSeats' }, deck.slice(1))).toEqual({ ok: false, error: SHUFFLE_NO_DECK })
    expect(send(idle, 'p0', { type: 'shuffleSeats' }, [...deck.slice(1), deck[1]])).toEqual({ ok: false, error: SHUFFLE_NO_DECK })
  })

  it('один с фишками — отказ', () => {
    const s = newTable(['p0', 'p1'], {}, { p1: 0 })
    expect(send(s, 'p0', { type: 'shuffleSeats' }, deck)).toEqual({ ok: false, error: 'Нужно хотя бы двое с фишками' })
  })

  it('в «Перерыв» — можно; перемешать снова — новый розыгрыш', () => {
    const s = play(
      newTable(['p0', 'p1', 'p2']),
      [{ from: 'p0', msg: { type: 'pause', paused: true } }, shuffleStep('p0', deck, 1), shuffleStep('p0', stacked(['2c', '2d', '2h', 'As', '9h', '9d']), 2)],
      roundtrip,
    )
    // После первого: p2 — 0, p0 — 1, p1 — 2; ключи по ним 2c, 2d, 2h → p1 — 0, p0 — 1, p2 — 2
    expect(seats(s)).toEqual({ p1: 0, p0: 1, p2: 2 })
    expect(s.seatDraw).toEqual({ at: 2, cards: { p1: 'As', p0: '9h', p2: '9d' }, button: 'p1' })
  })

  it('турнир — до старта можно, после — отказ', () => {
    const cup = { format: 'tournament' as const, tournament: { ...DEFAULT_TOURNAMENT, buyIn: 500 } }
    const before = play(newTable(['p0', 'p1', 'p2'], cup), [shuffleStep('p0', deck)], roundtrip)
    expect(before.seatDraw?.button).toBe('p1')
    const started = play(before, [start('p0')], roundtrip)
    expect(started.hand!.seats[started.hand!.button].id).toBe('p1')
    expect(send(started, 'p0', { type: 'shuffleSeats' }, deck)).toEqual({ ok: false, error: SHUFFLE_TOURNAMENT })
    const h = started.hand!
    const order = [0, 1, 2].map((k) => h.seats[(h.button + k) % 3].id)
    const done = play(started, [fold(order[0]), fold(order[1]), award('p0', [[order[2]]])], roundtrip)
    expect(send(done, 'p0', { type: 'shuffleSeats' }, deck)).toEqual({ ok: false, error: SHUFFLE_TOURNAMENT })
  })

  it('раздача «сама» после розыгрыша — с полной паузы', () => {
    const one = play(newTable(['p0', 'p1', 'p2'], { autoStart: 'fast' }), [start('p0')], roundtrip)
    const h = one.hand!
    const order = [0, 1, 2].map((k) => h.seats[(h.button + k) % 3].id)
    const done = play(one, [fold(order[0]), fold(order[1]), award('p0', [[order[2]]], 1000)], roundtrip)
    expect(done.nextHandAt).toBe(4000)
    const s = play(done, [shuffleStep('p0', deck, 2500)], roundtrip)
    expect(s.nextHandAt).toBe(5500)
  })

  it('пересадка игроком после розыгрыша — как была; баттон — у вытянувшего', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], { maxSeats: 6 }), [shuffleStep('p0', deck), { from: 'p1', msg: { type: 'moveSeat', seat: 4 } }, start('p0')], roundtrip)
    expect(s.hand!.seats[s.hand!.button].id).toBe('p1')
    expect(s.buttonSeat).toBe(4)
  })
})

describe('вид стола', () => {
  const deck = stacked(['5c', 'Td', '3h', '4s', 'Kd', 'Ks'])

  it('после розыгрыша: у мест — карты розыгрыша, кнопка — у старшей; началась раздача — розыгрыша нет', () => {
    const s = play(newTable(['p0', 'p1', 'p2']), [shuffleStep('p0', deck, 9)], false)
    const v = tableView(s, 'p2', 0)
    expect(v.draw).toEqual({ at: 9, button: 'p1' })
    expect(v.seats.map((x) => [x.id, x.seat, x.draw, x.button])).toEqual([
      ['p2', 0, '4s', false],
      ['p0', 1, 'Kd', false],
      ['p1', 2, 'Ks', true],
    ])
    const dealt = tableView(play(s, [start('p0')], false), 'p2', 0)
    expect(dealt.draw).toBeNull()
    expect(dealt.seats.every((x) => x.draw === null)).toBe(true)
  })

  it('«Перемешать места» — ведущему между раздачами; в раздаче, игроку и в начатом турнире — нет', () => {
    const s = newTable(['p0', 'p1'])
    expect(tableView(s, 'p0', 0).canShuffle).toBe(true)
    expect(tableView(s, 'p1', 0).canShuffle).toBe(false)
    expect(tableView(play(s, [start('p0')], false), 'p0', 0).canShuffle).toBe(false)
    const cup = newTable(['p0', 'p1'], { format: 'tournament', tournament: { ...DEFAULT_TOURNAMENT, buyIn: 500 } })
    expect(tableView(cup, 'p0', 0).canShuffle).toBe(true)
    expect(tableView(play(cup, [start('p0')], false), 'p0', 0).canShuffle).toBe(false)
  })
})

describe('на одном телефоне', () => {
  it('ведущий перемешивает своей колодой', () => {
    let n = 0
    const r = startLocalTable(
      [
        { name: 'Аня', regularId: null },
        { name: 'Боря', regularId: null },
        { name: 'Вика', regularId: null },
      ],
      { sb: 5, bb: 10, startingStack: 1000, felt: 'green' },
      0,
      () => `id${n++}`,
    )
    if (!r.ok) throw new Error(r.error)
    const moved = shuffleSeatsNow(r.local.table, 0, bytes(3))
    if (!moved.ok) throw new Error(moved.error)
    expect(moved.state.seatDraw).not.toBeNull()
    expect(moved.state.players.map((p) => p.seat).sort()).toEqual([0, 1, 2])
  })
})
