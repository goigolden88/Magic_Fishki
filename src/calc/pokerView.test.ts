import { describe, expect, it } from 'vitest'
import { allin, award, call, fold, newTable, play, raise, start } from '../poker/testing'
import { HOST_TAKEOVER_MS } from '../poker/table'
import { defaultWinners, finalStacks, lastHandWins, tableView, toggleWinner, winnersReady } from './pokerView'

const three = (stacks: Record<string, number> = {}) => newTable(['p0', 'p1', 'p2'], {}, stacks)

describe('экран стола', () => {
  it('префлоп: кнопка, блайнды, банк, чей ход; кнопки хода — у того, чей ход', () => {
    const s = play(three(), [start('p0')], false)
    const v = tableView(s, 'p0', 0)
    expect(v.seats.map((x) => [x.name, x.chips, x.bet, x.button, x.blind, x.toAct])).toEqual([
      ['P0', 1000, 0, true, null, true],
      ['P1', 995, 5, false, 'МБ', false],
      ['P2', 990, 10, false, 'ББ', false],
    ])
    expect([v.stageLabel, v.handNumber, v.pot, v.toActName]).toEqual(['Префлоп', 1, 15, 'P0'])
    expect(v.pots).toEqual([])
    expect(v.actions).toEqual({
      myTurn: true,
      check: false,
      call: 10,
      raise: {
        label: 'Рейз',
        min: 20,
        max: 1000,
        quick: [
          { label: 'Мин', to: 20 },
          { label: '½ банка', to: 22 },
          { label: 'Банк', to: 35 },
        ],
      },
      allIn: 1000,
    })
    // Не мой ход — те же кнопки, неактивны
    expect(tableView(s, 'p1', 0).actions).toMatchObject({ myTurn: false, check: false, call: 5 })
    expect(v.canStart).toBe(false)
  })

  it('хедз-ап: кнопка ставит малый блайнд; на новой улице — «Ставка» и «Чек»', () => {
    const s = play(newTable(['p0', 'p1']), [start('p0'), call('p0')], false)
    expect(tableView(s, 'p0', 0).seats.map((x) => [x.button, x.blind])).toEqual([
      [true, 'МБ'],
      [false, 'ББ'],
    ])
    const flop = play(s, [{ from: 'p1', msg: { type: 'act', action: { type: 'check' } } }], false)
    const v = tableView(flop, 'p1', 0)
    expect(v.stageLabel).toBe('Флоп')
    expect(v.actions).toMatchObject({ myTurn: true, check: true, call: 0, raise: { label: 'Ставка', min: 10 } })
  })

  it('между раздачами: начать может только ведущий и когда двое с фишками', () => {
    const s = three()
    expect(tableView(s, 'p0', 0)).toMatchObject({ canStart: true, isHost: true, stage: null, actions: null, hostName: 'P0' })
    expect(tableView(s, 'p1', 0)).toMatchObject({ canStart: false, isHost: false })
    expect(tableView(newTable(['p0']), 'p0', 0).canStart).toBe(false)
    const out = play(s, [{ from: 'p1', msg: { type: 'sitOut', sittingOut: true } }, { from: 'p2', msg: { type: 'sitOut', sittingOut: true } }], false)
    expect(tableView(out, 'p0', 0).canStart).toBe(false)
  })

  it('побочный банк виден во время торгов, когда кто-то олл-ин; неуравненная ставка — не банк', () => {
    const s = play(three({ p1: 100 }), [start('p0'), call('p0'), allin('p1'), call('p2'), call('p0')], false)
    expect(tableView(s, 'p0', 0)).toMatchObject({ stageLabel: 'Флоп', pot: 300, pots: [] })
    // Флоп: первым ходит P2 (P1 олл-ин)
    const bet = play(s, [raise('p2', 200)], false)
    expect(tableView(bet, 'p0', 0)).toMatchObject({ pot: 500, pots: [] })
    const turn = play(bet, [call('p0')], false)
    expect(tableView(turn, 'p0', 0).pots).toEqual([
      {
        label: 'Основной банк',
        amount: 300,
        eligible: [
          { id: 'p0', name: 'P0' },
          { id: 'p1', name: 'P1' },
          { id: 'p2', name: 'P2' },
        ],
      },
      {
        label: 'Побочный банк',
        amount: 400,
        eligible: [
          { id: 'p0', name: 'P0' },
          { id: 'p2', name: 'P2' },
        ],
      },
    ])
    expect(tableView(turn, 'p1', 0).actions).toBeNull() // олл-ин — ходить нечем
  })

  it('неполный олл-ин не открывает торги ходившему: только колл или пас', () => {
    const s = play(three({ p1: 150 }), [start('p0'), raise('p0', 100), allin('p1'), call('p2')], false)
    expect(tableView(s, 'p0', 0).actions).toEqual({ myTurn: true, check: false, call: 50, raise: null, allIn: null })
  })

  it('не хватает на минимальный рейз — только олл-ин', () => {
    const s = play(three({ p0: 15 }), [start('p0')], false)
    expect(tableView(s, 'p0', 0).actions).toMatchObject({ call: 10, raise: null, allIn: 15 })
  })

  it('торги закрыты: банк с одним претендентом отмечен сам; «Раздать» — когда отмечены все', () => {
    const s = play(three(), [start('p0'), fold('p0'), fold('p1')], false)
    const v = tableView(s, 'p0', 0)
    expect([v.stage, v.stageLabel, v.actions, v.toActName]).toEqual(['showdown', 'Торги закрыты', null, null])
    expect(defaultWinners(s)).toEqual([['p2']])
    expect(winnersReady(s, defaultWinners(s))).toBe(true)

    const many = play(three({ p1: 100 }), [start('p0'), call('p0'), allin('p1'), call('p2'), call('p0')], false)
    const down = play(many, [raise('p2', 200), call('p0'), raise('p2', 700), call('p0')], false)
    expect(down.hand?.stage).toBe('showdown')
    let winners = defaultWinners(down)
    expect(winners).toEqual([[], []])
    expect(winnersReady(down, winners)).toBe(false)
    winners = toggleWinner(winners, 0, 'p1')
    winners = toggleWinner(winners, 1, 'p0')
    winners = toggleWinner(winners, 1, 'p2')
    expect(winners).toEqual([['p1'], ['p0', 'p2']])
    expect(winnersReady(down, winners)).toBe(true)
    expect(toggleWinner(winners, 1, 'p0')).toEqual([['p1'], ['p2']])
  })

  it('«Взять ведение» — у остальных, когда ведущий вне сети дольше минуты', () => {
    const s = play(three(), [{ from: 'p0', online: false, now: 1000 }], false)
    expect(tableView(s, 'p1', 1000 + HOST_TAKEOVER_MS).canTakeHost).toBe(false)
    expect(tableView(s, 'p1', 1001 + HOST_TAKEOVER_MS).canTakeHost).toBe(true)
    expect(tableView(s, 'p0', 1001 + HOST_TAKEOVER_MS).canTakeHost).toBe(false)
    expect(tableView(s, 'p1', 1001 + HOST_TAKEOVER_MS).seats[0]).toMatchObject({ online: false, isHost: true })
  })

  it('запрос докупа: ведущий видит, кто и сколько; игрок — что ждёт', () => {
    const s = play(three(), [{ from: 'p1', msg: { type: 'rebuy', amount: 500 } }], false)
    expect(tableView(s, 'p0', 0).rebuyRequests).toEqual([{ playerId: 'p1', name: 'P1', amount: 500 }])
    expect(tableView(s, 'p1', 0).myRebuy).toBe(500)
    expect(tableView(s, 'p2', 0).myRebuy).toBeNull()
  })

  it('итог прошлой раздачи и стеки на конец игры', () => {
    const s = play(three(), [start('p0'), fold('p0'), fold('p1'), award('p0', [['p2']])], false)
    // Банк 10: неуравненные 5 из большого блайнда вернулись P2 до банка
    expect(lastHandWins(s)).toEqual([{ name: 'P2', amount: 10 }])
    expect(finalStacks(s)).toEqual([
      { name: 'P0', chips: 1000, buyIn: 1000, diff: 0 },
      { name: 'P1', chips: 995, buyIn: 1000, diff: -5 },
      { name: 'P2', chips: 1005, buyIn: 1000, diff: 5 },
    ])
    // Между раздачами кнопка — у места прошлой раздачи
    expect(tableView(s, 'p0', 0).seats.map((x) => x.button)).toEqual([true, false, false])
  })
})
