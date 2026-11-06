import { describe, expect, it } from 'vitest'
import type { Card } from './cards'
import { boardLeft, dealRound, deckFor, HOLDEM_GAME, newCards, runOutTimes, runsPossible } from './game'
import { awardPots, awardRuns, type Hand } from './hand'
import { PROTOCOL_VERSION, VERSION_ERROR, type ClientBody } from './protocol'
import { RUN_VOTE_MS } from './runs'
import { DEFAULT_TOURNAMENT } from './tournament'
import { createTable, handle, nextDeadline, onTime, type Settings, type TableState } from './table'
import { allin, call, check, MODES, newTable, play, raise, stackedDeck, start, type Step } from './testing'

const RUNS: Partial<Settings> = { cards: 'phones', maxRuns: 3 }

const choose = (from: string, times: number, now = 0): Step => ({ from, msg: { type: 'runChoice', times } as ClientBody, now })

const refuse = (s: TableState, from: string, body: Record<string, unknown>, now = 0) => {
  const r = handle(s, from, { v: PROTOCOL_VERSION, ...body }, now)
  return r.ok ? null : r.error
}

// Хедз-ап: кнопка p0 (малый, ходит первой), сдают с p1. У p1 тузы, у p0 короли.
// Борд 1 — пустой для обоих: тузы берут; борд 2 — два короля: каре p0; борд 3 — снова тузы
const BOARD_1: Card[] = ['2c', '3d', '7h', '9s', 'Jd']
const BOARD_2: Card[] = ['Kd', 'Kc', '4s', '5h', '8d']
const BOARD_3: Card[] = ['2d', '3c', '7s', '9h', 'Jc']
const DECK = stackedDeck([['As', 'Ah'], ['Ks', 'Kh']], [...BOARD_1, ...BOARD_2, ...BOARD_3])

// Олл-ин префлоп и колл: торги закрыты, банк 2 000
const allInPreflop = (settings: Partial<Settings> = RUNS, rt = false) =>
  play(newTable(['p0', 'p1'], settings), [start('p0', DECK), allin('p0'), { ...call('p1'), now: 1000 }], rt)

