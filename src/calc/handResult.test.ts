import { describe, expect, it } from 'vitest'
import type { Card } from '../poker/cards'
import { finishedHand, keepHand, type HistoryHand } from '../poker/history'
import type { Settings, TableState } from '../poker/table'
import { allin, award, call, check, fold, newTable, play, raise, stackedDeck, start, type Step } from '../poker/testing'
import {
  botsEvening,
  eveningBalanceText,
  eveningResult,
  eveningSummaries,
  localEvening,
  myEveningNet,
  roomEvening,
  savedHands,
} from './evenings'
import { handMoney, handNet, handPosition, handPositions } from './handResult'
import { historyHandView, historyList } from './pokerView'

const PHONES: Partial<Settings> = { cards: 'phones' }

// Раздача по шагам, как у комнаты: после каждого сообщения — запись истории; итог — последняя оконченная
function playHand(s: TableState, steps: Step[]): { after: TableState; hand: HistoryHand } {
  let history: HistoryHand[] = []
  for (const step of steps) {
    const next = play(s, [step], false)
    history = keepHand(history, finishedHand(s, next))
    s = next
  }
  const hand = history.at(-1)
  if (!hand) throw new Error('Раздача не окончилась')
  return { after: s, hand }
}

const chipsOf = (t: TableState) => Object.fromEntries(t.players.map((p) => [p.id, p.chips]))

// Итог по записи — ровно то, как изменились стеки за раздачу
function expectNets(before: TableState, after: TableState, hand: HistoryHand, nets: Record<string, number>) {
  const was = chipsOf(before)
  const now = chipsOf(after)
  for (const [id, net] of Object.entries(nets)) {
    expect(now[id] - was[id], `стек ${id}`).toBe(net)
    expect(handNet(hand, id), `итог ${id}`).toBe(net)
  }
}

// Кнопка — p0; сдача с первого после кнопки: hole — p1, p2, p0
const deckOf = (hole: Card[][], board: Card[]) => stackedDeck(hole, board)
const BOARD: Card[] = ['3c', '8d', '9h', 'Js', '4s']
const ANY = stackedDeck([]) // колода по порядку — карты не важны

describe('итог игрока за раздачу (#239)', () => {
  it('пас до флопа: сбросил с кнопки — 0, малый блайнд — минус блайнд, большой — плюс малый (вернулась непокрытая ставка)', () => {
    const before = newTable(['p0', 'p1', 'p2'], PHONES)
    const { after, hand } = playHand(before, [start('p0', ANY), fold('p0'), fold('p1')])
    expectNets(before, after, hand, { p0: 0, p1: -5, p2: 5 })
  })

  it('банк без вскрытия: рейз, колл, ставка на флопе и пас; банк на начало улиц', () => {
    const before = newTable(['p0', 'p1', 'p2'], PHONES)
    const steps = [start('p0', ANY), raise('p0', 30), call('p1'), fold('p2'), check('p1'), raise('p0', 50), fold('p1')]
    const { after, hand } = playHand(before, steps)
    expectNets(before, after, hand, { p0: 40, p1: -30, p2: -10 })
    expect(handMoney(hand)?.potAt).toMatchObject({ preflop: 15, flop: 70 })
  })

  it('сплит: стол сильнее рук — банк пополам, итог 0', () => {
    const before = newTable(['p0', 'p1'], PHONES)
    const deck = deckOf([['2c', '3d'], ['4c', '5d']], ['As', 'Ks', 'Qs', 'Js', 'Ts'])
    const steps = [start('p0', deck), call('p0'), check('p1')]
    for (let k = 0; k < 3; k++) steps.push(check('p1'), check('p0'))
    const { after, hand } = playHand(before, steps)
    expect(hand.pots).toEqual([{ amount: 20, winners: ['p0', 'p1'] }])
    expectNets(before, after, hand, { p0: 0, p1: 0 })
  })

  it('побочный банк: короткий берёт основной, побочный — другому', () => {
    const before = newTable(['p0', 'p1', 'p2'], PHONES, { p1: 200 })
    const deck = deckOf([['As', 'Ah'], ['7c', '2d'], ['Ks', 'Kh']], BOARD)
    const { after, hand } = playHand(before, [start('p0', deck), allin('p0'), allin('p1'), call('p2')])
    expect(hand.pots.length).toBe(2)
    expectNets(before, after, hand, { p0: 600, p1: 400, p2: -1000 })
  })

  it('вдвоём: кнопка — малый блайнд; позиции «BTN/SB» и «BB»', () => {
    const before = newTable(['p0', 'p1'], PHONES)
    const deck = deckOf([['As', 'Ah'], ['Ks', 'Kh']], BOARD)
    const steps = [start('p0', deck), raise('p0', 30), call('p1')]
    for (let k = 0; k < 3; k++) steps.push(check('p1'), check('p0'))
    const { after, hand } = playHand(before, steps)
    expectNets(before, after, hand, { p0: -30, p1: 30 })
    expect(handPositions(hand)).toEqual(['BTN/SB', 'BB'])
    expect(handPosition(hand, 'p1')).toBe('BB')
  })

  it('олл-ин до флопа: непокрытая часть вернулась — в итоге её нет; банк на флопе — итоговый', () => {
    const before = newTable(['p0', 'p1'], PHONES, { p1: 500 })
    const deck = deckOf([['As', 'Ah'], ['Ks', 'Kh']], BOARD)
    const { after, hand } = playHand(before, [start('p0', deck), allin('p0'), call('p1')])
    expectNets(before, after, hand, { p0: -500, p1: 500 })
    expect(handMoney(hand)?.potAt).toMatchObject({ preflop: 15, flop: 1000, turn: 1000, river: 1000 })
  })

  it('анте — в итоге и в банке префлопа', () => {
    const before = newTable(['p0', 'p1', 'p2'], { ...PHONES, ante: 2 })
    const { after, hand } = playHand(before, [start('p0', ANY), fold('p0'), fold('p1')])
    expectNets(before, after, hand, { p0: -2, p1: -7, p2: 9 })
    expect(handMoney(hand)?.potAt.preflop).toBe(21)
  })

  it('не сел в раздачу — ни позиции, ни итога; живые карты — итог только с блайндами стола', () => {
    const out = play(newTable(['p0', 'p1', 'p2'], PHONES), [{ from: 'p2', msg: { type: 'sitOut', sittingOut: true } }], false)
    const { hand } = playHand(out, [start('p0', ANY), fold('p0')])
    expect(handPosition(hand, 'p2')).toBeNull()
    expect(handNet(hand, 'p2')).toBeNull()
    expect(handPositions(hand)).toEqual(['BTN/SB', 'BB'])

    const live = newTable(['p0', 'p1', 'p2'])
    const steps = [start('p0'), fold('p0'), call('p1'), check('p2')]
    for (let k = 0; k < 3; k++) steps.push(check('p1'), check('p2'))
    const { after, hand: liveHand } = playHand(live, [...steps, award('p0', [['p2']])])
    expect(liveHand.record).toBeUndefined()
    expect(handNet(liveHand, 'p2')).toBeNull()
    expect(handNet(liveHand, 'p2', { sb: 5, bb: 10 })).toBe(chipsOf(after).p2 - chipsOf(live).p2)
    expect(handNet(liveHand, 'p1', { sb: 5, bb: 10 })).toBe(-10)
  })
})

