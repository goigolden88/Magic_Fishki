import { describe, expect, it } from 'vitest'
import { actionsView } from '../calc/pokerView'
import { deckFor, OMAHA_GAME } from './game'
import { PROTOCOL_VERSION } from './protocol'
import { createTable, handle, viewFor, type Settings, type TableState } from './table'
import { allin, call, check, MODES, newTable, play, raise, stackedDeck, start } from './testing'

const OMAHA: Partial<Settings> = { cards: 'phones', game: 'omaha' }

// Ход в стол; отказ — текст
const tryAct = (s: TableState, from: string, action: Record<string, unknown>) => {
  const r = handle(s, from, { v: PROTOCOL_VERSION, type: 'act', action }, 0)
  return r.ok ? r.state : r.error
}

// Три игрока, блайнды 5/10, кнопка — p0: малый — p1, большой — p2, первым ходит p0
const three = (settings: Partial<Settings> = OMAHA) => play(newTable(['p0', 'p1', 'p2'], settings), [start('p0', deckFor(OMAHA_GAME))], false)

describe.each(MODES)('омаха (%s)', (_, roundtrip) => {
  it('раздача: каждому четыре карты, стол — 3, 1, 1; колода без повторов; чужие — рубашкой', () => {
    const deck = deckFor(OMAHA_GAME)
    let s = play(newTable(['p0', 'p1', 'p2'], OMAHA), [start('p0', deck)], roundtrip)
    const cards = s.hand!.cards!
    expect(cards.game.id).toBe('omaha')
    // По одной по кругу с p1: четыре круга
    expect(cards.hole.p1).toEqual([deck[0], deck[3], deck[6], deck[9]])
    expect(cards.hole.p0).toEqual([deck[2], deck[5], deck[8], deck[11]])
    expect(viewFor(s, 'p1').hand?.cards?.hole).toEqual({ p1: cards.hole.p1, p2: [null, null, null, null], p0: [null, null, null, null] })
    s = play(s, [call('p0'), call('p1'), check('p2')], roundtrip)
    expect(s.hand?.cards?.board).toEqual(deck.slice(12, 15))
    s = play(s, [check('p1'), check('p2'), check('p0'), check('p1'), check('p2'), check('p0')], roundtrip)
    expect(s.hand?.stage).toBe('river')
    const c = s.hand!.cards!
    const all = [...c.deck, ...c.board, ...Object.values(c.hole).flat()]
    expect(all).toHaveLength(52)
    expect(new Set(all).size).toBe(52)
  })

  it('банк отдаётся по правилу омахи: ровно две из руки и три со стола', () => {
    // Хедз-ап: кнопка p0, сдача с p1. На столе четыре черви: у p1 одна червь — флеша нет, только пара;
    // у p0 — тройка девяток. По правилу холдема выиграл бы флеш p1
    const deck = stackedDeck([['Kh', 'Kc', 'Qd', 'Js'], ['9c', '9d', 'Ts', '8s']], ['Ah', '9h', '6h', '3h', '2c'])
    let s = play(newTable(['p0', 'p1'], OMAHA), [start('p0', deck), call('p0'), check('p1')], roundtrip)
    for (let k = 0; k < 3; k++) s = play(s, [check('p1'), check('p0')], roundtrip)
    expect(s.hand).toBeNull()
    expect(s.lastHand?.pots).toEqual([{ amount: 20, winners: ['p0'] }])
    const record = s.lastHand!.record!
    expect(record.hands).toEqual({ p0: 'Тройка, девятки', p1: 'Пара, короли' })
    const best = record.best!.p0
    expect(best).toHaveLength(5)
    expect(best.filter((c) => ['9c', '9d', 'Ts', '8s'].includes(c))).toHaveLength(2)
    expect(best.filter((c) => record.board.includes(c))).toHaveLength(3)
  })
})

