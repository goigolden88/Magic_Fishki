import { describe, expect, it } from 'vitest'
import { bestHand, buildDeck, compareHands, HOLDEM, OMAHA, SHORT_DECK, type Card } from '../poker/cards'
import { deckFor, HOLDEM_GAME, OMAHA_GAME, SHORT_DECK_GAME, shuffle } from '../poker/game'
import { handScore } from './allInOdds'
import { PROTOCOL_VERSION } from '../poker/protocol'
import { createTable, handle, viewFor, type Result, type TableState } from '../poker/table'
import type { RandomBytes } from '../poker/tokens'
import { botMove, preflopStrength, seededRandom, type BotLevel, type Random } from './bot'
import { toActId } from './localTable'

const LEVELS: BotLevel[] = ['novice', 'amateur', 'strong']

function ok(r: Result): TableState {
  if (!r.ok) throw new Error(r.error)
  return r.state
}

// Случайные байты колоды из повторимого случая
function bytesOf(random: Random): RandomBytes {
  return (b) => {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(random() * 256)
    return b
  }
}

// Стол на n мест, карты на телефонах, холдем; ids — p0…p(n−1) по местам
function table(n: number, stack = 1000): TableState {
  let t = ok(createTable('p0', 'Игрок 0', { sb: 5, bb: 10, startingStack: stack, maxSeats: n, cards: 'phones', game: 'holdem' }, 0))
  for (let i = 1; i < n; i++) t = ok(handle(t, `p${i}`, { v: PROTOCOL_VERSION, type: 'sit', name: `Игрок ${i}` }, 0))
  return t
}

const start = (t: TableState, deck: Card[]) => ok(handle(t, 'p0', { v: PROTOCOL_VERSION, type: 'start' }, 0, deck))

// Колода, где у мест заданные карты (первая раздача: кнопка — место 0, сдача по кругу с места 1)
function riggedDeck(n: number, holes: Record<number, [Card, Card]>): Card[] {
  const deck: (Card | null)[] = Array(52).fill(null)
  for (const [seat, cards] of Object.entries(holes)) {
    const p = (Number(seat) - 1 + n) % n
    deck[p] = cards[0]
    deck[n + p] = cards[1]
  }
  const used = new Set(deck.filter((c) => c !== null))
  const rest = buildDeck(HOLDEM).filter((c) => !used.has(c))
  return deck.map((c) => c ?? (rest.shift() as Card))
}

// Ход того, чья очередь, — решением бота по его виду стола
function botAct(t: TableState, level: BotLevel, random: Random): TableState {
  const id = toActId(t) as string
  const move = botMove(viewFor(t, id), id, level, random)
  if (!move) throw new Error('бот не нашёл хода')
  const r = handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action: move }, 0)
  if (!r.ok) throw new Error(`${level}: недопустимый ход ${JSON.stringify(move)} — ${r.error}`)
  return r.state
}

