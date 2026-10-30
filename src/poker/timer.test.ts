import { describe, expect, it } from 'vitest'
import type { Card } from './cards'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { AUTO_START_MS, handle, nextDeadline, onTime, type TableState } from './table'
import { allin, award, call, fold, MODES, newTable, play, sit, stackedDeck, start } from './testing'

const T = 30_000 // время на ход в тестах — 30 с

const at = (step: ReturnType<typeof call>, now: number) => ({ ...step, now })
const send = (state: TableState, from: string, body: ClientBody, now = 0) => handle(state, from, { v: PROTOCOL_VERSION, ...body }, now)
const roundtrip = (s: TableState) => JSON.parse(JSON.stringify(s)) as TableState

// Хедз-ап: кнопка — ведущий h, ставит малый и ходит первым
const timed = (settings = {}) => newTable(['h', 'g'], { turnSeconds: 30, ...settings })

describe.each(MODES)('время на ход (%s)', (_, rt) => {
  const tick = (s: TableState, now: number) => {
    const r = onTime(rt ? roundtrip(s) : s, now)
    return r && rt ? roundtrip(r) : r
  }

  it('срок — от начала хода; новый ход — новый срок; таймер выключен — срока нет', () => {
    const s = play(timed(), [at(start('h'), 1000)], rt)
    expect(s.turn).toEqual({ hand: 1, move: 0, deadline: 1000 + T })
    expect(nextDeadline(s)).toBe(1000 + T)
    const after = play(s, [at(call('h'), 5000)], rt)
    expect(after.turn).toEqual({ hand: 1, move: 1, deadline: 5000 + T })
    const off = play(newTable(['h', 'g']), [start('h')], rt)
    expect(off.turn).toBeNull()
    expect(nextDeadline(off)).toBeNull()
  })

  it('время вышло: нужно уравнять — пас, в журнале «время вышло»', () => {
    const s = play(timed(), [start('h')], rt)
    expect(tick(s, T - 1)).toBeNull()
    const r = tick(s, T)!
    expect(r.hand?.seats[0].folded).toBe(true)
    expect(r.hand?.log).toEqual([{ street: 'preflop', playerId: 'h', type: 'fold', bet: 5, allIn: false, timeout: true }])
    expect(r.turn).toBeNull() // торги закрыты
  })

  it('время вышло: можно чек — чек', () => {
    const s = play(timed(), [start('h'), at(call('h'), 1000)], rt)
    const r = tick(s, 1000 + T)!
    expect(r.hand?.log.at(-1)).toMatchObject({ playerId: 'g', type: 'check', timeout: true })
    expect(r.hand?.stage).toBe('flop')
    expect(r.turn).toEqual({ hand: 1, move: 2, deadline: 1000 + 2 * T })
  })

  it('будильник сработал дважды или раньше срока — ничего не делает', () => {
    const s = play(timed(), [start('h'), at(call('h'), 1000)], rt)
    expect(tick(s, 1000 + T - 1)).toBeNull()
    const once = tick(s, 1000 + T)!
    expect(tick(once, 1000 + T)).toBeNull()
    expect(once.hand?.log).toHaveLength(2)
    // Игрок успел сам — старый срок не срабатывает
    const acted = play(s, [at({ from: 'g', msg: { type: 'act', action: { type: 'check' } } }, 1000 + T - 5)], rt)
    expect(tick(acted, 1000 + T)).toBeNull()
  })

  it('два истечения подряд — «пропускает раздачи»; вернуться — его кнопкой', () => {
    let s = play(timed(), [start('h')], rt)
    s = tick(s, T)! // h — пас по времени
    expect(s.timeouts).toEqual({ h: 1 })
    expect(s.players[0].sittingOut).toBe(false)
    s = play(s, [award('h', [['g']]), at(start('h'), T + 1), at(call('g'), T + 2)], rt)
    s = tick(s, 2 * T + 2)! // во второй раздаче h — чек по времени
    expect(s.players[0].sittingOut).toBe(true)
    expect(s.timeouts).toEqual({})
    s = play(s, [{ from: 'h', msg: { type: 'sitOut', sittingOut: false } }], rt)
    expect(s.players[0].sittingOut).toBe(false)
  })

  it('свой ход между истечениями — счёт заново', () => {
    let s = play(timed(), [start('h')], rt)
    s = tick(s, T)!
    // Вторая раздача: кнопка у g — он ходит первым, h ходит сам
    s = play(s, [award('h', [['g']]), at(start('h'), T + 1), at(call('g'), T + 2), at(fold('h'), T + 3)], rt)
    expect(s.timeouts).toEqual({})
    s = play(s, [award('h', [['g']]), at(start('h'), T + 4)], rt)
    s = tick(s, 2 * T + 4)!
    expect(s.timeouts).toEqual({ h: 1 })
    expect(s.players[0].sittingOut).toBe(false)
  })

  it('перерыв: таймер стоит, новой раздачи нет; «Продолжить» — срок хода заново', () => {
    let s = play(timed(), [start('h'), { from: 'h', msg: { type: 'pause', paused: true }, now: 5000 }], rt)
    expect(s.paused).toBe(true)
    expect(s.turn).toBeNull()
    expect(tick(s, T + 1)).toBeNull()
    // Идущая раздача доигрывается
    s = play(s, [at(fold('h'), 6000), award('h', [['g']])], rt)
    expect(send(s, 'h', { type: 'start' })).toEqual({ ok: false, error: 'Перерыв — сначала «Продолжить»' })
    expect(send(s, 'g', { type: 'pause', paused: false })).toEqual({ ok: false, error: 'Это может только ведущий' })
    s = play(s, [{ from: 'h', msg: { type: 'pause', paused: false }, now: 60_000 }, at(start('h'), 61_000)], rt)
    expect(s.paused).toBe(false)
    expect(s.turn).toEqual({ hand: 2, move: 0, deadline: 61_000 + T })
    // Перерыв посреди хода и «Продолжить» — новый срок от «Продолжить»
    s = play(s, [{ from: 'h', msg: { type: 'pause', paused: true }, now: 62_000 }, { from: 'h', msg: { type: 'pause', paused: false }, now: 90_000 }], rt)
    expect(s.turn?.deadline).toBe(90_000 + T)
  })
})