describe.each(MODES)('«Прогнать несколько раз» (%s)', (_, rt) => {
  it('олл-ин до ривера: у каждого дошедшего — выбор с отсчётом, раздача ждёт', () => {
    const s = allInPreflop(RUNS, rt)
    expect(s.hand?.stage).toBe('showdown')
    expect(s.hand?.cards?.board).toEqual([])
    expect(s.runVote).toEqual({ hand: 1, max: 3, deadline: 1000 + RUN_VOTE_MS, players: ['p0', 'p1'], answers: {} })
    expect(nextDeadline(s)).toBe(1000 + RUN_VOTE_MS)
    expect(s.turn ?? null).toBeNull()
    expect(refuse(s, 'p0', { type: 'runChoice', times: 4 })).toBe('Прогнать — от 1 до 3 раз')
    expect(refuse(s, 'p0', { type: 'runChoice', times: 0 })).toBe('Прогнать — от 1 до 3 раз')
    expect(refuse(s, 'p0', { type: 'start' })).toBe('Раздача ещё идёт')
  })

  it('прогон дважды: два борда, банк пополам, у каждого борда свой победитель', () => {
    const s = play(allInPreflop(RUNS, rt), [choose('p0', 2), choose('p1', 3)], rt)
    expect(s.hand).toBeNull()
    expect(s.runVote).toBeNull()
    const last = s.lastHand!
    expect(last.payouts).toEqual({ p0: 1000, p1: 1000 })
    expect(last.pots).toEqual([{ amount: 2000, winners: ['p0', 'p1'] }])
    const record = last.record!
    expect(record.board).toEqual(BOARD_1)
    expect(record.runs?.map((r) => r.board)).toEqual([BOARD_1, BOARD_2])
    expect(record.runs?.map((r) => r.winners)).toEqual([[['p1']], [['p0']]])
    expect(record.runs?.[1].hands.p0).toMatch(/^Каре/)
    expect(record.hands).toEqual(record.runs?.[0].hands)
    expect(s.players.map((p) => p.chips)).toEqual([1000, 1000])
  })

  it('прогон трижды — наименьшее из выбранного', () => {
    const s = play(allInPreflop(RUNS, rt), [choose('p0', 3), choose('p1', 3)], rt)
    const record = s.lastHand!.record!
    expect(record.runs?.map((r) => r.board)).toEqual([BOARD_1, BOARD_2, BOARD_3])
    // 2 000 на три борда: по 666, нечётные 2 — по кругу от кнопки среди взявших: сначала p1, затем p0
    expect(s.lastHand!.payouts).toEqual({ p1: 666 * 2 + 1, p0: 666 + 1 })
  })

  it('выбрал 1 — прогон один сразу, как без настройки', () => {
    const s = play(allInPreflop(RUNS, rt), [choose('p1', 1)], rt)
    expect(s.hand).toBeNull()
    expect(s.lastHand!.record!.runs).toBeUndefined()
    expect(s.lastHand!.record!.board).toEqual(BOARD_1)
    expect(s.lastHand!.payouts).toEqual({ p1: 2000 })
  })

  it('до срока выбор можно сменить; не ответил — 1', () => {
    let s = play(allInPreflop(RUNS, rt), [choose('p0', 3), choose('p0', 2)], rt)
    expect(s.runVote?.answers).toEqual({ p0: 2 })
    expect(onTime(s, 1000 + RUN_VOTE_MS - 1)).toBeNull()
    s = onTime(s, 1000 + RUN_VOTE_MS)!
    expect(s.hand).toBeNull()
    expect(s.lastHand!.record!.runs).toBeUndefined()
    expect(s.lastHand!.payouts).toEqual({ p1: 2000 })
  })

  it('настройка «нет» — всё как сейчас', () => {
    for (const settings of [{ cards: 'phones' as const }, { cards: 'phones' as const, maxRuns: 1 as const }]) {
      const s = allInPreflop(settings, rt)
      expect(s.hand).toBeNull()
      expect(s.runVote ?? null).toBeNull()
      expect(s.lastHand!.record!.runs).toBeUndefined()
      expect(s.lastHand!.payouts).toEqual({ p1: 2000 })
    }
  })

  it('олл-ин на ривере — выбора нет', () => {
    const deck = stackedDeck([['As', 'Ah'], ['Ks', 'Kh']], BOARD_1)
    const steps = [start('p0', deck), call('p0'), check('p1')]
    for (let k = 0; k < 2; k++) steps.push(check('p1'), check('p0'))
    steps.push(allin('p1'), call('p0'))
    const s = play(newTable(['p0', 'p1'], RUNS), steps, rt)
    expect(s.hand).toBeNull()
    expect(s.runVote ?? null).toBeNull()
    expect(s.lastHand!.record!.runs).toBeUndefined()
  })

  it('олл-ин против двоих, кто ещё может ставить, — торги не кончены, выбора нет', () => {
    // Трое: кнопка p0, малый p1, большой p2; первым ходит p0. У p1 стек 300
    const t = newTable(['p0', 'p1', 'p2'], RUNS, { p1: 300 })
    const s = play(t, [start('p0', deckFor(HOLDEM_GAME)), raise('p0', 100), allin('p1'), call('p2')], rt)
    expect(s.hand?.stage).toBe('preflop')
    expect(s.runVote ?? null).toBeNull()
    expect(s.hand?.seats[s.hand.toAct].id).toBe('p0')
  })

  it('выбирают только дошедшие до вскрытия', () => {
    const s = allInPreflop(RUNS, rt)
    const t = play(s, [{ from: 'p2', msg: { type: 'sit', name: 'P2' } }], rt)
    expect(refuse(t, 'p2', { type: 'runChoice', times: 2 })).toBe('Выбирают те, кто в олл-ине')
    expect(refuse(newTable(['p0', 'p1'], RUNS), 'p0', { type: 'runChoice', times: 2 })).toBe(
      'Выбора «сколько раз прогнать» сейчас нет',
    )
  })

  it('турнир: проиграл все борды — выбыл; выиграл хоть один — остался с выигранной частью', () => {
    const tour: Partial<Settings> = { ...RUNS, format: 'tournament', tournament: DEFAULT_TOURNAMENT }
    const split = play(allInPreflop(tour, rt), [choose('p0', 2), choose('p1', 2)], rt)
    expect(split.players.map((p) => p.chips)).toEqual([1000, 1000])
    expect(split.tournament?.out).toEqual([])
    // Борд 2 без королей — тузы берут оба борда
    const deck = stackedDeck([['As', 'Ah'], ['Ks', 'Kh']], [...BOARD_1, ...BOARD_3])
    const lost = play(newTable(['p0', 'p1'], tour), [start('p0', deck), allin('p0'), call('p1'), choose('p0', 2), choose('p1', 2)], rt)
    expect(lost.lastHand!.record!.runs?.map((r) => r.winners)).toEqual([[['p1']], [['p1']]])
    expect(lost.tournament?.out.map((b) => b.playerId)).toEqual(['p0'])
    expect(lost.players.find((p) => p.id === 'p1')?.chips).toBe(2000)
  })
})

