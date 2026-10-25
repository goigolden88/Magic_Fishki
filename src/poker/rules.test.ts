import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, VERSION_ERROR, type ClientBody } from './protocol'
import { createTable, handle, type TableState } from './table'
import { allin, award, call, check, fold, MODES, newTable, play, raise, sit, start } from './testing'

const toAct = (s: TableState) => (s.hand && s.hand.toAct >= 0 ? s.hand.seats[s.hand.toAct].id : null)
const chips = (s: TableState, id: string) => s.players.find((p) => p.id === id)?.chips
const tryMsg = (s: TableState, from: string, msg: ClientBody) => handle(s, from, { ...msg, v: PROTOCOL_VERSION }, 0)
const NOT_REOPENED = 'Неполный олл-ин не открывает торги: можно уравнять или сбросить'

describe.each(MODES)('правила торгов — %s', (_, roundtrip) => {
  // Кнопка p0, малый p1, большой p2. p0 поднимает до 30, p1 уравнивает,
  // у p2 всего 40 — его олл-ин повышает на 10, меньше полного рейза (20)
  const shortAllIn = () =>
    play(newTable(['p0', 'p1', 'p2'], {}, { p2: 40 }), [start('p0'), raise('p0', 30), call('p1'), allin('p2')], roundtrip)

  it('неполный олл-ин-рейз: ходившим можно только уравнять или сбросить', () => {
    const s = shortAllIn()
    expect(s.hand?.currentBet).toBe(40)
    expect(toAct(s)).toBe('p0')
    expect(tryMsg(s, 'p0', { type: 'act', action: { type: 'raise', to: 100 } })).toEqual({ ok: false, error: NOT_REOPENED })
    expect(tryMsg(s, 'p0', { type: 'act', action: { type: 'allin' } })).toEqual({ ok: false, error: NOT_REOPENED })
    const after = play(s, [call('p0')], roundtrip)
    expect(tryMsg(after, 'p1', { type: 'act', action: { type: 'raise', to: 100 } })).toEqual({ ok: false, error: NOT_REOPENED })
    const flop = play(after, [call('p1')], roundtrip)
    expect(flop.hand?.stage).toBe('flop')
    expect(flop.hand?.seats.map((x) => x.committed)).toEqual([40, 40, 40])
  })

  it('неполный олл-ин: кто ещё не ходил, может повысить от полного рейза', () => {
    // Кнопка p0, малый p1, большой p2, первым ходит p3. У p0 всего 40
    const s = play(
      newTable(['p0', 'p1', 'p2', 'p3'], {}, { p0: 40 }),
      [start('p0'), raise('p3', 30), allin('p0')],
      roundtrip,
    )
    expect(toAct(s)).toBe('p1')
    expect(tryMsg(s, 'p1', { type: 'act', action: { type: 'raise', to: 59 } })).toEqual({ ok: false, error: 'Минимум — до 60' })
    const raised = play(s, [raise('p1', 60)], roundtrip)
    expect(raised.hand?.currentBet).toBe(60)
  })

  it('полный олл-ин-рейз открывает торги снова', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], {}, { p2: 200 }), [start('p0'), raise('p0', 30), call('p1'), allin('p2')], roundtrip)
    const reraised = play(s, [raise('p0', 500)], roundtrip)
    expect(reraised.hand?.currentBet).toBe(500)
  })

  it('неполные олл-ины вместе набрали полный рейз — торги открыты', () => {
    // Кнопка p0, малый p1, большой p2, первым p3. p3 ставит 100 (рейз на 90), p0 олл-ин 150, p1 олл-ин 200:
    // вместе +100 к 100 — не меньше полного рейза, p3 может повысить
    const s = play(
      newTable(['p0', 'p1', 'p2', 'p3'], {}, { p0: 150, p1: 200 }),
      [start('p0'), raise('p3', 100), allin('p0'), allin('p1'), fold('p2')],
      roundtrip,
    )
    expect(toAct(s)).toBe('p3')
    expect(play(s, [raise('p3', 400)], roundtrip).hand?.currentBet).toBe(400)
  })

  it('хедз-ап: кнопка ставит малый и ходит первой до флопа, кнопка переходит', () => {
    let s = play(newTable(['p0', 'p1']), [start('p0')], roundtrip)
    expect(s.hand?.seats.map((x) => [x.id, x.bet])).toEqual([
      ['p0', 5],
      ['p1', 10],
    ])
    expect(toAct(s)).toBe('p0')
    s = play(s, [fold('p0'), award('p0', [['p1']]), start('p0')], roundtrip)
    expect(s.hand?.button).toBe(1)
    expect(s.hand?.seats.map((x) => [x.id, x.bet])).toEqual([
      ['p0', 10],
      ['p1', 5],
    ])
    expect(toAct(s)).toBe('p1')
  })

  it('двое отмечены победителями — нечётная фишка первому по кругу от кнопки', () => {
    // Кнопка p0 уравнивает, p1 (малый) сбрасывает: банк 25 на p0 и p2
    const s = play(
      newTable(['p0', 'p1', 'p2']),
      [
        start('p0'),
        call('p0'),
        fold('p1'),
        check('p2'),
        check('p2'),
        check('p0'),
        check('p2'),
        check('p0'),
        check('p2'),
        check('p0'),
        award('p0', [['p0', 'p2']]),
      ],
      roundtrip,
    )
    expect(s.lastHand?.payouts).toEqual({ p2: 13, p0: 12 })
    expect([chips(s, 'p0'), chips(s, 'p1'), chips(s, 'p2')]).toEqual([1002, 995, 1003])
  })

  it('отметки ведущего проверяются: каждый банк, только претенденты', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], {}, { p0: 300 }), [start('p0'), allin('p0'), call('p1'), call('p2'), check('p1'), check('p2'), check('p1'), check('p2'), check('p1'), check('p2')], roundtrip)
    expect(s.hand?.pots).toHaveLength(1) // олл-ин p0 все уравняли — банк один
    const pots2 = play(newTable(['p0', 'p1', 'p2'], {}, { p0: 300 }), [start('p0'), allin('p0'), raise('p1', 600), call('p2'), check('p1'), check('p2'), check('p1'), check('p2'), check('p1'), check('p2')], roundtrip)
    expect(tryMsg(pots2, 'p0', { type: 'award', winners: [['p0']] })).toEqual({ ok: false, error: 'Нужен победитель каждого банка: банков 2' })
    expect(tryMsg(pots2, 'p0', { type: 'award', winners: [['p0'], []] })).toEqual({ ok: false, error: 'Банк 2: отметьте победителя' })
    expect(tryMsg(pots2, 'p0', { type: 'award', winners: [['p0'], ['p0']] })).toEqual({
      ok: false,
      error: 'Банк 2: отмечен игрок, который за него не борется',
    })
    expect(tryMsg(pots2, 'p1', { type: 'award', winners: [['p0'], ['p1']] })).toEqual({ ok: false, error: 'Это может только ведущий' })
    expect(tryMsg(pots2, 'p1', { type: 'act', action: { type: 'check' } })).toEqual({
      ok: false,
      error: 'Торги закрыты — ведущий отмечает победителя',
    })
  })
})

