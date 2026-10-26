import { describe, expect, it } from 'vitest'
import { buildDeck, HOLDEM } from './cards'
import { cardsNeeded, dealRound, deckFor, HOLDEM_GAME, isDeckOf, newCards, publicCards, runOut, shuffle, type GameDef } from './game'

// Случайность для тестов: байты по кругу из заданных
const bytes = (...values: number[]) => {
  let k = 0
  return (b: Uint8Array<ArrayBuffer>) => {
    for (let i = 0; i < b.length; i++) b[i] = values[k++ % values.length]
    return b
  }
}

describe('колода и тасовка', () => {
  it('тасовка — та же колода без повторов и потерь', () => {
    const deck = deckFor(HOLDEM_GAME)
    for (let n = 0; n < 20; n++) {
      const shuffled = shuffle(deck)
      expect(shuffled).toHaveLength(52)
      expect(new Set(shuffled).size).toBe(52)
      expect([...shuffled].sort()).toEqual([...deck].sort())
      expect(isDeckOf(HOLDEM_GAME, shuffled)).toBe(true)
    }
    // Исходная колода не тронута
    expect(deck).toEqual(buildDeck(HOLDEM))
  })

  it('случайность — параметром: одни байты — один порядок', () => {
    const deck = deckFor(HOLDEM_GAME)
    expect(shuffle(deck, bytes(7, 1, 200, 3))).toEqual(shuffle(deck, bytes(7, 1, 200, 3)))
    expect(shuffle(deck, bytes(7, 1, 200, 3))).not.toEqual(deck)
  })

  it('без перекоса: число из хвоста, где n не укладывается целиком, берётся заново', () => {
    // n = 3: 0xFFFFFFFF — из хвоста, берётся следующее число 0 — третья меняется с первой;
    // n = 2: 0xFFFFFFFF годится — нечётное, вторая остаётся на месте
    const random = bytes(0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0)
    expect(shuffle(['a', 'b', 'c'], random)).toEqual(['c', 'b', 'a'])
  })

  it('колода описания: ровно его карты, каждая по разу', () => {
    const deck = deckFor(HOLDEM_GAME)
    expect(isDeckOf(HOLDEM_GAME, deck)).toBe(true)
    expect(isDeckOf(HOLDEM_GAME, deck.slice(1))).toBe(false)
    expect(isDeckOf(HOLDEM_GAME, [...deck.slice(1), deck[1]])).toBe(false)
    expect(isDeckOf(HOLDEM_GAME, undefined)).toBe(false)
    expect(cardsNeeded(HOLDEM_GAME, 10)).toBe(25)
  })
})

describe('сдача по описанию', () => {
  it('холдем: по две закрытых по кругу, затем флоп 3, тёрн 1, ривер 1', () => {
    const deck = deckFor(HOLDEM_GAME)
    const cards = newCards(HOLDEM_GAME, deck, ['a', 'b', 'c'])
    dealRound(cards, ['b', 'c', 'a'])
    expect(cards.hole).toEqual({ b: [deck[0], deck[3]], c: [deck[1], deck[4]], a: [deck[2], deck[5]] })
    expect(cards.board).toEqual([])
    expect(publicCards(cards, 'a')).toEqual([null, null])
    dealRound(cards, ['b', 'c', 'a'])
    expect(cards.board).toEqual(deck.slice(6, 9))
    runOut(cards, ['b', 'c', 'a'])
    expect(cards.board).toEqual(deck.slice(6, 11))
    expect(cards.deck).toEqual(deck.slice(11))
    expect(cards.dealt).toBe(4)
  })

  it('описание вмещает открытые карты и открытие своих: 2 в открытую и 1 в закрытую, затем третья открывается', () => {
    // Свой режим — только данными, для проверки описания
    const custom: GameDef = {
      id: 'test',
      variant: HOLDEM,
      rounds: [
        { street: 'preflop', deal: [{ kind: 'hole', down: 1, up: 2 }] },
        { street: 'flop', deal: [{ kind: 'flip', count: 1 }] },
        { street: 'turn', deal: [{ kind: 'board', count: 3 }] },
        { street: 'river', deal: [{ kind: 'board', count: 2 }] },
      ],
    }
    const deck = deckFor(custom)
    const cards = newCards(custom, deck, ['a', 'b'])
    dealRound(cards, ['a', 'b'])
    expect(cards.hole.a).toEqual([deck[0], deck[2], deck[4]])
    expect(publicCards(cards, 'a')).toEqual([null, deck[2], deck[4]])
    dealRound(cards, ['a', 'b'])
    expect(publicCards(cards, 'b')).toEqual([deck[1], deck[3], deck[5]])
    runOut(cards, ['a', 'b'])
    expect(cards.board).toEqual(deck.slice(6, 11))
    expect(cardsNeeded(custom, 2)).toBe(11)
  })
})
