// Хай/лоу своей игры (#227): лоу «восьмёрка или лучше», делёж банка пополам, запись раздачи
import { describe, expect, it } from 'vitest'
import { bestHand, bestLow, compareLows, HOLDEM, lowWinners, OMAHA, type Card, type LowResult } from './cards'
import { awardRuns, type Hand } from './hand'
import { HI_LO_DECK_ERROR, ownGameDef, ownGameError, type OwnGame } from './ownGame'
import type { Settings, TableState } from './table'
import { allin, call, MODES, newTable, play, stackedDeck, start, type Step } from './testing'

const HILO_OMAHA: OwnGame = { id: 'own-o8', name: 'Омаха хай/лоу', hole: 4, fromHand: 2, deck: 52, order: 'standard', board: [3, 1, 1], limit: 'nolimit', hiLo: true }
const HILO_HOLDEM: OwnGame = { ...HILO_OMAHA, id: 'own-h8', name: 'Холдем хай/лоу', hole: 2, fromHand: 'any' }

const own = (game: OwnGame, extra: Partial<Settings> = {}): Partial<Settings> => ({ cards: 'phones', games: [game], game: game.id, ...extra })

const low = (variant: typeof HOLDEM, hand: Card[], board: Card[]) => bestLow(variant, hand, board) as LowResult

// Хедз-ап: кнопка p0, сдают с p1; олл-ин префлоп и колл — раздача до итога
function headsUp(game: OwnGame, p1: Card[], p0: Card[], board: Card[], rt: boolean, extra: Partial<Settings> = {}, more: Step[] = []): TableState {
  const deck = stackedDeck([p1, p0], board)
  return play(newTable(['p0', 'p1'], own(game, extra)), [start('p0', deck), allin('p0'), call('p1'), ...more], rt)
}

describe('лоу: счёт и сравнение', () => {
  it('пять разных рангов не старше 8, туз — младший; стриты и флеши не мешают', () => {
    expect(low(HOLDEM, ['5c', '4d'], ['3h', '2s', 'Ac', 'Kd', 'Qh'])).toEqual({
      cards: ['5c', '4d', '3h', '2s', 'Ac'],
      value: [5, 4, 3, 2, 1],
      name: 'Лоу 5-4-3-2-A',
    })
    // Флеш-стрит до пятёрки — всё равно лучший лоу
    expect(low(HOLDEM, ['5h', '4h'], ['3h', '2h', 'Ah', 'Kd', 'Qc']).name).toBe('Лоу 5-4-3-2-A')
    // Пара не в счёт: разных младших рангов только четыре
    expect(bestLow(HOLDEM, ['2c', '2d'], ['3h', '4s', '5c', 'Kd', 'Qh'])).toBeNull()
    // Девятка — не лоу
    expect(bestLow(HOLDEM, ['9c', '2d'], ['3h', '4s', '5c', 'Kd', 'Qh'])).toBeNull()
    // Из пар и повторов — лучшая пятёрка: 8-6-4-3-A
    expect(low(HOLDEM, ['Ac', '8d'], ['6h', '4s', '3c', 'Ad', '8h']).name).toBe('Лоу 8-6-4-3-A')
  })

  it('сравнение — от старшей карты вниз, меньше — лучше', () => {
    const wheel = low(HOLDEM, ['5c', '4d'], ['3h', '2s', 'Ac', 'Kd', 'Qh'])
    const six = low(HOLDEM, ['6c', '4d'], ['3h', '2s', 'Ac', 'Kd', 'Qh'])
    expect(six.name).toBe('Лоу 6-4-3-2-A')
    expect(compareLows(wheel, six)).toBeGreaterThan(0)
    expect(compareLows(six, wheel)).toBeLessThan(0)
    expect(compareLows(wheel, wheel)).toBe(0)
    // 8-5-4-3-2 хуже 8-4-3-2-A
    const eight5 = low(HOLDEM, ['5c', 'Qh'], ['8c', '4d', '3h', '2s', 'Kd'])
    const eight4 = low(HOLDEM, ['Ac', 'Qs'], ['8c', '4d', '3h', '2s', 'Kd'])
    expect([eight5.name, eight4.name]).toEqual(['Лоу 8-5-4-3-2', 'Лоу 8-4-3-2-A'])
    expect(compareLows(eight4, eight5)).toBeGreaterThan(0)
    // 7-6-5-4-3 лучше 8-4-3-2-A: решает первая карта
    const seven = low(HOLDEM, ['7c', '6d'], ['5h', '4s', '3c', 'Kd', 'Qh'])
    expect(seven.name).toBe('Лоу 7-6-5-4-3')
    expect(compareLows(seven, eight4)).toBeGreaterThan(0)
  })

  it('«ровно N из руки» — и для лоу: ровно N своих, остальное со стола; выбор — свой, не тот, что у старшей руки', () => {
    const board: Card[] = ['As', '2d', '7c', 'Kh', 'Qs']
    // Пример 1: у Ани старшая — «Тройка, короли» (короли из руки), лоу — 7-4-3-2-A (тройка и четвёрка из руки)
    expect(bestHand(OMAHA, ['3h', '4c', 'Kd', 'Ks'], board).name).toBe('Тройка, короли')
    expect(low(OMAHA, ['3h', '4c', 'Kd', 'Ks'], board)).toMatchObject({ name: 'Лоу 7-4-3-2-A', cards: ['7c', '4c', '3h', '2d', 'As'] })
    // У Бори туз и двойка из руки повторяют стол — лоу нет
    expect(bestLow(OMAHA, ['Ah', '2c', 'Qd', 'Jc'], board)).toBeNull()
    expect(lowWinners(OMAHA, board, [
      { id: 'anya', cards: ['3h', '4c', 'Kd', 'Ks'] },
      { id: 'borya', cards: ['Ah', '2c', 'Qd', 'Jc'] },
    ])).toEqual(['anya'])
    // Пример 3: на столе лоу 5-4-3-2-A, но из руки ровно две — своих не старше 8 нет
    const wheel: Card[] = ['Ad', '2s', '3h', '4c', '5d']
    expect(bestLow(OMAHA, ['Kc', 'Kh', 'Qd', 'Qs'], wheel)).toBeNull()
    expect(bestLow(OMAHA, ['9c', '9d', 'Jc', 'Jh'], wheel)).toBeNull()
    // «Любые» — лоу со стола
    expect(low(HOLDEM, ['Kc', 'Kh'], wheel).name).toBe('Лоу 5-4-3-2-A')
  })

  it('лоу ни у кого — пусто; одинаковый лоу — все', () => {
    expect(lowWinners(HOLDEM, ['Kd', 'Qc', '9h', 'Ts', '3s'], [
      { id: 'a', cards: ['Ac', '2c'] },
      { id: 'b', cards: ['Kh', '5d'] },
    ])).toEqual([])
    expect(lowWinners(HOLDEM, ['Ac', '2d', '7h', 'Kd', 'Ks'], [
      { id: 'a', cards: ['3c', '4d'] },
      { id: 'b', cards: ['Kc', 'Qh'] },
      { id: 'c', cards: ['3h', '4s'] },
    ])).toEqual(['a', 'c'])
  })
})