describe('отказы не меняют состояние', () => {
  const preflop = () => play(newTable(['p0', 'p1', 'p2']), [start('p0')], false)

  it.each<[string, string, unknown, string]>([
    ['ставка больше стека', 'p0', { type: 'act', action: { type: 'raise', to: 5000 } }, 'Не хватает фишек: можно поставить до 1000'],
    ['меньше минимального рейза', 'p0', { type: 'act', action: { type: 'raise', to: 15 } }, 'Минимум — до 20'],
    ['ставка не больше текущей', 'p0', { type: 'act', action: { type: 'raise', to: 10 } }, 'Ставка должна быть больше 10'],
    ['дробная ставка', 'p0', { type: 'act', action: { type: 'raise', to: 25.5 } }, 'Ставка — целое число фишек'],
    ['чек, когда надо уравнять', 'p0', { type: 'act', action: { type: 'check' } }, 'Нельзя чек: нужно уравнять 10'],
    ['ход не в свою очередь', 'p1', { type: 'act', action: { type: 'call' } }, 'Сейчас не ваш ход'],
    ['игрока нет за столом', 'stranger', { type: 'act', action: { type: 'fold' } }, 'Вас нет за столом'],
    ['новая раздача, пока идёт эта', 'p0', { type: 'start' }, 'Раздача ещё идёт'],
    ['не ведущий', 'p1', { type: 'skip' }, 'Это может только ведущий'],
    ['неизвестный ход', 'p0', { type: 'act', action: { type: 'bluff' } }, 'Неизвестный ход — обновите приложение'],
    ['неизвестное сообщение', 'p0', { type: 'teleport' }, 'Неизвестное сообщение — обновите приложение'],
  ])('%s', (_, from, msg, error) => {
    const s = preflop()
    const before = structuredClone(s)
    expect(handle(s, from, { ...(msg as object), v: PROTOCOL_VERSION }, 0)).toEqual({ ok: false, error })
    expect(s).toEqual(before)
  })

  it('чужая версия протокола — «обновите приложение»', () => {
    const s = preflop()
    const before = structuredClone(s)
    expect(handle(s, 'p0', { type: 'act', action: { type: 'fold' }, v: PROTOCOL_VERSION + 1 }, 0)).toEqual({ ok: false, error: VERSION_ERROR })
    expect(handle(s, 'p0', { type: 'act', action: { type: 'fold' } }, 0)).toEqual({ ok: false, error: VERSION_ERROR })
    expect(handle(s, 'p0', 'fold', 0)).toEqual({ ok: false, error: VERSION_ERROR })
    expect(s).toEqual(before)
  })
})