describe('история раздач: моя рука (#239)', () => {
  const before = newTable(['p0', 'p1', 'p2'], PHONES)
  const deck = deckOf([['Qc', 'Jd'], ['7c', '2d'], ['Ks', 'Kh']], BOARD)
  // p1 сбросил на флопе — его карт в записи нет, они есть только у его телефона
  const steps = [start('p0', deck), raise('p0', 30), call('p1'), fold('p2'), check('p1'), raise('p0', 50), fold('p1')]
  const { after, hand } = playHand(before, steps)
  const evening = roomEvening('KQ7MZP', after, 'p1')

  it('строка списка: мои карты и после паса, позиция, итог; без своих карт — без карт', () => {
    const [withCards] = savedHands(evening, [hand], new Map([[1, ['Qc', 'Jd'] as Card[]]]))
    expect(historyList([withCards])[0].mine).toEqual({ cards: ['Qc', 'Jd'], position: 'SB', net: -30, bb: 10 })
    const [old] = savedHands(evening, [hand])
    expect(historyList([old])[0].mine).toEqual({ cards: null, position: 'SB', net: -30, bb: 10 })
  })

  it('меня не было в раздаче или стол на одном телефоне — без карт и итога', () => {
    const [watcher] = savedHands(roomEvening('KQ7MZP', after, 'p9'), [hand])
    expect(historyList([watcher])[0].mine).toBeNull()
    const [shared] = savedHands(localEvening('1', after), [hand])
    expect(historyList([shared])[0].mine).toBeNull()
  })

  it('раздача целиком: шапка, позиции, моё место, улицы с картами и банком, текст — как в файле', () => {
    const [saved] = savedHands(botsEvening('b1', after, 'p1'), [hand], new Map([[1, ['Qc', 'Jd'] as Card[]]]))
    const v = historyHandView(saved)
    expect(v.head).toBe('Холдем, без лимита · блайнды 5/10')
    expect(v.positions).toEqual(['BTN', 'SB', 'BB'])
    expect(v.meIndex).toBe(1)
    expect(v.mine?.cards).toEqual(['Qc', 'Jd'])
    expect(v.streets).toEqual([
      { label: 'Префлоп', board: [], pot: 15, moves: ['P0: рейз до 30', 'P1: колл до 30', 'P2: пас'] },
      { label: 'Флоп', board: ['3c', '8d', '9h'], pot: 70, moves: ['P1: чек', 'P0: рейз до 50', 'P1: пас'] },
    ])
    expect(v.text).toContain('Dealt to P1 [Qc Jd]')
    expect(v.text).toContain('Seat 2: P1 (small blind) folded on the Flop')
  })

  it('стол на одном телефоне (#242): карты взявшего банк без вскрытия видны — как в тексте той же раздачи', () => {
    const [shared] = savedHands(localEvening('1', after), [hand])
    const v = historyHandView(shared)
    expect(v.players.map((p) => p.cards)).toEqual([['Ks', 'Kh'], null, null]) // сдача с P1: у P0 — третья пара
    expect(v.text).toContain('Dealt to P0 [Ks Kh]')
    // За столом комнаты у другого игрока — по-прежнему не видны
    const [other] = savedHands(evening, [hand])
    expect(historyHandView(other).players[0].cards).toBeNull()
  })
})