describe('описание своей игры: hiLo', () => {
  it('нет поля и «нет» — как сейчас; «да» — в описании раздачи', () => {
    expect(ownGameError(HILO_OMAHA)).toBeNull()
    expect(ownGameError({ ...HILO_OMAHA, hiLo: false })).toBeNull()
    const { hiLo: _h, ...plain } = HILO_OMAHA
    expect(ownGameError(plain)).toBeNull()
    expect(ownGameDef(HILO_OMAHA).hiLo).toBe(true)
    expect('hiLo' in ownGameDef(plain)).toBe(false)
    expect('hiLo' in ownGameDef({ ...HILO_OMAHA, hiLo: false })).toBe(false)
  })

  it('с колодой 36 — отказ; не «да» и не «нет» — отказ', () => {
    expect(HI_LO_DECK_ERROR).toBe('Хай/лоу — только с колодой 52: в 36 картах лоу не собрать')
    expect(ownGameError({ ...HILO_HOLDEM, deck: 36, order: 'shortdeck' })).toBe(HI_LO_DECK_ERROR)
    expect(ownGameError({ ...HILO_HOLDEM, deck: 36, order: 'shortdeck', hiLo: false })).toBeNull()
    expect(ownGameError({ ...HILO_HOLDEM, hiLo: 'да' })).toBe('„Холдем хай/лоу“: хай/лоу — да или нет')
  })
})