describe('настройка и версия', () => {
  it('нет / до двух / до трёх — только с картами на телефонах; кэш и турнир', () => {
    expect(createTable('h', 'H', { cards: 'phones', maxRuns: 2 }, 0).ok).toBe(true)
    expect(createTable('h', 'H', { cards: 'phones', maxRuns: 3, format: 'tournament', tournament: DEFAULT_TOURNAMENT }, 0).ok).toBe(true)
    expect(createTable('h', 'H', { cards: 'live', maxRuns: 1 }, 0).ok).toBe(true)
    expect(createTable('h', 'H', { cards: 'phones', maxRuns: 4 as never }, 0)).toEqual({
      ok: false,
      error: 'Прогнать несколько раз — нет, до двух или до трёх',
    })
    expect(createTable('h', 'H', { cards: 'live', maxRuns: 2 }, 0)).toEqual({
      ok: false,
      error: '«Прогнать несколько раз» — только с картами на телефонах',
    })
  })

  it('старая копия приложения — «обновите приложение»', () => {
    expect(PROTOCOL_VERSION).toBe(17)
    const s = allInPreflop()
    expect(handle(s, 'p0', { v: 16, type: 'runChoice', times: 2 }, 0)).toEqual({ ok: false, error: VERSION_ERROR })
  })
})

describe('борды и деление банков', () => {
  it('каждый следующий борд — те же открытые карты и свои из колоды', () => {
    const c = newCards(HOLDEM_GAME, stackedDeck([['As', 'Ah'], ['Ks', 'Kh']], [...BOARD_1, '4s', '5h']), ['a', 'b'])
    // Префлоп и флоп сданы: руки и три карты стола
    dealRound(c, ['a', 'b'])
    dealRound(c, ['a', 'b'])
    expect(boardLeft(c)).toBe(2)
    expect(runsPossible(c)).toBe(Math.floor(c.deck.length / 2))
    const boards = runOutTimes(c, ['a', 'b'], 2)
    expect(boards).toEqual([BOARD_1, [...BOARD_1.slice(0, 3), '4s', '5h']])
    expect(c.boards).toEqual(boards)
    expect(c.board).toEqual(BOARD_1)
  })

  it('банк и побочный — каждый делится по бордам; нечётная фишка — по кругу от кнопки', () => {
    const seat = (id: string, committed: number) => ({ id, chips: 0, bet: 0, committed, folded: false, allIn: true, acted: true, actedAt: 0 })
    const hand = (): Hand => ({
      number: 1,
      stage: 'showdown',
      seats: [seat('a', 40), seat('b', 100), seat('c', 100)],
      button: 0,
      sb: 5,
      bb: 10,
      toAct: -1,
      currentBet: 0,
      minRaise: 10,
      fullBet: 0,
      pots: [
        { amount: 121, eligible: ['a', 'b', 'c'] },
        { amount: 120, eligible: ['b', 'c'] },
      ],
      returned: null,
      log: [],
    })
    // Борд 1: основной — a, побочный — b; борд 2: оба — c. Основной 121: по 60, нечётная — первому
    // после кнопки (a) среди взявших его (a, c) — c
    expect(awardRuns(hand(), [[['a'], ['b']], [['c'], ['c']]])).toEqual({ a: 60, b: 60, c: 121 })
    // Один борд — как раньше
    expect(awardRuns(hand(), [[['a'], ['b']]])).toEqual(awardPots(hand(), [['a'], ['b']]))
    expect(awardRuns(hand(), [[['a'], ['b']], [['b']]])).toBe('Нужен победитель каждого банка: банков 2')
  })
})
