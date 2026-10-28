import { describe, expect, it } from 'vitest'
import { HOLDEM_GAME, deckFor } from './game'
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
    // p1 сбросил, двое дошли до вскрытия: их карты видят все, карты сбросившего — никто
    s = play(s, [call('p0'), fold('p1'), check('p2')], roundtrip)
    s = play(s, [check('p2'), check('p0'), check('p2'), check('p0'), check('p2'), check('p0')], roundtrip)
    expect(s.hand).toBeNull()
    expect(s.lastHand?.record?.shown).toEqual({ p0: ['Ah', 'Ad'], p2: ['2c', '7d'] })
    for (const me of ['p0', 'p1', 'p2']) {
      const text = JSON.stringify(viewFor(s, me))
      expect(text).not.toContain('"Kh"')
      expect(text).not.toContain('"Qh"')
      expect(text).toContain('"Ah"')
      expect(text).toContain('"7d"')
    }
    expect(JSON.stringify(s)).not.toContain('"Qh"') // и в записи раздачи карт сбросившего нет
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
    expect(record.hidden).toEqual({ playerId: 'p0', cards: ['As', '7h'] })
    expect(s.players.map((p) => p.chips)).toEqual([1010, 990])
    // Чужому телефону карты взявшего не уходят, ему — да
    expect(JSON.stringify(viewFor(s, 'p1'))).not.toContain('"As"')
    expect(viewFor(s, 'p0').lastHand?.record?.hidden?.cards).toEqual(['As', '7h'])

    expect(tryStep(s, 'p1', { type: 'show', cards: [0] })).toBe('Показать карты может взявший банк без вскрытия — до новой раздачи')
    expect(tryStep(s, 'p0', { type: 'show', cards: [] })).toBe('Выберите, какие карты показать')
    expect(tryStep(s, 'p0', { type: 'show', cards: [2] })).toBe('Выберите, какие карты показать')
    s = play(s, [{ from: 'p0', msg: { type: 'show', cards: [1] } }], roundtrip)
    expect(s.lastHand?.record?.shown).toEqual({ p0: [null, '7h'] })
    expect(JSON.stringify(viewFor(s, 'p1'))).not.toContain('"As"')
    expect(JSON.stringify(viewFor(s, 'p1'))).toContain('"7h"')
    s = play(s, [{ from: 'p0', msg: { type: 'show', cards: [0] } }], roundtrip)
    expect(s.lastHand?.record?.shown).toEqual({ p0: ['As', '7h'] })
    expect(s.lastHand?.record?.hidden).toBeNull()
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
