// «Отойти» по правилам румов (#323, Р-118): кэш — «Отойду перед своим BB» и возврат с выбором; турнир — отошедшего
// сдают, блайнды и анте с него, ход за него сразу
import { describe, expect, it } from 'vitest'
import { handMoney } from '../calc/handResult'
import type { HistoryHand } from './history'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { BACK_CHOICE, handle, onTime, returnOwesBB, type Settings, type TableState } from './table'
import { DEFAULT_TOURNAMENT } from './tournament'
import { award, call, check, fold, MODES, newTable, play, raise, start, type Step } from './testing'

const send = (s: TableState, from: string, body: ClientBody, now = 0) => handle(s, from, { v: PROTOCOL_VERSION, ...body }, now)
const out = (from: string, extra: Partial<Extract<ClientBody, { type: 'sitOut' }>> = {}): Step => ({
  from,
  msg: { type: 'sitOut', sittingOut: true, ...extra },
})
const back = (from: string, extra: Partial<Extract<ClientBody, { type: 'sitOut' }>> = {}): Step => ({
  from,
  msg: { type: 'sitOut', sittingOut: false, ...extra },
})
const mark = (from: string, on = true): Step => ({ from, msg: { type: 'sitOutBB', on } })
const player = (s: TableState, id: string) => s.players.find((p) => p.id === id)!
const dealt = (s: TableState) => s.hand!.seats.map((x) => x.id)
// Чей BB в идущей раздаче: хедз-ап — не кнопка, иначе второй после неё
function bbOf(s: TableState): string {
  const h = s.hand!
  const n = h.seats.length
  return h.seats[(h.button + (n === 2 ? 1 : 2)) % n].id
}

// Раздача до конца: ходящие по очереди сбрасывают, банк — оставшемуся (живые карты, отмечает ведущий h)
function finish(s: TableState, rt: boolean): TableState {
  let t = s
  while (t.hand && t.hand.toAct !== -1) t = play(t, [fold(t.hand.seats[t.hand.toAct].id)], rt)
  return t.hand ? play(t, [award('h', t.hand.pots.map((p) => [p.eligible[0]]))], rt) : t
}

