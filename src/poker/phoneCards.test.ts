import { describe, expect, it } from 'vitest'
import { allInOdds, equity, percents } from '../calc/allInOdds'
import { HOLDEM, type Card } from './cards'
import { HOLDEM_GAME, deckFor } from './game'
import type { OwnGame } from './ownGame'
import { PROTOCOL_VERSION } from './protocol'
import { handle, viewFor, type TableState } from './table'
import { allin, call, check, fold, MODES, newTable, play, raise, stackedDeck, start, type Step } from './testing'

const PHONES = { cards: 'phones' as const }

// Сообщение в стол; отказ — текст
const tryStep = (s: TableState, from: string, body: Record<string, unknown>) => {
  const r = handle(s, from, { v: PROTOCOL_VERSION, ...body }, 0)
  return r.ok ? r.state : r.error
}

// Чужие закрытые карты и колода — ни строчкой в том, что уходит на телефон
function leaks(view: TableState, server: TableState, me: string): string[] {
  const text = JSON.stringify(view)
  const hidden = [
    ...(server.hand?.cards?.deck ?? []),
    ...Object.entries(server.hand?.cards?.hole ?? {})
      .filter(([id]) => id !== me)
      .flatMap(([, cards]) => cards),
  ]
  return hidden.filter((c) => c !== null && text.includes(`"${c}"`)) as string[]
}