describe('пот-лимит', () => {
  it('у омахи по умолчанию; холдем и старые столы — без лимита', () => {
    expect(three().hand?.limit).toBe('pot')
    expect(three({ ...OMAHA, limit: 'nolimit' }).hand?.limit).toBeUndefined()
    expect(three({ cards: 'phones' }).hand?.limit).toBeUndefined()
    expect(three({ cards: 'phones' }).hand?.cards?.game.id).toBe('holdem')
    expect(three({ cards: 'live' }).hand?.limit).toBeUndefined()
  })

  it('живые карты: омаха с пот-лимитом — без карт, лимит считает программа', () => {
    const s = three({ cards: 'live', game: 'omaha' })
    expect(s.hand?.cards).toBeUndefined()
    expect(s.hand?.limit).toBe('pot')
    expect(tryAct(s, 'p0', { type: 'raise', to: 36 })).toBe('Не больше банка: 35')
  })

  it('префлоп с блайндами: пот — колл 10 и сверху банк 15 с этим коллом, до 35', () => {
    const s = three()
    const r = actionsView(s, 'p0')?.raise
    expect(r).toMatchObject({ min: 20, max: 35, allIn: false, potLimit: 35 })
    expect(r?.quick).toEqual([
      { label: 'Мин', to: 20 },
      { label: '½ банка', to: 22 },
      { label: 'Пот', to: 35 },
    ])
    expect(actionsView(s, 'p0')?.allIn).toBeNull()
    expect(tryAct(s, 'p0', { type: 'raise', to: 36 })).toBe('Не больше банка: 35')
    expect(tryAct(s, 'p0', { type: 'allin' })).toBe('Не больше банка: 35')
    const ok = tryAct(s, 'p0', { type: 'raise', to: 35 })
    expect(typeof ok).not.toBe('string')
  })

  it('после ставки и рейза: пот считается от всего, что на столе', () => {
    let s = play(three(), [raise('p0', 35)], false)
    // Малый (5 на столе): колл 30, банк 50 + 30 → до 35 + 80 = 115
    expect(actionsView(s, 'p1')?.raise?.max).toBe(115)
    expect(tryAct(s, 'p1', { type: 'raise', to: 116 })).toBe('Не больше банка: 115')
    s = play(s, [raise('p1', 115)], false)
    // Большой (10): колл 105, банк 160 + 105 → до 115 + 265 = 380
    expect(actionsView(s, 'p2')?.raise?.max).toBe(380)
    expect(tryAct(s, 'p2', { type: 'raise', to: 381 })).toBe('Не больше банка: 380')
    expect(typeof tryAct(s, 'p2', { type: 'raise', to: 380 })).not.toBe('string')
  })

  it('на флопе: первая ставка — до банка, рейз после неё — колл и банк с ним', () => {
    let s = play(three(), [call('p0'), call('p1'), check('p2')], false)
    expect(s.hand?.stage).toBe('flop')
    expect(actionsView(s, 'p1')?.raise).toMatchObject({ label: 'Ставка', min: 10, max: 30 })
    expect(tryAct(s, 'p1', { type: 'raise', to: 31 })).toBe('Не больше банка: 30')
    s = play(s, [raise('p1', 30)], false)
    // Колл 30, банк 60 + 30 → до 30 + 90 = 120
    expect(actionsView(s, 'p2')?.raise?.max).toBe(120)
    expect(tryAct(s, 'p2', { type: 'raise', to: 121 })).toBe('Не больше банка: 120')
  })

  it('стек меньше пота — олл-ин можно; олл-ин меньше минимального рейза — как в без-лимите', () => {
    const t = newTable(['p0', 'p1', 'p2'], OMAHA, { p0: 30, p2: 1000, p1: 1000 })
    let s = play(t, [start('p0', deckFor(OMAHA_GAME))], false)
    const a = actionsView(s, 'p0')
    expect(a?.raise).toMatchObject({ min: 20, max: 30, allIn: true, potLimit: 35 })
    expect(a?.allIn).toBe(30)
    s = play(s, [allin('p0')], false)
    expect(s.hand?.currentBet).toBe(30)
    // Олл-ин 15 при минимуме до 20 — можно
    const short = play(newTable(['p0', 'p1', 'p2'], OMAHA, { p0: 15 }), [start('p0', deckFor(OMAHA_GAME)), allin('p0')], false)
    expect(short.hand?.currentBet).toBe(15)
  })

  it('без лимита — олл-ин на весь стек, как в холдеме', () => {
    const s = three({ ...OMAHA, limit: 'nolimit' })
    expect(actionsView(s, 'p0')?.raise).toMatchObject({ max: 1000, allIn: true, potLimit: null })
    expect(typeof tryAct(s, 'p0', { type: 'allin' })).not.toBe('string')
  })

  it('незнакомая игра или лимит — отказ при создании стола', () => {
    expect(createTable('h', 'H', { game: 'stud' as never }, 0)).toEqual({ ok: false, error: 'Игра — холдем или омаха' })
    expect(createTable('h', 'H', { game: 'omaha', limit: 'fixed' as never }, 0)).toEqual({
      ok: false,
      error: 'Лимит — пот-лимит или без лимита',
    })
  })
})