describe.each(MODES)('кэш: отойти перед своим BB и вернуться (%s)', (_, rt) => {
  // Места по порядку: h 0, a 1, b 2, c 3. Раздача 1: кнопка h, SB a, BB b; 2: кнопка a, SB b, BB c
  const four = () => newTable(['h', 'a', 'b', 'c'])
  // c отметил до первой раздачи: в первой играет (UTG), перед второй, где BB его, встаёт
  function cOut(): TableState {
    const s = play(four(), [mark('c'), start('h')], rt)
    expect(dealt(s)).toEqual(['h', 'a', 'b', 'c'])
    expect(player(s, 'c').sitOutBB).toBe(true)
    return play(finish(s, rt), [start('h')], rt)
  }

  it('отметка: доигрывает, перед своим BB встаёт сам, BB — следующему по кругу', () => {
    const s = cOut()
    expect(dealt(s)).toEqual(['h', 'a', 'b'])
    expect(bbOf(s)).toBe('h')
    expect(player(s, 'c')).toMatchObject({ sittingOut: true, outAt: 1 })
    expect(player(s, 'c').sitOutBB).toBeUndefined()
  })

  it('отметку можно снять — играет свой BB; уже пропускает — отметки нет', () => {
    const s = play(four(), [mark('c'), start('h')], rt)
    const next = play(finish(play(s, [mark('c', false)], rt), rt), [start('h')], rt)
    expect(dealt(next)).toEqual(['h', 'a', 'b', 'c'])
    expect(bbOf(next)).toBe('c')
    const sat = play(four(), [out('c')], rt)
    expect(send(sat, 'c', { type: 'sitOutBB', on: true })).toEqual({ ok: false, error: 'Вы уже пропускаете раздачи' })
  })

  it('«Пропускать раздачи» — сразу, как раньше: идущую доигрывает, со следующей не сдают', () => {
    const s = play(four(), [start('h'), out('c')], rt)
    expect(dealt(s)).toContain('c')
    expect(dealt(play(finish(s, rt), [start('h')], rt))).toEqual(['h', 'a', 'b'])
  })

  it('вернулся после пропущенной раздачи — без выбора нельзя', () => {
    const s = finish(cOut(), rt)
    expect(returnOwesBB(s, 'c')).toBe(true)
    expect(send(s, 'c', { type: 'sitOut', sittingOut: false })).toEqual({ ok: false, error: BACK_CHOICE })
    // И если пришлёт за себя playerId, не будучи ведущим
    expect(send(s, 'c', { type: 'sitOut', sittingOut: false, playerId: 'c' })).toEqual({ ok: false, error: BACK_CHOICE })
  })

  it('«Поставить BB и играть»: сразу в раздаче, BB вслепую сверх блайндов, без повышения — чек', () => {
    // Раздача 2 без c: кнопка a, BB h; 3 без c: кнопка b, BB a. Вернулся — в 4-й кнопка у него, BB у a
    let s = finish(play(finish(cOut(), rt), [start('h')], rt), rt)
    s = play(s, [back('c', { back: 'post' })], rt)
    expect(player(s, 'c')).toMatchObject({ sittingOut: false, postBB: true })
    s = play(s, [start('h')], rt)
    expect(dealt(s)).toEqual(['h', 'a', 'b', 'c'])
    expect(bbOf(s)).toBe('a')
    const hand = s.hand!
    expect(hand.seats.map((x) => x.bet)).toEqual([5, 10, 0, 10])
    expect(hand.log).toEqual([{ street: 'preflop', playerId: 'c', type: 'post', bet: 10, allIn: false }])
    expect(player(s, 'c').postBB).toBeUndefined()
    s = play(s, [call('b'), check('c'), call('h'), check('a')], rt)
    expect(s.hand?.stage).toBe('flop')
    expect(s.hand?.seats.reduce((sum, x) => sum + x.committed, 0)).toBe(40)
    // Журнал раздачи и деньги по записи — с BB вслепую
    const live = { seats: hand.seats.map((x) => ({ id: x.id, name: x.id, chips: 1000 })), button: hand.button, log: s.hand!.log }
    const h: HistoryHand = { number: 4, pots: [{ amount: 40, winners: ['a'] }], payouts: {}, live }
    const money = handMoney(h, { sb: 5, bb: 10 })
    expect(money?.potAt.preflop).toBe(25)
    expect(money?.committed).toEqual({ h: 10, a: 10, b: 10, c: 10 })
  })

  it('«Поставить BB» на месте SB — ставка круга до BB, малый отдельно не берётся', () => {
    // c вернулся до раздачи 3: кнопка b, SB c, BB h
    let s = finish(cOut(), rt)
    s = play(s, [back('c', { back: 'post' }), start('h')], rt)
    expect(dealt(s)).toEqual(['h', 'a', 'b', 'c'])
    expect(s.hand!.seats.find((x) => x.id === 'c')).toMatchObject({ bet: 10, committed: 10 })
    expect(s.hand!.seats.reduce((sum, x) => sum + x.committed, 0)).toBe(20)
  })

  it('кому BB и так выпал — поставить сверх нечего', () => {
    // d пропускал с первой раздачи (вторая без него: кнопка a, BB c); вернулся к третьей, где BB его, — блайнд
    // обычный, записи 'post' нет
    let s = play(newTable(['h', 'a', 'b', 'c', 'd']), [out('d'), start('h')], rt)
    s = finish(play(finish(s, rt), [start('h')], rt), rt)
    s = play(s, [back('d', { back: 'post' }), start('h')], rt)
    expect(bbOf(s)).toBe('d')
    expect(s.hand!.log).toEqual([])
    expect(s.hand!.seats.find((x) => x.id === 'd')).toMatchObject({ bet: 10, committed: 10 })
  })

  it('«Ждать свой BB»: пропускает SB и кнопку, возвращается сам в раздаче, где BB его', () => {
    let s = finish(cOut(), rt)
    s = play(s, [back('c', { back: 'wait' })], rt)
    expect(player(s, 'c')).toMatchObject({ sittingOut: true, waitBB: true })
    // Раздача 3: с ним кнопка b, SB c — не его BB
    s = play(s, [start('h')], rt)
    expect(dealt(s)).toEqual(['h', 'a', 'b'])
    // Раздача 4: с ним кнопка — у него же
    s = play(finish(s, rt), [start('h')], rt)
    expect(dealt(s)).toEqual(['h', 'a', 'b'])
    // Раздача 5: BB — его
    s = play(finish(s, rt), [start('h')], rt)
    expect(dealt(s)).toEqual(['h', 'a', 'b', 'c'])
    expect(bbOf(s)).toBe('c')
    expect(s.hand!.log).toEqual([])
    expect(player(s, 'c').sittingOut).toBe(false)
    expect(player(s, 'c').waitBB).toBeUndefined()
    // Ждёт, а передумал — «Поставить BB»
    const w = play(finish(cOut(), rt), [back('c', { back: 'wait' }), back('c', { back: 'post' })], rt)
    expect(player(w, 'c')).toMatchObject({ sittingOut: false, postBB: true })
  })

  it('без долга: не пропустил ни одной раздачи; за столом меньше двух играющих; ведущий за игрока', () => {
    // Встал и вернулся между раздачами
    const none = play(four(), [start('h')], rt)
    const t = play(finish(none, rt), [out('c'), back('c')], rt)
    expect(player(t, 'c').sittingOut).toBe(false)
    expect(player(t, 'c').outAt).toBeUndefined()
    // Втроём: b пропускал раздачу, a тоже встал — играет один h
    let s = play(newTable(['h', 'a', 'b']), [out('b'), start('h')], rt)
    s = play(finish(s, rt), [out('a')], rt)
    expect(returnOwesBB(s, 'b')).toBe(false)
    expect(player(play(s, [back('b')], rt), 'b').sittingOut).toBe(false)
    // Ведущий из управления столом (и сам за себя — стол с ботами, один телефон) — сразу
    const owes = finish(cOut(), rt)
    expect(player(play(owes, [back('h', { playerId: 'c' })], rt), 'c')).toMatchObject({ sittingOut: false })
    const host = play(finish(play(four(), [out('h'), start('h')], rt), rt), [back('h', { playerId: 'h' })], rt)
    expect(player(host, 'h').sittingOut).toBe(false)
    expect(player(host, 'h').postBB).toBeUndefined()
  })

  it('отметил, а без него играть некому — раздачи нет, стол прежний', () => {
    // Хедз-ап: кнопка h, BB a — a встал бы, и играть некому
    const s = play(newTable(['h', 'a']), [mark('a')], rt)
    expect(send(s, 'h', { type: 'start' })).toEqual({ ok: false, error: 'Нужно хотя бы двое с фишками' })
    expect(player(s, 'a')).toMatchObject({ sittingOut: false, sitOutBB: true })
  })
})

