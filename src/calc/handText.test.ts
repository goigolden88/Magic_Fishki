import { describe, expect, it } from 'vitest'
import { deckFor, HOLDEM_GAME } from '../poker/game'
import type { HistoryHand } from '../poker/history'
import { hiddenOf } from '../poker/table'
import { call, check, fold, newTable, play, raise, stackedDeck, start } from '../poker/testing'
import { botsEvening, eveningTable, roomEvening, savedHands, type EveningTable, type SavedHand } from './evenings'
import { handsFileName, handsText, handText } from './handText'
import type { OwnGame } from '../poker/ownGame'
import { historyHandView } from './pokerView'

const PHONES = { cards: 'phones' as const }

// Трое: кнопка P0, малый P1, большой P2. Раздача 1 — до вскрытия, раздача 2 — все сбросили на рейз P1
function evening() {
  const t = newTable(['p0', 'p1', 'p2'], PHONES)
  const deck = stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s'])
  const streets = [check('p1'), check('p0')]
  const s1 = play(t, [start('p0', deck), raise('p0', 30), call('p1'), fold('p2'), ...streets, ...streets, ...streets], false)
  const first = s1.lastHand as HistoryHand
  const s2 = play(s1, [start('p0', deckFor(HOLDEM_GAME)), raise('p1', 30), fold('p2'), fold('p0')], false)
  const second = s2.lastHand as HistoryHand
  return { table: s2, first, second }
}

function saved(me: string | null, hand: HistoryHand, mine?: string[]): SavedHand {
  const { table } = evening()
  const e = roomEvening('KQ7MZP', table, me)
  return savedHands(e, [hand], mine ? new Map([[hand.number, mine]]) : undefined)[0]
}

