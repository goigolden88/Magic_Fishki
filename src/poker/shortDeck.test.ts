import { describe, expect, it } from 'vitest'
import { SHORT_DECK } from './cards'
import { deckFor, SHORT_DECK_GAME } from './game'
import { createTable, type Settings, type TableState } from './table'
import { call, check, MODES, newTable, play, stackedDeck, start } from './testing'

const SHORT: Partial<Settings> = { cards: 'phones', game: 'shortdeck' }

// Хедз-ап до вскрытия: кнопка p0, сдача с p1; hole — [карты p1, карты p0]
function showdown(hole: string[][], board: string[], roundtrip: boolean): TableState {
  const deck = stackedDeck(hole, board, SHORT_DECK)
  let s = play(newTable(['p0', 'p1'], SHORT), [start('p0', deck), call('p0'), check('p1')], roundtrip)
  for (let k = 0; k < 3; k++) s = play(s, [check('p1'), check('p0')], roundtrip)
  return s
}

describe.each(MODES)('шорт-дек (%s)', (_, roundtrip) => {
  it('раздача: колода 36 без двоек–пятёрок и без повторов, по две карты, без лимита', () => {
    const deck = deckFor(SHORT_DECK_GAME)
    expect(deck).toHaveLength(36)
    expect(deck.some((c) => '2345'.includes(c[0]))).toBe(false)
    let s = play(newTable(['p0', 'p1', 'p2'], SHORT), [start('p0', deck)], roundtrip)
    expect(s.hand?.cards?.game.id).toBe('shortdeck')
    expect(s.hand?.limit).toBeUndefined()
    expect(s.hand?.cards?.hole.p1).toHaveLength(2)
    s = play(s, [call('p0'), call('p1'), check('p2')], roundtrip)
    s = play(s, [check('p1'), check('p2'), check('p0'), check('p1'), check('p2'), check('p0')], roundtrip)
    expect(s.hand?.stage).toBe('river')
    const c = s.hand!.cards!
    const all = [...c.deck, ...c.board, ...Object.values(c.hole).flat()]
    expect(all).toHaveLength(36)
    expect(new Set(all).size).toBe(36)
  })

  it('банк: флеш старше фулл-хауса', () => {
    // По правилу холдема выиграл бы фулл-хаус p0
    const s = showdown([['Ah', 'Th'], ['Ks', '9s']], ['Kh', 'Kd', '9h', '7h', '6c'], roundtrip)
    expect(s.hand).toBeNull()
    expect(s.lastHand?.pots).toEqual([{ amount: 20, winners: ['p1'] }])
    expect(s.lastHand?.record?.hands).toEqual({ p1: 'Флеш, старший туз', p0: 'Фулл-хаус, короли и девятки' })
  })

  it('банк: A-6-7-8-9 — стрит, и он старше тройки', () => {
    const s = showdown([['Ad', '9c'], ['Kd', 'Ks']], ['6c', '7d', '8s', 'Kh', 'Qc'], roundtrip)
    expect(s.lastHand?.pots).toEqual([{ amount: 20, winners: ['p1'] }])
    expect(s.lastHand?.record?.hands).toEqual({ p1: 'Стрит до девятки', p0: 'Тройка, короли' })
  })
})

it('шорт-дек с живыми картами: без карт в раздаче и без лимита', () => {
  const s = play(newTable(['p0', 'p1', 'p2'], { cards: 'live', game: 'shortdeck' }), [start('p0')], false)
  expect(s.hand?.cards).toBeUndefined()
  expect(s.hand?.limit).toBeUndefined()
  expect(createTable('h', 'H', { game: 'shortdeck' }, 0).ok).toBe(true)
})