describe.each(MODES)('следующая раздача сама (%s)', (_, rt) => {
  const tick = (s: TableState, now: number, deck?: Card[]) => {
    const r = onTime(rt ? roundtrip(s) : s, now, deck)
    return r && rt ? roundtrip(r) : r
  }
  const fast = AUTO_START_MS.fast

  it('после раздачи банков — через паузу, без ведущего; живые карты ждут его отметки', () => {
    let s = play(newTable(['h', 'g'], { autoStart: 'fast' }), [start('h'), at(fold('h'), 1000)], rt)
    expect(s.nextHandAt).toBeNull() // торги закрыты, банк не отдан
    s = play(s, [award('h', [['g']], 2000)], rt)
    expect(s.nextHandAt).toBe(2000 + fast)
    expect(nextDeadline(s)).toBe(2000 + fast)
    expect(tick(s, 2000 + fast - 1)).toBeNull()
    const next = tick(s, 2000 + fast)!
    expect(next.hand?.number).toBe(2)
    expect(next.nextHandAt).toBeNull()
    expect(tick(next, 2000 + fast)).toBeNull() // повтор будильника
  })

  it('карты на телефонах: банк отдан сам — раздача сама сдаёт карты из колоды сервера', () => {
    const deck = stackedDeck([['As', 'Ah'], ['2c', '7d']])
    let s = play(newTable(['h', 'g'], { autoStart: 'medium', cards: 'phones' }), [{ ...start('h', deck) }, at(fold('h'), 1000)], rt)
    expect(s.hand).toBeNull()
    expect(s.nextHandAt).toBe(1000 + AUTO_START_MS.medium)
    s = tick(s, 1000 + AUTO_START_MS.medium, stackedDeck([['Kd', 'Kc'], ['3c', '8d']]))!
    // Кнопка перешла к g — первым сдаётся h
    expect(s.hand?.cards?.hole).toEqual({ h: ['Kd', 'Kc'], g: ['3c', '8d'] })
  })

  it('меньше двоих с фишками или перерыв — не начинается; выкл — как раньше', () => {
    let s = play(newTable(['h', 'g'], { autoStart: 'slow' }), [start('h'), fold('h'), award('h', [['g']], 0)], rt)
    const out = play(s, [{ from: 'g', msg: { type: 'sitOut', sittingOut: true } }], rt)
    expect(out.nextHandAt).toBeNull() // играть некому — отсчёт снят
    expect(tick(out, AUTO_START_MS.slow)).toBeNull()
    s = play(s, [{ from: 'h', msg: { type: 'pause', paused: true } }], rt)
    expect(s.nextHandAt).toBeNull()
    expect(tick(s, AUTO_START_MS.slow)).toBeNull()
    // «Продолжить» между раздачами — снова через паузу
    s = play(s, [{ from: 'h', msg: { type: 'pause', paused: false }, now: 50_000 }], rt)
    expect(s.nextHandAt).toBe(50_000 + AUTO_START_MS.slow)
    const off = play(newTable(['h', 'g']), [start('h'), fold('h'), award('h', [['g']])], rt)
    expect(off.nextHandAt).toBeNull()
  })

  // Хедз-ап: оба олл-ин, банк — h; у g ноль, с фишками один — отсчёта нет
  const busted = (settings = {}, extra: string[] = []) => {
    const s = play(newTable(['h', 'g', ...extra], { autoStart: 'fast', ...settings }), [start('h'), allin('h'), allin('g'), award('h', [['h']])], rt)
    expect(s.players.find((p) => p.id === 'g')?.chips).toBe(0)
    expect(s.nextHandAt).toBeNull()
    return s
  }

  it('снова двое с фишками: докуп между раздачами — отсчёт, раздача сама', () => {
    let s = busted()
    s = play(s, [{ from: 'g', msg: { type: 'rebuy', amount: 500 }, now: 4000 }], rt)
    expect(s.nextHandAt).toBeNull() // запрос ещё ждёт ведущего
    s = play(s, [{ from: 'h', msg: { type: 'rebuyAnswer', playerId: 'g', approve: true }, now: 5000 }], rt)
    expect(s.nextHandAt).toBe(5000 + fast)
    expect(tick(s, 5000 + fast)!.hand?.number).toBe(2)
  })

  it('снова двое: стек с нуля, новый игрок, возврат в раздачи — отсчёт', () => {
    const set = play(busted(), [{ from: 'h', msg: { type: 'setStack', playerId: 'g', chips: 300 }, now: 4000 }], rt)
    expect(set.nextHandAt).toBe(4000 + fast)
    const sat = play(busted(), [sit('n', 'N', 4000)], rt)
    expect(sat.nextHandAt).toBe(4000 + fast)
    let s = play(newTable(['h', 'g'], { autoStart: 'fast' }), [start('h'), fold('h'), award('h', [['g']])], rt)
    s = play(s, [{ from: 'g', msg: { type: 'sitOut', sittingOut: true }, now: 1000 }], rt)
    expect(s.nextHandAt).toBeNull()
    s = play(s, [{ from: 'g', msg: { type: 'sitOut', sittingOut: false }, now: 2000 }], rt)
    expect(s.nextHandAt).toBe(2000 + fast)
    // Уже взведённый отсчёт другие перемены не сдвигают
    s = play(s, [sit('n', 'N', 2500)], rt)
    expect(s.nextHandAt).toBe(2000 + fast)
  })

  it('«сама» выключена — докуп ничего не взводит; идущая раздача не трогается', () => {
    let s = busted({ autoStart: 'off' })
    s = play(s, [{ from: 'h', msg: { type: 'setStack', playerId: 'g', chips: 300 }, now: 4000 }], rt)
    expect(s.nextHandAt).toBeNull()
    // Втроём: g выбыл, h и x играют раздачу; докуп g во время неё — в стек после, отсчёта нет
    s = play(newTable(['h', 'g', 'x'], { autoStart: 'fast' }, { g: 10 }), [start('h'), allin('h'), allin('g'), fold('x'), award('h', [['h']])], rt)
    expect(s.players.find((p) => p.id === 'g')?.chips).toBe(0)
    s = play(s, [{ from: 'h', msg: { type: 'start' }, now: 1000 }, { from: 'g', msg: { type: 'rebuy', amount: 500 } }], rt)
    s = play(s, [{ from: 'h', msg: { type: 'rebuyAnswer', playerId: 'g', approve: true }, now: 2000 }], rt)
    expect(s.hand?.number).toBe(2)
    expect(s.nextHandAt).toBeNull()
    expect(s.approvedRebuys).toHaveLength(1)
  })

  it('ручной старт раньше срока — срок снят', () => {
    let s = play(newTable(['h', 'g'], { autoStart: 'fast' }), [start('h'), fold('h'), award('h', [['g']], 0)], rt)
    s = play(s, [at(start('h'), 1000)], rt)
    expect(s.nextHandAt).toBeNull()
    expect(tick(s, fast)).toBeNull()
  })
})