describe('своя игра (#224): выгрузка и история называют её названием, улицы — по её кругам', () => {
  const game: OwnGame = { id: 'own-o5', name: 'Омаха-5', hole: 5, fromHand: 2, deck: 52, order: 'standard', board: [2, 2, 1], limit: 'pot' }
  const t = newTable(['p0', 'p1'], { cards: 'phones', games: [game], game: game.id })
  // Хедз-ап: кнопка P0, сдача — сначала P1
  const hole = [
    ['2c', '3c', '4c', '5c', '6c'],
    ['Ah', 'Ad', 'Kh', 'Kd', 'Qh'],
  ]
  const deck = stackedDeck(hole, ['7s', '8s', '9d', 'Td', 'Js'])
  const pass = [check('p1'), check('p0')]
  const s = play(t, [start('p0', deck), call('p0'), check('p1'), ...pass, ...pass, ...pass], false)
  const hand = s.lastHand as HistoryHand
  const one = savedHands(roomEvening('KQ7MZP', s, 'p0'), [hand], new Map([[hand.number, hole[1]]]))[0]

  it('шапка — названием и лимитом своей игры, улицы — по две, две и одной карте', () => {
    expect(one.table?.game).toBe('own-o5')
    const text = handText(one)
    expect(text.split('\n')[0]).toMatch(/^PokerStars Hand #\d+0001: Омаха-5 Pot Limit \(5\/10\) - /)
    expect(text).toContain('Dealt to P0 [Ah Ad Kh Kd Qh]')
    expect(text).toContain('*** FLOP *** [7s 8s]\nP1: checks')
    expect(text).toContain('*** TURN *** [7s 8s] [9d Td]')
    expect(text).toContain('*** RIVER *** [7s 8s 9d Td] [Js]')
    expect(text).toContain('Board [7s 8s 9d Td Js]')
  })

  it('история раздачи: шапка — названием, у улиц — карты стола к ним', () => {
    const view = historyHandView(one)
    expect(view.head).toBe('Омаха-5, пот-лимит · блайнды 5/10')
    expect(view.streets.map((x) => x.board.length)).toEqual([0, 2, 4, 5])
  })
})

describe('страддл (#222): выгрузка и история раздачи', () => {
  // Вчетвером: кнопка P0, малый P1, большой P2, страддл P3 — 20. P0 повышает до 60, все пас — 40 вернулись P0
  const t = newTable(['p0', 'p1', 'p2', 'p3'], { ...PHONES, straddle: true })
  const s = play(t, [start('p0', deckFor(HOLDEM_GAME)), raise('p0', 60), fold('p1'), fold('p2'), fold('p3')], false)
  const hand = s.lastHand as HistoryHand
  const one = savedHands(roomEvening('KQ7MZP', s, 'p0'), [hand])[0]

  it('строка «posts straddle» после блайндов, рейз — от страддла', () => {
    const text = handText(one)
    expect(text).toContain('P1: posts small blind 5\nP2: posts big blind 10\nP3: posts straddle 20\n*** HOLE CARDS ***')
    expect(text).toContain('P0: raises 40 to 60\nP1: folds\nP2: folds\nP3: folds\nUncalled bet (40) returned to P0\nP0 collected 55 from pot')
  })

  it('история: «страддл 20» в шапке и первым ходом префлопа, банк префлопа — с ним', () => {
    const view = historyHandView(one)
    expect(view.head).toBe('Холдем, без лимита · блайнды 5/10, страддл 20')
    expect(view.streets[0].moves).toEqual(['P3: страддл 20', 'P0: рейз до 60', 'P1: пас', 'P2: пас', 'P3: пас'])
    expect(view.streets[0].pot).toBe(35)
  })
})

describe('выгрузка раздачи текстом покер-румов', () => {
  const { first, second } = evening()

  it('шапка, места, блайнды, ходы по улицам, вскрытие и итог', () => {
    const text = handText(saved('p2', first, ['2c', '7d']))
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^PokerStars Hand #\d+0001: Hold'em No Limit \(5\/10\) - \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(lines[1]).toBe("Table 'Стол KQ7MZP' 9-max Seat #1 is the button")
    expect(lines.slice(2, 5)).toEqual(['Seat 1: P0 (1000 in chips)', 'Seat 2: P1 (1000 in chips)', 'Seat 3: P2 (1000 in chips)'])
    expect(text).toContain('P1: posts small blind 5\nP2: posts big blind 10\n*** HOLE CARDS ***\nDealt to P2 [2c 7d]')
    expect(text).toContain('P0: raises 20 to 30\nP1: calls 25\nP2: folds\n*** FLOP *** [2s 7h 9d]\nP1: checks\nP0: checks')
    expect(text).toContain('*** TURN *** [2s 7h 9d] [Jc]')
    expect(text).toContain('*** RIVER *** [2s 7h 9d Jc] [3s]')
    expect(text).toMatch(/\*\*\* SHOW DOWN \*\*\*\nP0: shows \[Ah Ad\] \(.+\)\nP1: shows \[Kh Qh\] \(.+\)\nP0 collected 70 from pot/)
    expect(text).toContain('*** SUMMARY ***\nTotal pot 70 | Rake 0\nBoard [2s 7h 9d Jc 3s]')
    expect(text).toMatch(/Seat 1: P0 \(button\) showed \[Ah Ad\] and won \(70\) with .+/)
    expect(text).toMatch(/Seat 2: P1 \(small blind\) showed \[Kh Qh\] and lost with .+/)
    expect(text).toContain('Seat 3: P2 (big blind) folded before Flop')
  })

  it('банк без вскрытия: непокрытая ставка вернулась, карты взявшего — только ему', () => {
    const hidden = hiddenOf(second.record)
    expect(Object.keys(hidden).sort()).toEqual(['p0', 'p1', 'p2'])
    const cards = hidden.p1.join(' ')

    // У сбросившего (#278) — свои карты из записи, чужих закрытых нет
    const theirs = handText(saved('p0', second))
    expect(theirs).toContain('P1: raises 20 to 30\nP2: folds\nP0: folds\nUncalled bet (20) returned to P1\nP1 collected 25 from pot')
    expect(theirs).toContain('Total pot 25 | Rake 0')
    expect(theirs).not.toContain(cards)
    expect(theirs).not.toContain(hidden.p2.join(' '))
    expect(theirs).toContain(`Dealt to P0 [${hidden.p0.join(' ')}]`)

    const mine = handText(saved('p1', second))
    expect(mine).toContain(`Dealt to P1 [${cards}]`)
    expect(mine).toContain('Seat 2: P1 (button) collected (25)')
  })

  it('чужие карты видны только вскрытые: карт сбросившего соседа в файле нет', () => {
    const text = handText(saved('p0', first))
    expect(text).toContain('Dealt to P0 [Ah Ad]')
    expect(text).not.toContain('2c 7d')
  })

  it('живые карты: без карт, блайнды — стола', () => {
    const live: HistoryHand = {
      number: 4,
      pots: [{ amount: 20, winners: ['a'] }],
      payouts: { a: 20 },
      live: {
        seats: [
          { id: 'a', name: 'Аня', chips: 500 },
          { id: 'b', name: 'Боря', chips: 400 },
        ],
        button: 0,
        log: [
          { street: 'preflop', playerId: 'a', type: 'call', bet: 10, allIn: false },
          { street: 'preflop', playerId: 'b', type: 'check', bet: 10, allIn: false },
          { street: 'flop', playerId: 'b', type: 'raise', bet: 20, allIn: false },
          { street: 'flop', playerId: 'a', type: 'fold', bet: 10, allIn: false },
        ],
      },
    }
    const table: EveningTable = { me: null, game: 'holdem', limit: 'nolimit', sb: 5, bb: 10, ante: 0, maxSeats: 9, tournament: false }
    const text = handText({ evening: 'local-X', code: null, startedAt: 0, number: 4, hand: live, table })
    expect(text).toContain("Hold'em No Limit (5/10)")
    expect(text).toContain("Table 'Стол на телефоне' 9-max Seat #1 is the button")
    expect(text).toContain('Аня: posts small blind 5\nБоря: posts big blind 10\n*** HOLE CARDS ***\nАня: calls 5\nБоря: checks\n*** FLOP ***\nБоря: bets 20\nАня: folds')
    expect(text).toContain('Uncalled bet (20) returned to Боря')
    expect(text).not.toContain('Dealt to')
  })

  it('все вечера — по порядку начала, в вечере — по номеру; против ботов — свой стол', () => {
    const { table, first: h1, second: h2 } = evening()
    const late = { ...roomEvening('KQ7MZP', table, 'p0'), id: 'late', startedAt: 10_000 }
    const bots = botsEvening('B1', table, 'p0')
    const text = handsText([...savedHands(late, [h2, h1]), ...savedHands(bots, [h1])])
    const heads = text.split('\n').filter((l) => l.startsWith('Table '))
    expect(heads).toEqual([
      "Table 'Против ботов' 9-max Seat #1 is the button",
      "Table 'Стол KQ7MZP' 9-max Seat #1 is the button",
      "Table 'Стол KQ7MZP' 9-max Seat #2 is the button",
    ])
    expect(text.split('\n\n\n')).toHaveLength(3)
    expect(handsText([])).toBe('')
  })

  it('омаха пот-лимит — в шапке; имена файлов', () => {
    const { table } = evening()
    const omaha = { ...eveningTable(table, 'p0'), game: 'omaha' as const, limit: 'pot' as const }
    const live: HistoryHand = { number: 1, pots: [], payouts: {}, live: { seats: [], button: 0, log: [] } }
    expect(handText({ evening: 'x', code: 'AAAAAA', startedAt: 0, number: 1, hand: live, table: omaha })).toContain('Omaha Pot Limit (5/10)')
    expect(handsFileName('2026-11-06')).toBe('fishki-hands-2026-11-06.txt')
    expect(handsFileName('2026-11-06', true)).toBe('fishki-hands-all-2026-11-06.txt')
  })
})