// Турнир: блайнды 10/20, анте 10 % ББ — 2, стек 1000
function cup(s: Partial<Settings> = {}): Partial<Settings> {
  return {
    sb: 10,
    bb: 20,
    startingStack: 1000,
    format: 'tournament',
    tournament: { ...DEFAULT_TOURNAMENT, buyIn: 500, levelMinutes: 10, antePct: 10 },
    ...s,
  }
}

describe.each(MODES)('турнир: отошедший в раздачах (%s)', (_, rt) => {
  // Места: h 0, g 1, k 2. Раздача 1: кнопка h (ходит первым), SB g, BB k
  const three = (s: Partial<Settings> = {}) => newTable(['h', 'g', 'k'], cup(s))

  it('блайнды и анте — и с отошедшего; без повышения — чек за него сразу', () => {
    let s = play(three(), [out('k'), start('h')], rt)
    expect(dealt(s)).toEqual(['h', 'g', 'k'])
    expect(s.hand!.seats.find((x) => x.id === 'k')).toMatchObject({ committed: 22, bet: 20 })
    s = play(s, [call('h'), call('g')], rt)
    expect(s.hand!.log.at(-1)).toEqual({ street: 'preflop', playerId: 'k', type: 'check', bet: 20, allIn: false })
    expect(s.hand!.stage).toBe('flop')
    s = play(s, [check('g')], rt)
    expect(s.hand!.log.at(-1)).toMatchObject({ street: 'flop', playerId: 'k', type: 'check' })
    expect(s.hand!.seats[s.hand!.toAct].id).toBe('h')
  })

  it('повысили — сброс за него сразу; отошли двое подряд — оба цепочкой', () => {
    const one = play(three(), [out('k'), start('h'), raise('h', 60), fold('g')], rt)
    expect(one.hand!.seats.find((x) => x.id === 'k')!.folded).toBe(true)
    expect(one.hand!.toAct).toBe(-1)
    const two = play(three(), [out('g'), out('k'), start('h'), raise('h', 60)], rt)
    expect(two.hand!.seats.filter((x) => x.folded).map((x) => x.id)).toEqual(['g', 'k'])
    expect(two.hand!.stage).toBe('showdown')
  })

  it('отошёл в свой ход — ход за него сразу, без таймера', () => {
    const s = play(three({ turnSeconds: 30 }), [start('h'), call('h'), call('g'), out('k')], rt)
    expect(s.hand!.log.at(-1)).toEqual({ street: 'preflop', playerId: 'k', type: 'check', bet: 20, allIn: false })
    expect(s.hand!.stage).toBe('flop')
    expect(s.turn?.move).toBe(s.hand!.log.length)
  })

  it('стек тает: отошедший платит раздачу за раздачей', () => {
    let s = finish(play(three(), [out('k'), start('h')], rt), rt)
    const before = player(s, 'k').chips
    // Раздача 2: кнопка g (ходит первым), SB k, BB h — g сбросил, за k сброс сразу: минус анте и малый
    s = play(s, [start('h')], rt)
    expect(dealt(s)).toContain('k')
    s = play(s, [fold('g')], rt)
    expect(s.hand!.seats.find((x) => x.id === 'k')!.folded).toBe(true)
    s = finish(s, rt)
    expect(player(s, 'k').chips).toBe(before - 12)
  })

  it('истечения подряд — отошёл и дальше сбрасывается сам, но в раздачах', () => {
    const T = 30_000
    const tick = (s: TableState, now: number) => {
      const r = onTime(rt ? (JSON.parse(JSON.stringify(s)) as TableState) : s, now)
      return r && rt ? (JSON.parse(JSON.stringify(r)) as TableState) : r
    }
    let s = play(three({ turnSeconds: 30 }), [start('h'), { ...call('h'), now: 1000 }, { ...call('g'), now: 2000 }], rt)
    s = tick(s, 2000 + T)! // k — чек по времени
    s = play(s, [{ ...check('g'), now: 33_000 }], rt)
    s = tick(s, 33_000 + T)! // второй раз — отошёл
    expect(player(s, 'k').sittingOut).toBe(true)
    expect(s.hand!.seats[s.hand!.toAct].id).toBe('h')
    s = play(s, [{ ...check('h'), now: 64_000 }, { ...check('g'), now: 65_000 }], rt)
    expect(s.hand!.log.at(-1)).toMatchObject({ street: 'turn', playerId: 'k', type: 'check' })
    expect(s.hand!.log.at(-1)?.timeout).toBeUndefined()
    s = play(finish(s, rt), [start('h')], rt)
    expect(dealt(s)).toEqual(['h', 'g', 'k'])
  })

  it('раздача «сама» — пока не отошли все с фишками; вернулся — сразу, без долга', () => {
    let s = play(three({ autoStart: 'fast' }), [start('h'), out('h'), out('g')], rt)
    // h и g сбросили сами — банк k; живые карты: ведущий отмечает
    expect(s.hand!.toAct).toBe(-1)
    s = play(s, [award('h', [['k']])], rt)
    expect(s.nextHandAt).toBe(3000)
    s = play(s, [out('k')], rt)
    expect(s.nextHandAt).toBeNull()
    expect(returnOwesBB(s, 'k')).toBe(false)
    s = play(s, [back('k')], rt)
    expect(player(s, 'k').sittingOut).toBe(false)
    expect(s.nextHandAt).toBe(3000)
  })

  it('«Отойду перед своим BB» в турнире нет', () => {
    expect(send(three(), 'k', { type: 'sitOutBB', on: true })).toEqual({
      ok: false,
      error: 'В турнире — «Отойти»: блайнды идут, карты сбрасываются сами',
    })
  })
})
