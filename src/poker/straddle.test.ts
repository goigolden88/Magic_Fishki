// Страддл (#222, Р-91): UTG после блайндов вслепую ставит 2 ББ, ходит до флопа последним и может повысить
import { describe, expect, it } from 'vitest'
import { potLimit } from './hand'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { createTable, handle, type TableState } from './table'
import { allin, award, call, check, fold, MODES, newTable, play, raise, start } from './testing'
import { DEFAULT_TOURNAMENT } from './tournament'

const toAct = (s: TableState) => (s.hand && s.hand.toAct >= 0 ? s.hand.seats[s.hand.toAct].id : null)
const tryMsg = (s: TableState, from: string, msg: ClientBody) => handle(s, from, { ...msg, v: PROTOCOL_VERSION }, 0)
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`)
const pot = (s: TableState) => s.hand?.seats.reduce((sum, x) => sum + x.committed, 0)

describe.each(MODES)('страддл — %s', (_, roundtrip) => {
  // Кнопка p0, малый p1, большой p2, UTG — p3; втроём UTG — кнопка p0
  it.each([
    [3, 'p0', 'p1'],
    [4, 'p3', 'p0'],
    [6, 'p3', 'p4'],
    [9, 'p3', 'p4'],
  ])('%i играющих: UTG %s ставит 2 ББ, первым ходит %s, круг закрывается на страддле', (n, utg, first) => {
    const players = ids(n)
    const s = play(newTable(players, { straddle: true }), [start('p0')], roundtrip)
    const hand = s.hand!
    expect(hand.straddle).toBe(20)
    expect(hand.currentBet).toBe(20)
    expect(hand.log).toEqual([{ street: 'preflop', playerId: utg, type: 'straddle', bet: 20, allIn: false }])
    expect(hand.seats.find((x) => x.id === utg)?.bet).toBe(20)
    expect(toAct(s)).toBe(first)
    // Все по кругу уравнивают — малый и большой тоже; последний ход до флопа — у страддла
    const u = players.indexOf(utg)
    const callers = Array.from({ length: n - 1 }, (_, k) => players[(u + 1 + k) % n])
    expect(callers).toContain('p2') // большой блайнд в круге не пропущен
    const called = play(s, callers.map(call), roundtrip)
    expect(called.hand?.stage).toBe('preflop')
    expect(toAct(called)).toBe(utg)
    expect(pot(called)).toBe(20 * n)
  })

  it('все уравняли — страддл может чек (флоп) или рейз: минимум до 4 ББ, повторный — по обычному правилу', () => {
    const s = play(newTable(ids(4), { straddle: true }), [start('p0'), call('p0'), call('p1'), call('p2')], roundtrip)
    expect(toAct(s)).toBe('p3')
    expect(play(s, [check('p3')], roundtrip).hand?.stage).toBe('flop')
    expect(tryMsg(s, 'p3', { type: 'act', action: { type: 'raise', to: 39 } })).toEqual({ ok: false, error: 'Минимум — до 40' })
    expect(play(s, [raise('p3', 40)], roundtrip).hand?.currentBet).toBe(40)
    const raised = play(s, [raise('p3', 70)], roundtrip)
    expect(raised.hand?.currentBet).toBe(70)
    expect(toAct(raised)).toBe('p0')
    // Рейз на 50 — следующий минимум: ещё на 50
    expect(tryMsg(raised, 'p0', { type: 'act', action: { type: 'raise', to: 119 } })).toEqual({ ok: false, error: 'Минимум — до 120' })
    expect(play(raised, [raise('p0', 120)], roundtrip).hand?.currentBet).toBe(120)
  })

  it('первый ходящий: минимальный рейз — до 4 ББ, затем по обычному правилу', () => {
    const s = play(newTable(ids(4), { straddle: true }), [start('p0')], roundtrip)
    expect(tryMsg(s, 'p0', { type: 'act', action: { type: 'raise', to: 39 } })).toEqual({ ok: false, error: 'Минимум — до 40' })
    expect(tryMsg(s, 'p0', { type: 'act', action: { type: 'check' } })).toEqual({ ok: false, error: 'Нельзя чек: нужно уравнять 20' })
    const raised = play(s, [raise('p0', 60)], roundtrip)
    expect(tryMsg(raised, 'p1', { type: 'act', action: { type: 'raise', to: 99 } })).toEqual({ ok: false, error: 'Минимум — до 100' })
    // Все сбросили на рейз — страддл тоже может сбросить; непокрытые 40 — назад, банк 5 + 10 + 20 + 20
    const folded = play(raised, [fold('p1'), fold('p2'), fold('p3'), award('p0', [['p0']])], roundtrip)
    expect(folded.lastHand?.payouts).toEqual({ p0: 55 })
  })

  it('двое в раздаче — страддла нет', () => {
    const s = play(newTable(['p0', 'p1'], { straddle: true }), [start('p0')], roundtrip)
    expect(s.hand?.straddle).toBeUndefined()
    expect(s.hand?.currentBet).toBe(10)
    expect(s.hand?.log).toEqual([])
    expect(toAct(s)).toBe('p0')
  })

  it('у UTG меньше 2 ББ — в этой раздаче страддла нет; ровно 2 ББ — страддл олл-ин', () => {
    const short = play(newTable(ids(4), { straddle: true }, { p3: 19 }), [start('p0')], roundtrip)
    expect(short.hand?.straddle).toBeUndefined()
    expect(short.hand?.currentBet).toBe(10)
    expect(short.hand?.seats[3].bet).toBe(0)
    expect(toAct(short)).toBe('p3')
    // С анте: до ставки у UTG 25 − 10 = 15 — меньше 2 ББ
    const afterAnte = play(newTable(ids(4), { straddle: true, ante: 10 }, { p3: 25 }), [start('p0')], roundtrip)
    expect(afterAnte.hand?.straddle).toBeUndefined()
    expect(afterAnte.hand?.log.map((e) => e.type)).toEqual(['ante', 'ante', 'ante', 'ante'])
    // Анте забрало всё — тоже без страддла
    expect(play(newTable(ids(4), { straddle: true, ante: 10 }, { p3: 10 }), [start('p0')], roundtrip).hand?.straddle).toBeUndefined()
    const exact = play(newTable(ids(4), { straddle: true }, { p3: 20 }), [start('p0')], roundtrip)
    expect(exact.hand?.log).toEqual([{ street: 'preflop', playerId: 'p3', type: 'straddle', bet: 20, allIn: true }])
    expect(exact.hand?.currentBet).toBe(20)
    expect(toAct(exact)).toBe('p0')
  })

  it('с анте: анте, блайнды, страддл — по порядку; банк сходится', () => {
    const s = play(newTable(ids(4), { straddle: true, ante: 5 }), [start('p0')], roundtrip)
    expect(s.hand?.log.map((e) => [e.type, e.playerId, e.bet])).toEqual([
      ['ante', 'p0', 5],
      ['ante', 'p1', 5],
      ['ante', 'p2', 5],
      ['ante', 'p3', 5],
      ['straddle', 'p3', 20],
    ])
    expect(s.hand?.seats.map((x) => [x.bet, x.committed])).toEqual([
      [0, 5],
      [5, 10],
      [10, 15],
      [20, 25],
    ])
    const flop = play(s, [call('p0'), call('p1'), call('p2'), check('p3')], roundtrip)
    expect(flop.hand?.stage).toBe('flop')
    expect(pot(flop)).toBe(4 * 5 + 4 * 20)
    expect(flop.hand?.seats.map((x) => x.chips)).toEqual([975, 975, 975, 975])
  })

  it('после флопа порядок хода прежний — первый после кнопки', () => {
    const four = play(newTable(ids(4), { straddle: true }), [start('p0'), call('p0'), call('p1'), call('p2'), check('p3')], roundtrip)
    expect(four.hand?.stage).toBe('flop')
    expect(toAct(four)).toBe('p1')
    // Втроём страддл — кнопка: после флопа он ходит последним
    const three = play(newTable(ids(3), { straddle: true }), [start('p0'), call('p1'), call('p2'), check('p0')], roundtrip)
    expect(three.hand?.stage).toBe('flop')
    expect(toAct(three)).toBe('p1')
    expect(toAct(play(three, [check('p1'), check('p2')], roundtrip))).toBe('p0')
  })

  it('кнопка переходит — страддл ставит следующий за новым большим', () => {
    // Все сбросили на страддл — банк p3; следующая раздача: кнопка p1, большой p3, страддл p0
    const s = play(
      newTable(ids(4), { straddle: true }),
      [start('p0'), fold('p0'), fold('p1'), fold('p2'), award('p0', [['p3']]), start('p0')],
      roundtrip,
    )
    expect(s.hand?.button).toBe(1)
    expect(s.hand?.log).toEqual([{ street: 'preflop', playerId: 'p0', type: 'straddle', bet: 20, allIn: false }])
    expect(toAct(s)).toBe('p1')
  })

  it('олл-ин первого ходящего над страддлом — страддл может уравнять', () => {
    const s = play(newTable(ids(4), { straddle: true }, { p0: 300 }), [start('p0'), allin('p0'), fold('p1'), fold('p2')], roundtrip)
    expect(toAct(s)).toBe('p3')
    expect(play(s, [call('p3')], roundtrip).hand?.stage).toBe('showdown')
  })
})

describe('страддл: пот-лимит (омаха)', () => {
  it('предел первого ходящего — колл 2 ББ плюс банк с ним', () => {
    // Банк 5 + 10 + 20 = 35, колл 20 → до 20 + 35 + 20 = 75
    const s = play(newTable(ids(4), { game: 'omaha', straddle: true }), [start('p0')], false)
    expect(s.hand?.limit).toBe('pot')
    expect(potLimit(s.hand!, s.hand!.seats[0])).toBe(75)
    expect(tryMsg(s, 'p0', { type: 'act', action: { type: 'raise', to: 76 } })).toEqual({ ok: false, error: 'Не больше банка: 75' })
    expect(play(s, [raise('p0', 75)], false).hand?.currentBet).toBe(75)
  })
})

describe('страддл: настройка стола', () => {
  it('столы без поля и с «нет» — как раньше: ставка круга — ББ, первым ходит следующий за ним', () => {
    for (const settings of [{}, { straddle: false }]) {
      const s = play(newTable(ids(4), settings), [start('p0')], false)
      expect(s.hand?.straddle).toBeUndefined()
      expect(s.hand?.currentBet).toBe(10)
      expect(s.hand?.log).toEqual([])
      expect(toAct(s)).toBe('p3')
    }
  })

  it('в турнире страддл не действует', () => {
    const tournament = { ...DEFAULT_TOURNAMENT, buyIn: 500, levelMinutes: 10 }
    const s = play(newTable(ids(4), { format: 'tournament', straddle: true, tournament }), [start('p0')], false)
    expect(s.settings.format).toBe('tournament')
    expect(s.hand?.straddle).toBeUndefined()
    expect(s.hand?.currentBet).toBe(s.hand?.bb)
    expect(s.hand?.log.some((e) => e.type === 'straddle')).toBe(false)
  })

  it('не «да» и не «нет» — отказ при создании', () => {
    expect(createTable('p0', 'P0', { straddle: 'да' } as never, 0)).toEqual({ ok: false, error: 'Страддл — включён или выключен' })
  })
})
