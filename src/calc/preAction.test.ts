import { describe, expect, it } from 'vitest'
import { bet, call, fold, newTable, play, raise, start } from '../poker/testing'
import { activePreAction, preActionMove, preActionNow, showPreActions, streetKey, togglePreAction, type PreActionMark } from './preAction'
import { actionsView } from './pokerView'
import { seededRandom, type Random } from './bot'
import { botStep, botTableView, botToAct, dealBotHand, myMove, startBotTable, type BotStep, type BotTable } from './botTable'

// Три игрока, блайнды 5/10: префлоп первым ходит p0 (кнопка), затем p1 (SB), p2 (BB)
const three = (stacks: Record<string, number> = {}) => newTable(['p0', 'p1', 'p2'], {}, stacks)

describe('ход заранее', () => {
  it('чек можно — оба флажка дают чек', () => {
    // Префлоп: все уравняли, большой блайнд может чекнуть
    const s = play(three(), [start('p0'), call('p0'), call('p1')], false)
    const a = actionsView(s, 'p2')
    expect(a).toMatchObject({ myTurn: true, check: true })
    expect(preActionMove('checkFold', a)).toEqual({ type: 'check' })
    expect(preActionMove('callAny', a)).toEqual({ type: 'check' })
  })

  it('только колл: «Чек/пас» — пас, «Колл любой» — колл', () => {
    const s = play(three(), [start('p0'), raise('p0', 40)], false)
    const a = actionsView(s, 'p1')
    expect(a).toMatchObject({ myTurn: true, check: false, call: 35 })
    expect(preActionMove('checkFold', a)).toEqual({ type: 'fold' })
    expect(preActionMove('callAny', a)).toEqual({ type: 'call' })
  })

  it('колл больше стека — «Колл любой» шлёт колл, сервер ставит остаток: олл-ин', () => {
    const s = play(three({ p1: 100 }), [start('p0'), raise('p0', 300)], false)
    const a = actionsView(s, 'p1')
    expect(a).toMatchObject({ myTurn: true, check: false, call: 95 })
    const move = preActionMove('callAny', a)
    expect(move).toEqual({ type: 'call' })
    const after = play(s, [bet('p1', move!)], false)
    expect(after.hand?.seats.find((x) => x.id === 'p1')).toMatchObject({ chips: 0, allIn: true, bet: 100 })
  })

  it('не мой ход — ничего не шлёт, флажки видны', () => {
    const s = play(three(), [start('p0')], false)
    const a = actionsView(s, 'p1')
    expect(a?.myTurn).toBe(false)
    expect(showPreActions(a)).toBe(true)
    expect(preActionMove('checkFold', a)).toBeNull()
    expect(preActionMove('callAny', a)).toBeNull()
    expect(showPreActions(actionsView(s, 'p0'))).toBe(false) // мой ход — обычные кнопки
  })

  it('сбросил — флажков нет и ход не шлётся', () => {
    const s = play(three(), [start('p0'), fold('p0')], false)
    const a = actionsView(s, 'p0')
    expect(a).toBeNull()
    expect(showPreActions(a)).toBe(false)
    expect(preActionMove('callAny', a)).toBeNull()
  })

  it('олл-ин и между раздачами — флажков нет', () => {
    const allIn = play(three(), [start('p0'), bet('p0', { type: 'allin' })], false)
    expect(showPreActions(actionsView(allIn, 'p0'))).toBe(false)
    expect(showPreActions(actionsView(three(), 'p0'))).toBe(false)
  })

  it('без флажка — ничего не шлёт', () => {
    const s = play(three(), [start('p0')], false)
    expect(preActionMove(null, actionsView(s, 'p0'))).toBeNull()
  })

  it('флажок снимается тапом, отмечен только один', () => {
    expect(togglePreAction(null, 'checkFold')).toBe('checkFold')
    expect(togglePreAction('checkFold', 'checkFold')).toBeNull()
    expect(togglePreAction('checkFold', 'callAny')).toBe('callAny')
  })

  it('на новой улице и между раздачами флажок снят', () => {
    const mark = { kind: 'callAny' as const, street: streetKey(3, 'flop') ?? '' }
    expect(activePreAction(mark, streetKey(3, 'flop'))).toBe('callAny')
    expect(activePreAction(mark, streetKey(3, 'turn'))).toBeNull()
    expect(activePreAction(mark, streetKey(4, 'flop'))).toBeNull()
    expect(activePreAction(mark, streetKey(3, null))).toBeNull()
    expect(activePreAction(null, streetKey(3, 'flop'))).toBeNull()
  })
})

// За столом с ботами (#299): флажок отмечен, пока ходят боты; дошла очередь — ход по нему делается сам
describe('ход заранее за столом с ботами', () => {
  const ok = (r: BotStep): BotTable => {
    if (!r.ok) throw new Error(r.error)
    return r.bots
  }
  const bytesOf = (random: Random) => (b: Uint8Array) => {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(random() * 256)
    return b
  }
  let n = 0
  const makeId = () => `id${++n}`
  const form = { bots: 3, level: 'amateur' as const, open: false, sb: 5, bb: 10, startingStack: 1000 }
  // Боты ходят, пока не моя очередь
  const botsMove = (bt: BotTable, random: Random) => {
    while (botToAct(bt)) bt = ok(botStep(bt, 0, random))
    return bt
  }

  it('флажок срабатывает своим ходом и снимается на новой улице', () => {
    const random = seededRandom(3)
    let bt = ok(dealBotHand(ok(startBotTable(form, 0, makeId, random)), 0, bytesOf(random)))
    // Первым до флопа ходит бот, я в раздаче — флажки видны, ход по флажку пока не делается
    expect(botToAct(bt)).not.toBeNull()
    const before = botTableView(bt, 0)
    expect(showPreActions(before.actions)).toBe(true)
    const mark: PreActionMark = { kind: 'callAny', street: streetKey(before.handNumber, before.stage) ?? '' }
    expect(preActionNow(mark, before)).toMatchObject({ pre: 'callAny', move: null })

    // Боты сходили — моя очередь на той же улице: «Колл любой» — колл (или чек, если уравнивать нечего)
    bt = botsMove(bt, random)
    const mine = botTableView(bt, 0)
    expect(mine.stage).toBe(before.stage)
    expect(mine.actions?.myTurn).toBe(true)
    const { move } = preActionNow(mark, mine)
    expect(move).toEqual(mine.actions?.check ? { type: 'check' } : { type: 'call' })
    bt = ok(myMove(bt, move!, 0))
    expect(bt.table.hand?.log.at(-1)).toMatchObject({ playerId: bt.meId, type: move!.type })
    expect(botToAct(bt)).not.toBeNull() // ход сделан — очередь ушла к ботам

    // Новая улица — тот же флажок не действует: ни отметки, ни хода
    bt = botsMove(bt, random)
    const next = botTableView(bt, 0)
    expect([before.stage, next.stage, next.handNumber]).toEqual(['preflop', 'flop', before.handNumber])
    expect(showPreActions(next.actions) || next.actions?.myTurn).toBe(true) // я ещё в раздаче
    expect(preActionNow(mark, next)).toMatchObject({ pre: null, move: null })
  })
})