describe.each(MODES)('карты на телефонах (%s)', (_, roundtrip) => {
  it('раздача: каждому две карты, стол — по улицам 3, 1, 1; колода без повторов', () => {
    const t = newTable(['p0', 'p1', 'p2'], PHONES)
    const deck = deckFor(HOLDEM_GAME)
    let s = play(t, [start('p0', deck)], roundtrip)
    const cards = s.hand?.cards
    expect(cards?.game.id).toBe('holdem')
    // Кнопка — p0: сдача с p1 по кругу
    expect(cards?.hole).toEqual({ p1: [deck[0], deck[3]], p2: [deck[1], deck[4]], p0: [deck[2], deck[5]] })
    expect(cards?.board).toEqual([])
    s = play(s, [call('p0'), call('p1'), check('p2')], roundtrip)
    expect(s.hand?.stage).toBe('flop')
    expect(s.hand?.cards?.board).toEqual(deck.slice(6, 9))
    s = play(s, [check('p1'), check('p2'), check('p0')], roundtrip)
    expect(s.hand?.cards?.board).toHaveLength(4)
    s = play(s, [check('p1'), check('p2'), check('p0')], roundtrip)
    expect(s.hand?.stage).toBe('river')
    const c = s.hand!.cards!
    const all = [...c.deck, ...c.board, ...Object.values(c.hole).flat()]
    expect(all).toHaveLength(52)
    expect(new Set(all).size).toBe(52)
  })

  it('никто не получает чужих закрытых карт и колоды — ни в раздаче, ни после неё', () => {
    const t = newTable(['p0', 'p1', 'p2'], PHONES)
    let s = play(t, [start('p0', stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s']))], roundtrip)
    for (const me of ['p0', 'p1', 'p2', null]) {
      const view = viewFor(s, me)
      expect(leaks(view, s, me ?? '')).toEqual([])
      expect(view.hand?.cards?.deck).toEqual([])
      for (const id of ['p0', 'p1', 'p2']) {
        expect(view.hand?.cards?.hole[id]).toEqual(id === me ? s.hand?.cards?.hole[id] : [null, null])
      }
    }
    // p1 сбросил, двое дошли до вскрытия: их карты видят все, карты сбросившего — только он сам
    s = play(s, [call('p0'), fold('p1'), check('p2')], roundtrip)
    s = play(s, [check('p2'), check('p0'), check('p2'), check('p0'), check('p2'), check('p0')], roundtrip)
    expect(s.hand).toBeNull()
    expect(s.lastHand?.record?.shown).toEqual({ p0: ['Ah', 'Ad'], p2: ['2c', '7d'] })
    for (const me of ['p0', 'p2', null]) {
      const text = JSON.stringify(viewFor(s, me))
      expect(text).not.toContain('"Kh"')
      expect(text).not.toContain('"Qh"')
      expect(text).toContain('"Ah"')
      expect(text).toContain('"7d"')
    }
    // В записи раздачи карты сбросившего — только среди закрытых (#278): видны лишь ему
    expect(s.lastHand?.record?.hidden).toEqual({ p1: ['Kh', 'Qh'] })
    expect(viewFor(s, 'p1').lastHand?.record?.hidden).toEqual({ p1: ['Kh', 'Qh'] })
    for (const me of ['p0', 'p2', null]) expect(viewFor(s, me).lastHand?.record?.hidden).toEqual({})
  })

  it('сбросивший показывает после раздачи одну, затем все; во время раздачи и после новой — нет (#278)', () => {
    const t = newTable(['p0', 'p1', 'p2'], PHONES)
    // Кнопка p0, сдача с p1: у p1 — Kh Qh, у p2 — 2c 7d, у p0 — Ah Ad
    const deck = stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s'])
    let s = play(t, [start('p0', deck), call('p0'), fold('p1')], roundtrip)
    // Раздача идёт — показывать нельзя: это подсказка оставшимся
    expect(tryStep(s, 'p1', { type: 'show', cards: [0] })).toBe('Показать карты можно, когда раздача кончится, — до новой')
    s = play(s, [check('p2'), check('p2'), check('p0'), check('p2'), check('p0'), check('p2'), check('p0')], roundtrip)
    expect(s.hand).toBeNull()
    // Дошедшие до вскрытия показали всё — показывать им нечего
    expect(tryStep(s, 'p0', { type: 'show', cards: [0] })).toBe('Показать карты может взявший банк без вскрытия или сбросивший — до новой раздачи')
    s = play(s, [{ from: 'p1', msg: { type: 'show', cards: [1] } }], roundtrip)
    expect(s.lastHand?.record?.shown.p1).toEqual([null, 'Qh'])
    expect(s.lastHand?.record?.hidden).toEqual({ p1: ['Kh', 'Qh'] })
    for (const me of ['p0', 'p2', null]) {
      const text = JSON.stringify(viewFor(s, me))
      expect(text).not.toContain('"Kh"')
      expect(text).toContain('"Qh"')
    }
    s = play(s, [{ from: 'p1', msg: { type: 'show', cards: [0] } }], roundtrip)
    expect(s.lastHand?.record?.shown.p1).toEqual(['Kh', 'Qh'])
    expect(s.lastHand?.record?.hidden).toEqual({})
    expect(JSON.stringify(viewFor(s, 'p2'))).toContain('"Kh"')
    // Новая раздача — показывать прошлую поздно
    s = play(s, [start('p0', deckFor(HOLDEM_GAME))], roundtrip)
    expect(tryStep(s, 'p1', { type: 'show', cards: [0] })).toBe('Показать карты можно, когда раздача кончится, — до новой')
  })

  it('сбросивший показывает обе разом; карты сбросившего, не показавшего, не уходят другим (#278)', () => {
    const t = newTable(['p0', 'p1', 'p2'], PHONES)
    const deck = stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']])
    // p0 повышает, p1 и p2 сбрасывают: p0 берёт без вскрытия
    let s = play(t, [start('p0', deck), raise('p0', 30), fold('p1'), fold('p2')], roundtrip)
    expect(s.lastHand?.record?.hidden).toEqual({ p0: ['Ah', 'Ad'], p1: ['Kh', 'Qh'], p2: ['2c', '7d'] })
    expect(viewFor(s, 'p0').lastHand?.record?.hidden).toEqual({ p0: ['Ah', 'Ad'] })
    expect(viewFor(s, 'p1').lastHand?.record?.hidden).toEqual({ p1: ['Kh', 'Qh'] })
    expect(viewFor(s, 'p2').lastHand?.record?.hidden).toEqual({ p2: ['2c', '7d'] })
    expect(viewFor(s, null).lastHand?.record?.hidden).toEqual({})
    s = play(s, [{ from: 'p2', msg: { type: 'show', cards: [0, 1] } }], roundtrip)
    expect(s.lastHand?.record?.shown).toEqual({ p2: ['2c', '7d'] })
    expect(s.lastHand?.record?.hidden).toEqual({ p0: ['Ah', 'Ad'], p1: ['Kh', 'Qh'] })
    const text = JSON.stringify(viewFor(s, 'p0'))
    expect(text).toContain('"7d"')
    expect(text).not.toContain('"Kh"')
  })

  it('запись до #278 — один взявший без вскрытия: читается и «Показать» работает', () => {
    const t = newTable(['p0', 'p1'], PHONES)
    let s = play(t, [start('p0', stackedDeck([['Kc', 'Kd'], ['As', '7h']])), raise('p0', 30), fold('p1')], roundtrip)
    // Как записывали до #278: карт сбросившего нет, у взявшего — { playerId, cards }
    s.lastHand!.record!.hidden = { playerId: 'p0', cards: ['As', '7h'] }
    expect(viewFor(s, 'p0').lastHand?.record?.hidden).toEqual({ p0: ['As', '7h'] })
    expect(JSON.stringify(viewFor(s, 'p1'))).not.toContain('"As"')
    expect(tryStep(s, 'p1', { type: 'show', cards: [0] })).toBe('Показать карты может взявший банк без вскрытия или сбросивший — до новой раздачи')
    s = play(s, [{ from: 'p0', msg: { type: 'show', cards: [0] } }], roundtrip)
    expect(s.lastHand?.record?.shown).toEqual({ p0: ['As', null] })
    expect(s.lastHand?.record?.hidden).toEqual({ p0: ['As', '7h'] })
  })

  it('олл-ин до ривера: стол досдаётся, карты открываются, банк отдаётся сам', () => {
    // Хедз-ап: кнопка p0 ставит малый и ходит первой; сдача — с p1
    const t = newTable(['p0', 'p1'], PHONES)
    const deck = stackedDeck([['Kc', 'Kd'], ['As', 'Ah']], ['2s', '7h', '9d', 'Jc', '3s'])
    const s = play(t, [start('p0', deck), allin('p0'), call('p1')], roundtrip)
    expect(s.hand).toBeNull()
    const last = s.lastHand!
    expect(last.record?.board).toEqual(['2s', '7h', '9d', 'Jc', '3s'])
    expect(last.record?.shown).toEqual({ p0: ['As', 'Ah'], p1: ['Kc', 'Kd'] })
    expect(last.record?.hands).toEqual({ p0: 'Пара, тузы', p1: 'Пара, короли' })
    // Лучшая пятёрка у каждого дошедшего: сначала пара, затем кикеры по старшинству
    expect(last.record?.best).toEqual({ p0: ['As', 'Ah', 'Jc', '9d', '7h'], p1: ['Kc', 'Kd', 'Jc', '9d', '7h'] })
    expect(last.pots).toEqual([{ amount: 2000, winners: ['p0'] }])
    expect(s.players.map((p) => p.chips)).toEqual([2000, 0])
  })

  it('досдача с флопа: на столе было 3 карты — стало 5', () => {
    const t = newTable(['p0', 'p1'], PHONES)
    const deck = stackedDeck([['Kc', 'Kd'], ['As', 'Ah']], ['Ks', '7h', '9d', 'Jc', '3s'])
    let s = play(t, [start('p0', deck), call('p0'), check('p1')], roundtrip)
    expect(s.hand?.cards?.board).toEqual(['Ks', '7h', '9d'])
    s = play(s, [raise('p1', 100), allin('p0'), call('p1')], roundtrip)
    expect(s.lastHand?.record?.board).toEqual(['Ks', '7h', '9d', 'Jc', '3s'])
    expect(s.lastHand?.record?.hands.p1).toBe('Тройка, короли')
    expect(s.players.map((p) => p.chips)).toEqual([0, 2000])
  })

  it('побочные банки и ничья: короткий берёт основной, двое делят побочный', () => {
    const t = newTable(['p0', 'p1', 'p2'], PHONES, { p0: 100, p1: 300, p2: 300 })
    // Кнопка p0 (ходит первой на троих), сдача с p1
    const deck = stackedDeck([['Kh', 'Qh'], ['Kd', 'Qc'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s'])
    const s = play(t, [start('p0', deck), allin('p0'), allin('p1'), call('p2')], roundtrip)
    expect(s.lastHand?.pots).toEqual([
      { amount: 300, winners: ['p0'] },
      { amount: 400, winners: ['p1', 'p2'] },
    ])
    expect(s.lastHand?.payouts).toEqual({ p0: 300, p1: 200, p2: 200 })
    expect(s.players.map((p) => p.chips)).toEqual([300, 200, 200])
    expect(s.lastHand?.record?.hands).toEqual({
      p0: 'Пара, тузы',
      p1: 'Старшая карта, король',
      p2: 'Старшая карта, король',
    })
    expect(s.lastHand?.record?.best).toEqual({
      p0: ['Ah', 'Ad', 'Jc', '9d', '7h'],
      p1: ['Kh', 'Qh', 'Jc', '9d', '7h'],
      p2: ['Kd', 'Qc', 'Jc', '9d', '7h'],
    })
  })

  it('ничья с нечётной фишкой — лишняя первому по кругу от кнопки', () => {
    const t = newTable(['p0', 'p1', 'p2'], PHONES, { p0: 5, p1: 1000, p2: 1000 })
    // У p1 и p2 одинаковый стрит до туза, у p0 — старшая карта
    const deck = stackedDeck([['Ad', '3d'], ['Ac', '4h'], ['2c', '3c']], ['Ts', 'Js', 'Qd', 'Kc', '7h'])
    const steps = [start('p0', deck), allin('p0'), call('p1'), check('p2')]
    for (let k = 0; k < 3; k++) steps.push(check('p1'), check('p2'))
    const s = play(t, steps, roundtrip)
    // Основной 15 на двоих — 8 и 7 (лишняя p1: он первый после кнопки), побочный 10 — по 5
    expect(s.lastHand?.pots).toEqual([
      { amount: 15, winners: ['p1', 'p2'] },
      { amount: 10, winners: ['p1', 'p2'] },
    ])
    expect(s.players.map((p) => p.chips)).toEqual([0, 1003, 1002])
  })

  it('все сбросили — банк без вскрытия; «Показать» одну, затем вторую', () => {
    const t = newTable(['p0', 'p1'], PHONES)
    const deck = stackedDeck([['Kc', 'Kd'], ['As', '7h']])
    let s = play(t, [start('p0', deck), raise('p0', 30), fold('p1')], roundtrip)
    expect(s.hand).toBeNull()
    const record = s.lastHand!.record!
    expect(record.shown).toEqual({})
    expect(record.hands).toEqual({})
    expect(record.best).toEqual({}) // без вскрытия пятёрки нет
    expect(record.board).toEqual([])
    // Взявший и сбросивший (#278) — у каждого свои закрытые
    expect(record.hidden).toEqual({ p0: ['As', '7h'], p1: ['Kc', 'Kd'] })
    expect(s.players.map((p) => p.chips)).toEqual([1010, 990])
    // Чужому телефону карты взявшего не уходят, ему — да
    expect(JSON.stringify(viewFor(s, 'p1'))).not.toContain('"As"')
    expect(JSON.stringify(viewFor(s, 'p0'))).not.toContain('"Kc"')
    expect(viewFor(s, 'p0').lastHand?.record?.hidden).toEqual({ p0: ['As', '7h'] })

    expect(tryStep(s, 'p2', { type: 'show', cards: [0] })).toBe('Вас нет за столом')
    expect(tryStep(s, 'p0', { type: 'show', cards: [] })).toBe('Выберите, какие карты показать')
    expect(tryStep(s, 'p0', { type: 'show', cards: [2] })).toBe('Выберите, какие карты показать')
    s = play(s, [{ from: 'p0', msg: { type: 'show', cards: [1] } }], roundtrip)
    expect(s.lastHand?.record?.shown).toEqual({ p0: [null, '7h'] })
    expect(JSON.stringify(viewFor(s, 'p1'))).not.toContain('"As"')
    expect(JSON.stringify(viewFor(s, 'p1'))).toContain('"7h"')
    s = play(s, [{ from: 'p0', msg: { type: 'show', cards: [0] } }], roundtrip)
    expect(s.lastHand?.record?.shown).toEqual({ p0: ['As', '7h'] })
    expect(s.lastHand?.record?.hidden).toEqual({ p1: ['Kc', 'Kd'] })
  })

  it('запись раздачи: места со стеками в начале, ходы по кругам, общие карты, кто что взял', () => {
    const t = newTable(['p0', 'p1'], PHONES)
    const deck = stackedDeck([['Kc', 'Kd'], ['As', 'Ah']], ['2s', '7h', '9d', 'Jc', '3s'])
    const steps: Step[] = [start('p0', deck), call('p0'), check('p1'), raise('p1', 50), call('p0')]
    for (let k = 0; k < 2; k++) steps.push(check('p1'), check('p0'))
    const s = play(t, steps, roundtrip)
    const r = s.lastHand!.record!
    expect(r.seats).toEqual([
      { id: 'p0', name: 'P0', chips: 1000 },
      { id: 'p1', name: 'P1', chips: 1000 },
    ])
    expect(r.button).toBe(0)
    expect([r.sb, r.bb]).toEqual([5, 10])
    expect(r.log.map((e) => [e.street, e.playerId, e.type])).toEqual([
      ['preflop', 'p0', 'call'],
      ['preflop', 'p1', 'check'],
      ['flop', 'p1', 'raise'],
      ['flop', 'p0', 'call'],
      ['turn', 'p1', 'check'],
      ['turn', 'p0', 'check'],
      ['river', 'p1', 'check'],
      ['river', 'p0', 'check'],
    ])
    expect(s.lastHand?.payouts).toEqual({ p0: 120 })
    expect(s.players.map((p) => p.chips)).toEqual([1060, 940])
  })

  it('ведущий не отмечает победителя — банки раздаются сами', () => {
    const t = newTable(['p0', 'p1'], PHONES)
    const s = play(t, [start('p0', deckFor(HOLDEM_GAME))], roundtrip)
    expect(tryStep(s, 'p0', { type: 'award', winners: [['p0']] })).toBe('Банки раздаются сами — по картам')
  })

  it('без колоды или с чужой колодой раздача не начинается', () => {
    const t = newTable(['p0', 'p1'], PHONES)
    expect(tryStep(t, 'p0', { type: 'start' })).toBe('Нет колоды — раздача не начата')
    const r = handle(t, 'p0', { v: PROTOCOL_VERSION, type: 'start' }, 0, ['Ah', 'Ah'])
    expect(r).toEqual({ ok: false, error: 'Нет колоды — раздача не начата' })
  })

  it('правка стека — как раньше, с записью в журнал', () => {
    const t = newTable(['p0', 'p1'], PHONES)
    const s = play(t, [{ from: 'p0', msg: { type: 'setStack', playerId: 'p1', chips: 500 } }], roundtrip)
    expect(s.chipLog.at(-1)).toMatchObject({ kind: 'set', playerId: 'p1', from: 1000, to: 500 })
  })
})

// Своя игра с открытыми (#226): «3 карты, из них 1 открытая» — третья карта каждого видна всем
const OPEN3: OwnGame = { id: 'own-open3', name: 'Три с открытой', hole: 3, up: 1, fromHand: 'any', deck: 52, order: 'standard', board: [3, 1, 1], limit: 'nolimit' }
const OPEN = { cards: 'phones' as const, games: [OPEN3], game: OPEN3.id }

describe.each(MODES)('открытые карты своей игры (%s)', (_, roundtrip) => {
  // Кнопка p0 (ходит первой на троих), сдача с p1: p1, p2, p0 — по две закрытые, затем по одной открытой
  const P1: Card[] = ['Ah', 'Ad', '7c']
  const P2: Card[] = ['Qc', 'Jc', '9d']
  const P0: Card[] = ['9h', '9c', 'Ac']
  const BOARD: Card[] = ['Kh', '8s', '3d', '2c', '6h']
  const dealt = () => play(newTable(['p0', 'p1', 'p2'], OPEN), [start('p0', stackedDeck([P1, P2, P0], BOARD))], roundtrip)

  it('соперник видит у моего места открытую картой, закрытые — рубашкой; хозяин — все; колоды нет', () => {
    const s = dealt()
    expect(s.hand?.cards?.hole).toEqual({ p1: P1, p2: P2, p0: P0 })
    expect(s.hand?.cards?.open).toEqual({ p0: [2], p1: [2], p2: [2] })
    for (const me of ['p0', 'p1', 'p2', null]) {
      const view = viewFor(s, me)
      expect(view.hand?.cards?.deck).toEqual([])
      expect(leaks(view, s, me ?? '').filter((c) => ![P0[2], P1[2], P2[2]].includes(c))).toEqual([])
      for (const [id, hand] of [['p0', P0], ['p1', P1], ['p2', P2]] as [string, Card[]][]) {
        expect(view.hand?.cards?.hole[id]).toEqual(id === me ? hand : [null, null, hand[2]])
      }
    }
    // Закрытые соперников — ни строчкой
    const text = JSON.stringify(viewFor(s, 'p1'))
    for (const c of ['9h', '9c', 'Qc', 'Jc']) expect(text).not.toContain(`"${c}"`)
  })

  it('сбросивший: его открытая — в записи раздачи, закрытые — только ему; на ва-банке открытые сбросивших — вне колоды досдачи', () => {
    // p0 повышает, p1 отвечает, p2 сбрасывает; флоп — чек, на тёрне ва-банк и колл
    const steps: Step[] = [raise('p0', 40), call('p1'), fold('p2'), check('p1'), check('p0'), allin('p1'), call('p0')]
    const s = play(dealt(), steps, roundtrip)
    expect(s.hand).toBeNull()
    const record = s.lastHand!.record!
    expect(record.shown).toEqual({ p0: P0, p1: P1, p2: [null, null, '9d'] })
    expect(record.hidden).toEqual({ p2: P2 })
    for (const me of ['p0', 'p1', null]) {
      const text = JSON.stringify(viewFor(s, me))
      expect(text).not.toContain('"Qc"')
      expect(text).not.toContain('"Jc"')
    }
    // Ва-банк на тёрне: у p0 (две девятки и туз) против тузов p1 выигрывает только девятка на ривере (последний туз даст
    // p1 тройку). Девятка бубен — открытая
    // у сбросившего p2: в колоде досдачи из 41 карты одна девятка — 1/41 ≈ 2 %, а не 2/42 ≈ 5 %
    const odds = allInOdds(record)
    expect(odds?.street).toBe('turn')
    expect(odds?.players).toEqual([
      { id: 'p0', name: 'P0', percent: 2 },
      { id: 'p1', name: 'P1', percent: 98 },
    ])
    expect(percents(equity(HOLDEM, [P0, P1], BOARD.slice(0, 4), 5)!)).toEqual([5, 95])
  })

  it('взял банк без вскрытия: открытые — в записи, закрытые — у взявшего, «Показать» открывает остальные', () => {
    // Все сбросили перед p0: его открытая и открытые сбросивших — видели все
    let s = play(dealt(), [raise('p0', 40), fold('p1'), fold('p2')], roundtrip)
    const record = s.lastHand!.record!
    expect(record.shown).toEqual({ p0: [null, null, 'Ac'], p1: [null, null, '7c'], p2: [null, null, '9d'] })
    expect(record.hidden).toEqual({ p0: P0, p1: P1, p2: P2 })
    const theirs = JSON.stringify(viewFor(s, 'p1'))
    expect(theirs).not.toContain('"9h"')
    expect(theirs).not.toContain('"9c"')
    expect(theirs).toContain('"Ac"')
    expect(viewFor(s, 'p0').lastHand?.record?.hidden).toEqual({ p0: P0 })
    // Показать одну закрытую — открытая на месте; вторую — открыто всё
    s = play(s, [{ from: 'p0', msg: { type: 'show', cards: [0] } }], roundtrip)
    expect(s.lastHand?.record?.shown.p0).toEqual(['9h', null, 'Ac'])
    expect(s.lastHand?.record?.hidden).toEqual({ p0: P0, p1: P1, p2: P2 })
    s = play(s, [{ from: 'p0', msg: { type: 'show', cards: [1] } }], roundtrip)
    expect(s.lastHand?.record?.shown.p0).toEqual(P0)
    expect(s.lastHand?.record?.hidden).toEqual({ p1: P1, p2: P2 })
    // Сбросивший показывает свою закрытую — открытая на месте
    s = play(s, [{ from: 'p2', msg: { type: 'show', cards: [1] } }], roundtrip)
    expect(s.lastHand?.record?.shown.p2).toEqual([null, 'Jc', '9d'])
  })
})

describe('живые карты — как раньше', () => {
  it('новый стол по умолчанию — живые; колода не нужна, карт у раздачи нет', () => {
    const t = newTable(['p0', 'p1'])
    expect(t.settings.cards).toBe('live')
    const s = play(t, [start('p0'), fold('p0')], false)
    expect(s.hand?.stage).toBe('showdown')
    expect(s.hand?.cards).toBeUndefined()
    expect(viewFor(s, 'p1')).toBe(s)
  })

  it('стол, сохранённый до этапа 2 (без настройки карт), доигрывается живыми', () => {
    const t = newTable(['p0', 'p1'])
    const old = JSON.parse(JSON.stringify(t)) as TableState
    delete (old.settings as Partial<TableState['settings']>).cards
    const s = play(old, [start('p0'), fold('p0'), { from: 'p0', msg: { type: 'award', winners: [['p1']] } }], true)
    expect(s.lastHand).toEqual({ number: 1, pots: [{ amount: 10, winners: ['p1'] }], payouts: { p1: 10 } })
  })
})