describe('делёж банка (awardRuns)', () => {
  const seat = (id: string, committed: number) => ({ id, chips: 0, bet: 0, committed, folded: false, allIn: true, acted: true, actedAt: 0 })
  const hand = (pots: Hand['pots'], ids = ['a', 'b', 'c']): Hand => ({
    number: 1,
    stage: 'showdown',
    seats: ids.map((id) => seat(id, 0)),
    button: 0,
    sb: 5,
    bb: 10,
    toAct: -1,
    currentBet: 0,
    minRaise: 10,
    fullBet: 0,
    pots,
    returned: null,
    log: [],
  })

  it('пример 5: банк 101 — старшей 51, лоу 50 (нечётная — старшей половине)', () => {
    expect(awardRuns(hand([{ amount: 101, eligible: ['a', 'b'] }]), [[['a']]], [[['b']]])).toEqual({ a: 51, b: 50 })
  })

  it('пример 4: одинаковый лоу у двоих — четверти; нечётная фишка — первому от кнопки', () => {
    // Банк 102, кнопка у a: хай 51 — c; лоу 51 — a и b: 26 первому после кнопки (b), 25 — a
    expect(awardRuns(hand([{ amount: 102, eligible: ['a', 'b', 'c'] }]), [[['c']]], [[['a', 'b']]])).toEqual({ c: 51, b: 26, a: 25 })
    // Кнопка у b — первый после неё c
    expect(awardRuns({ ...hand([{ amount: 102, eligible: ['a', 'b', 'c'] }]), button: 1 }, [[['b']]], [[['a', 'c']]])).toEqual({ b: 51, c: 26, a: 25 })
  })

  it('лоу нет — весь банк хаю; без lows — как раньше', () => {
    expect(awardRuns(hand([{ amount: 101, eligible: ['a', 'b'] }]), [[['a']]], [[[]]])).toEqual({ a: 101 })
    expect(awardRuns(hand([{ amount: 101, eligible: ['a', 'b'] }]), [[['a']]])).toEqual({ a: 101 })
  })

  it('лоу у не претендента банка — отказ', () => {
    expect(awardRuns(hand([{ amount: 100, eligible: ['a', 'b'] }]), [[['a']]], [[['c']]])).toBe('Банк 1: лоу у игрока, который за него не борется')
    expect(awardRuns(hand([{ amount: 100, eligible: ['a', 'b'] }]), [[['a']]], [])).toBe('Нужен лоу каждого борда')
  })
})