describe('стол', () => {
  it('посадка: места по порядку, закуп в журнале, полный стол — отказ', () => {
    const s = play(newTable(['p0', 'p1'], { maxSeats: 2 }), [], false)
    expect(s.players.map((p) => [p.id, p.seat, p.chips, p.buyIn])).toEqual([
      ['p0', 0, 1000, 1000],
      ['p1', 1, 1000, 1000],
    ])
    expect(s.chipLog.map((e) => e.kind)).toEqual(['buyin', 'buyin'])
    expect(() => play(s, [sit('p2', 'P2')], false)).toThrow('Стол заполнен')
    expect(() => play(s, [sit('p1', 'P1')], false)).toThrow('Вы уже за столом')
  })

  it('постоянный игрок садится один раз; гости — без связи', () => {
    const r = createTable('p0', 'Анна', {}, 0, 'r-anna')
    if (!r.ok) throw new Error(r.error)
    const s = play(
      r.state,
      [
        { from: 'p1', msg: { type: 'sit', name: 'Борис', regularId: 'r-boris' } },
        { from: 'p2', msg: { type: 'sit', name: 'Гость' } },
      ],
      false,
    )
    expect(s.players.map((p) => [p.id, p.regularId])).toEqual([
      ['p0', 'r-anna'],
      ['p1', 'r-boris'],
      ['p2', null],
    ])
    expect(() => play(s, [{ from: 'p3', msg: { type: 'sit', name: 'Анна-2', regularId: 'r-anna' } }], false)).toThrow(
      'Этот игрок уже за столом',
    )
  })

  it('неверные настройки — отказ', () => {
    expect(createTable('p0', 'P0', { sb: 10, bb: 5 }, 0).ok).toBe(false)
    expect(createTable('p0', 'P0', { startingStack: 0 }, 0).ok).toBe(false)
    expect(createTable('p0', ' ', {}, 0)).toEqual({ ok: false, error: 'Нужно имя' })
  })

  it('раздача не начнётся, пока за столом меньше двоих с фишками', () => {
    const s = newTable(['p0'])
    expect(tryMsg(s, 'p0', { type: 'start' })).toEqual({ ok: false, error: 'Нужно хотя бы двое с фишками' })
  })

  it('все олл-ин уже на блайндах — торги сразу закрыты', () => {
    const s = play(newTable(['p0', 'p1'], {}, { p0: 5, p1: 10 }), [start('p0')], false)
    expect(s.hand?.stage).toBe('showdown')
    expect(s.hand?.returned).toEqual({ playerId: 'p1', amount: 5 })
    expect(s.hand?.pots).toEqual([{ amount: 10, eligible: ['p0', 'p1'] }])
    const done = play(s, [award('p0', [['p0']])], false)
    expect([chips(done, 'p0'), chips(done, 'p1')]).toEqual([10, 5])
  })
})