describe('настройки стола между раздачами', () => {
  it('ведущий меняет время на ход и раздачу «сама»; действует со следующей раздачи', () => {
    let s = newTable(['h', 'g'])
    let r = send(s, 'h', { type: 'tableSettings', turnSeconds: 45, autoStart: 'fast' })
    expect(r.ok).toBe(true)
    s = r.ok ? r.state : s
    expect(s.settings).toMatchObject({ turnSeconds: 45, autoStart: 'fast' })
    expect(s.nextHandAt).toBeNull() // раздач ещё не было — первую начинает ведущий
    s = play(s, [start('h')], false)
    expect(s.turn?.deadline).toBe(45_000)
    expect(send(s, 'h', { type: 'tableSettings', turnSeconds: null })).toEqual({
      ok: false,
      error: 'Настройки стола меняются между раздачами',
    })
    s = play(s, [fold('h'), award('h', [['g']], 100)], false)
    r = send(s, 'h', { type: 'tableSettings', autoStart: 'off' }, 200)
    expect(r.ok && r.state.nextHandAt).toBeNull()
    r = send(s, 'h', { type: 'tableSettings', autoStart: 'slow' }, 200)
    expect(r.ok && r.state.nextHandAt).toBe(200 + AUTO_START_MS.slow)
  })

  it('своё время — от 10 до 300 секунд, целое; только ведущий', () => {
    const s = newTable(['h', 'g'])
    const error = 'Время на ход — от 10 до 300 секунд или без таймера'
    for (const turnSeconds of [9, 301, 12.5]) expect(send(s, 'h', { type: 'tableSettings', turnSeconds })).toEqual({ ok: false, error })
    for (const turnSeconds of [10, 300, null]) expect(send(s, 'h', { type: 'tableSettings', turnSeconds }).ok).toBe(true)
    expect(send(s, 'h', { type: 'tableSettings', autoStart: 'toString' as 'fast' }).ok).toBe(false)
    expect(send(s, 'g', { type: 'tableSettings', turnSeconds: 30 })).toEqual({ ok: false, error: 'Это может только ведущий' })
  })

  it('при создании: кривое время на ход — стола нет', () => {
    expect(() => newTable(['h'], { turnSeconds: 5 })).toThrow('Время на ход')
  })

  it('стол, начатый до таймера (полей нет), — таймера и раздачи «сама» нет', () => {
    const old = newTable(['h', 'g']) as TableState & Record<string, unknown>
    for (const key of ['turn', 'paused', 'nextHandAt', 'timeouts']) delete old[key]
    delete old.settings.turnSeconds
    delete old.settings.autoStart
    const s = play(old, [start('h'), fold('h'), award('h', [['g']])], true)
    expect(s.turn).toBeNull()
    expect(s.nextHandAt).toBeNull()
    expect(onTime(s, 10 * T)).toBeNull()
  })
})