describe.each(MODES)('стол хай/лоу: раздача от начала до итога (%s)', (_, rt) => {
  it('пример 1: омаха — у Ани и старшая, и лоу: весь банк ей', () => {
    // p1 — Аня, p0 — Боря
    const s = headsUp(HILO_OMAHA, ['3h', '4c', 'Kd', 'Ks'], ['Ah', '2c', 'Qd', 'Jc'], ['As', '2d', '7c', 'Kh', 'Qs'], rt)
    const last = s.lastHand!
    expect(last.payouts).toEqual({ p1: 2000 })
    expect(last.pots).toEqual([{ amount: 2000, winners: ['p1'] }])
    const r = last.record!
    expect(r.hands.p1).toBe('Тройка, короли')
    expect(r.lows).toEqual({ p1: 'Лоу 7-4-3-2-A' })
    expect(r.lowBest).toEqual({ p1: ['7c', '4c', '3h', '2d', 'As'] })
    expect(r.split).toEqual([{ hi: ['p1'], lo: ['p1'] }])
    expect(r.game.hiLo).toBe(true)
  })

  it('пример 2: лоу нет ни у кого — весь банк старшей руке', () => {
    const s = headsUp(HILO_HOLDEM, ['Ac', '2c'], ['Kh', '5d'], ['Kd', 'Qc', '9h', 'Ts', '3s'], rt)
    expect(s.lastHand!.payouts).toEqual({ p0: 2000 })
    expect(s.lastHand!.record!.split).toEqual([{ hi: ['p0'], lo: [] }])
    expect(s.lastHand!.record!.lows).toEqual({})
  })

  it('пример 3: омаха — на столе лоу, а своих младших нет: весь банк паре королей; холдем — банк пополам', () => {
    const board: Card[] = ['Ad', '2s', '3h', '4c', '5d']
    const omaha = headsUp(HILO_OMAHA, ['Kc', 'Kh', 'Qd', 'Qs'], ['9c', '9d', 'Jc', 'Jh'], board, rt)
    expect(omaha.lastHand!.payouts).toEqual({ p1: 2000 })
    expect(omaha.lastHand!.record!.hands.p1).toBe('Пара, короли')
    expect(omaha.lastHand!.record!.split).toEqual([{ hi: ['p1'], lo: [] }])
    const holdem = headsUp(HILO_HOLDEM, ['Kc', 'Kh'], ['9c', '9d'], board, rt)
    expect(holdem.lastHand!.payouts).toEqual({ p0: 1000, p1: 1000 })
    const r = holdem.lastHand!.record!
    expect(r.hands).toEqual({ p0: 'Стрит до пятёрки', p1: 'Стрит до пятёрки' })
    expect(r.lows).toEqual({ p0: 'Лоу 5-4-3-2-A', p1: 'Лоу 5-4-3-2-A' })
    expect(r.split).toEqual([{ hi: ['p0', 'p1'], lo: ['p0', 'p1'] }])
  })

  it('пример 4: одинаковый лоу у двоих — четверти банка', () => {
    // Трое: кнопка p0, сдают с p1 (p1, p2, p0). У p1 и p0 лоу 7-4-3-2-A, у p2 — тройка королей
    const deck = stackedDeck([['3c', '4d'], ['Kc', 'Qh'], ['3h', '4s']], ['Ac', '2d', '7h', 'Kd', 'Ks'])
    const s = play(newTable(['p0', 'p1', 'p2'], own(HILO_HOLDEM)), [start('p0', deck), allin('p0'), call('p1'), call('p2')], rt)
    expect(s.lastHand!.payouts).toEqual({ p2: 1500, p0: 750, p1: 750 })
    expect(s.lastHand!.record!.split).toEqual([{ hi: ['p2'], lo: ['p0', 'p1'] }])
    expect(s.lastHand!.pots).toEqual([{ amount: 3000, winners: ['p0', 'p1', 'p2'] }])
  })

  it('пример 6: побочный банк — короткий олл-ин с лучшим лоу берёт половину основного', () => {
    // Трое: у p1 стек 300. Сдают с p1: p1 — лоу 7-4-3-2-A, p2 — тройка королей, p0 — лоу 7-6-5-3-2
    const deck = stackedDeck([['Ac', '4c'], ['Kh', 'Ks'], ['5h', '6d']], ['Kd', 'Qc', '7h', '2s', '3d'])
    const t = newTable(['p0', 'p1', 'p2'], own(HILO_HOLDEM), { p1: 300 })
    const s = play(t, [start('p0', deck), allin('p0'), allin('p1'), call('p2')], rt)
    const last = s.lastHand!
    // Основной 900: хай — p2, лоу — p1; побочный 1 400 (p0, p2): хай — p2, лоу — p0
    expect(last.pots).toEqual([
      { amount: 900, winners: ['p1', 'p2'] },
      { amount: 1400, winners: ['p0', 'p2'] },
    ])
    expect(last.payouts).toEqual({ p1: 450, p2: 1150, p0: 700 })
    expect(last.record!.split).toEqual([
      { hi: ['p2'], lo: ['p1'] },
      { hi: ['p2'], lo: ['p0'] },
    ])
    expect(last.record!.lows).toEqual({ p1: 'Лоу 7-4-3-2-A', p0: 'Лоу 7-6-5-3-2' })
    expect(s.players.map((p) => p.chips)).toEqual([700, 450, 1150])
  })

  it('пример 7: прогон дважды — банк пополам по бордам, доля борда — пополам хай/лоу; сумма выплат = банк', () => {
    // Борд 1: хай — p0 (тройка королей), лоу — p1 (7-4-3-2-A); борд 2: лоу нет, хай — p1 (пара тузов)
    const choose = (from: string): Step => ({ from, msg: { type: 'runChoice', times: 2 } })
    const s = headsUp(
      HILO_HOLDEM,
      ['Ac', '2c'],
      ['Kh', 'Ks'],
      ['Kd', '7h', '3s', '4d', '8c', 'Ad', 'Jc', '9s', '5d', 'Th'],
      rt,
      { maxRuns: 2 },
      [choose('p0'), choose('p1')],
    )
    const last = s.lastHand!
    expect(last.payouts).toEqual({ p0: 500, p1: 1500 })
    expect(Object.values(last.payouts).reduce((a, b) => a + b, 0)).toBe(2000)
    const r = last.record!
    expect(r.runs?.map((x) => x.split)).toEqual([[{ hi: ['p0'], lo: ['p1'] }], [{ hi: ['p1'], lo: [] }]])
    expect(r.runs?.[0].lows).toEqual({ p1: 'Лоу 7-4-3-2-A' })
    expect(r.split).toEqual(r.runs?.[0].split)
    expect(last.pots).toEqual([{ amount: 2000, winners: ['p0', 'p1'] }])
  })

  it('без хай/лоу — полей лоу в записи нет', () => {
    const { hiLo: _h, ...plain } = HILO_HOLDEM
    const s = headsUp(plain, ['Ac', '2c'], ['Kh', 'Ks'], ['Kd', '7h', '3s', '4d', '8c'], rt)
    const r = s.lastHand!.record!
    expect(s.lastHand!.payouts).toEqual({ p0: 2000 })
    expect(r.lows).toBeUndefined()
    expect(r.split).toBeUndefined()
  })
})