describe('итог вечера по игрокам (#242)', () => {
  // Три раздачи: все сбросили большому блайнду; P2 уходит; вдвоём — сплит; вдвоём — малый блайнд сбросил
  const before = newTable(['p0', 'p1', 'p2'], PHONES)
  const first = playHand(before, [start('p0', ANY), fold('p0'), fold('p1')])
  const two = play(first.after, [{ from: 'p0', msg: { type: 'remove', playerId: 'p2' }, now: 3 }], false)
  const splitDeck = deckOf([['2c', '3d'], ['4c', '5d']], ['As', 'Ks', 'Qs', 'Js', 'Ts'])
  const splitSteps = [start('p0', splitDeck), call('p1'), check('p0')]
  for (let k = 0; k < 3; k++) splitSteps.push(check('p0'), check('p1'))
  const split = playHand(two, splitSteps)
  const last = playHand(split.after, [start('p0', ANY), fold('p0')])
  const hands = [first.hand, split.hand, last.hand]

  it('сумма итогов за раздачу (handNet) у каждого, с ушедшим; больший сверху, моя строка отмечена; сходится', () => {
    expect(split.hand.pots.map((p) => [p.amount, [...p.winners].sort()])).toEqual([[20, ['p0', 'p1']]]) // сплит
    const records = savedHands(roomEvening('KQ7MZP', last.after, 'p1'), hands)
    const r = eveningResult(records)
    expect(r.players).toEqual([
      { id: 'p2', name: 'P2', hands: 1, net: 5, bb: 0.5, me: false },
      { id: 'p1', name: 'P1', hands: 3, net: 0, bb: 0, me: true },
      { id: 'p0', name: 'P0', hands: 3, net: -5, bb: -0.5, me: false },
    ])
    for (const p of r.players) {
      expect(p.net).toBe(hands.reduce((sum, h) => sum + (handNet(h, p.id) ?? 0), 0))
    }
    // За столом остались P0 и P1 — их итог тот же, что изменение стеков
    expect(chipsOf(last.after).p0 - chipsOf(before).p0).toBe(-5)
    expect(chipsOf(last.after).p1 - chipsOf(before).p1).toBe(0)
    expect({ plus: r.plus, minus: r.minus, unknown: r.unknown }).toEqual({ plus: 5, minus: -5, unknown: 0 })
    expect(eveningBalanceText(r)).toBe('Сходится: +5 и −5')
  })

  it('строка вечера: мой итог — и ноль; меня в вечере нет — без итога', () => {
    const mine = eveningSummaries(savedHands(roomEvening('KQ7MZP', last.after, 'p0'), hands))
    expect(mine).toEqual([{ id: mine[0].id, code: 'KQ7MZP', startedAt: mine[0].startedAt, hands: 3, myNet: -5 }])
    expect(eveningSummaries(savedHands(roomEvening('KQ7MZP', last.after, 'p1'), hands))[0].myNet).toBe(0)
    expect(eveningSummaries(savedHands(roomEvening('KQ7MZP', last.after, 'p9'), hands))[0]).not.toHaveProperty('myNet')
    expect(eveningSummaries(savedHands(localEvening('1', last.after), hands))[0]).not.toHaveProperty('myNet')
    expect(myEveningNet(savedHands(botsEvening('b1', last.after, 'p2'), hands))).toBe(5)
  })

  it('живые карты в турнире — блайндов нет: раздача без итога, сказано под таблицей', () => {
    const live = newTable(['p0', 'p1', 'p2'])
    const { after, hand: liveHand } = playHand(live, [start('p0'), fold('p0'), fold('p1'), award('p0', [['p2']])])
    const [record] = savedHands(localEvening('1', after), [liveHand])
    const tournament = { ...record, table: { ...record.table!, tournament: true } }
    const r = eveningResult([tournament])
    expect(r.unknown).toBe(1)
    expect(r.players.map((p) => [p.id, p.hands, p.net])).toEqual([
      ['p0', 1, 0],
      ['p1', 1, 0],
      ['p2', 1, 0],
    ])
    expect(eveningBalanceText(r)).toBe('Сходится: +0 и −0. Без итога раздач: 1 — блайнды не записаны')
    expect(eveningResult([record]).unknown).toBe(0)
  })
})