describe('бот покера', () => {
  for (const level of LEVELS) {
    it(`${level}: каждый ход допустим по правилам — сотня случайных раздач`, () => {
      const random = seededRandom(level.length * 7919)
      for (let k = 0; k < 100; k++) {
        // Стол заново: от двух до шести мест, стеки — и короткие, и глубокие
        let t = table(2 + (k % 5), 50 + Math.floor(random() * 2000))
        t = start(t, shuffle(deckFor(HOLDEM_GAME), bytesOf(random)))
        let moves = 0
        while (t.hand) {
          t = botAct(t, level, random)
          if (++moves > 200) throw new Error('раздача не кончается')
        }
      }
    })
  }

  it('не читает чужих карт: весь стол и вид стола глазами бота — один ответ, чужие карты не влияют', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const random = seededRandom(seed)
      let t = start(table(4), shuffle(deckFor(HOLDEM_GAME), bytesOf(random)))
      // Доходим до флопа: все уравнивают
      while (t.hand && t.hand.stage === 'preflop') {
        const id = toActId(t) as string
        const seat = t.hand.seats.find((s) => s.id === id)
        const action = seat && seat.bet < t.hand.currentBet ? { type: 'call' as const } : { type: 'check' as const }
        t = ok(handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action }, 0))
      }
      if (!t.hand) continue
      const id = toActId(t) as string
      // Чужие закрытые — другие карты из колоды
      const swapped = structuredClone(t)
      const cards = swapped.hand!.cards!
      const others = Object.keys(cards.hole).filter((x) => x !== id)
      for (const o of others) cards.hole[o] = cards.deck.splice(0, 2)
      for (const level of LEVELS) {
        const fromView = botMove(viewFor(t, id), id, level, seededRandom(seed))
        expect(botMove(t, id, level, seededRandom(seed))).toEqual(fromView)
        expect(botMove(swapped, id, level, seededRandom(seed))).toEqual(fromView)
      }
      expect(Object.entries(viewFor(t, id).hand!.cards!.hole).filter(([x]) => x !== id).flatMap(([, c]) => c)).toEqual(
        others.flatMap(() => [null, null]),
      )
    }
  })

  it('с тем же случаем — тот же ответ; со случаем разным — бывает разный', () => {
    const t = start(table(6), riggedDeck(6, { 3: ['Jh', 'Td'] }))
    for (const level of LEVELS) {
      const a = Array.from({ length: 20 }, (_, i) => botMove(viewFor(t, 'p3'), 'p3', level, seededRandom(i)))
      const b = Array.from({ length: 20 }, (_, i) => botMove(viewFor(t, 'p3'), 'p3', level, seededRandom(i)))
      expect(a).toEqual(b)
    }
    const moves = new Set(
      Array.from({ length: 50 }, (_, i) => JSON.stringify(botMove(viewFor(t, 'p3'), 'p3', 'novice', seededRandom(i)))),
    )
    expect(moves.size).toBeGreaterThan(1)
  })

  it('не его ход — null', () => {
    const t = start(table(6), riggedDeck(6, {}))
    expect(botMove(viewFor(t, 'p4'), 'p4', 'strong', seededRandom(1))).toBeNull()
  })

  it('«Сильный» с AA до флопа не пасует — первым и после повышения', () => {
    for (let seed = 0; seed < 100; seed++) {
      const first = start(table(6), riggedDeck(6, { 3: ['Ah', 'As'] }))
      const move = botMove(viewFor(first, 'p3'), 'p3', 'strong', seededRandom(seed))
      expect(move?.type).not.toBe('fold')

      // UTG повысил до 30, CO с тузами отвечает
      const raised = ok(
        handle(start(table(6), riggedDeck(6, { 5: ['Ad', 'Ac'] })), 'p3', { v: PROTOCOL_VERSION, type: 'act', action: { type: 'raise', to: 30 } }, 0),
      )
      const r1 = ok(handle(raised, 'p4', { v: PROTOCOL_VERSION, type: 'act', action: { type: 'fold' } }, 0))
      expect(botMove(viewFor(r1, 'p5'), 'p5', 'strong', seededRandom(seed))?.type).not.toBe('fold')

      // Олл-ин перед ним больше его стека — колл
      const shove = ok(
        handle(start(table(6), riggedDeck(6, { 5: ['Ad', 'Ac'] })), 'p3', { v: PROTOCOL_VERSION, type: 'act', action: { type: 'allin' } }, 0),
      )
      const r2 = ok(handle(shove, 'p4', { v: PROTOCOL_VERSION, type: 'act', action: { type: 'fold' } }, 0))
      expect(botMove(viewFor(r2, 'p5'), 'p5', 'strong', seededRandom(seed))?.type).not.toBe('fold')
    }
  })

  it('с 72 разной масти на ранней позиции «Сильный» пасует чаще «Новичка»', () => {
    const t = start(table(6), riggedDeck(6, { 3: ['7h', '2c'] }))
    const folds = (level: BotLevel) =>
      Array.from({ length: 200 }, (_, i) => botMove(viewFor(t, 'p3'), 'p3', level, seededRandom(i))).filter((m) => m?.type === 'fold')
        .length
    const strong = folds('strong')
    const novice = folds('novice')
    expect(strong).toBeGreaterThan(novice)
    expect(strong).toBeGreaterThan(180) // почти всегда
    expect(novice).toBeLessThan(100) // редко
  })

  it('быстрый счёт руки для досдач — тот же порядок, что у bestHand (холдем, омаха, шорт-дек)', () => {
    const random = seededRandom(5)
    for (const [variant, game, size] of [
      [HOLDEM, HOLDEM_GAME, 2],
      [OMAHA, OMAHA_GAME, 4],
      [SHORT_DECK, SHORT_DECK_GAME, 2],
    ] as const) {
      for (let k = 0; k < 200; k++) {
        const deck = shuffle(deckFor(game), bytesOf(random))
        const board = deck.slice(0, 3 + (k % 3))
        const a = deck.slice(5, 5 + size)
        const b = deck.slice(5 + size, 5 + 2 * size)
        const fast = Math.sign(handScore(variant, a, board) - handScore(variant, b, board))
        expect(fast).toBe(Math.sign(compareHands(bestHand(variant, a, board), bestHand(variant, b, board))))
      }
    }
  })

  it('сила до флопа: тузы — 1, 7-2 разной масти — 0, одномастные сильнее', () => {
    expect(preflopStrength(['Ah', 'As'])).toBe(1)
    expect(preflopStrength(['7h', '2c'])).toBe(0)
    expect(preflopStrength(['Ah', 'Kh'])).toBeGreaterThan(preflopStrength(['Ah', 'Kc']))
    expect(preflopStrength(['Kh', 'Ks'])).toBeGreaterThan(preflopStrength(['Ah', 'Kh']))
  })
})
