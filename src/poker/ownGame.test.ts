import { describe, expect, it } from 'vitest'
import { random } from '../calc/allInOdds'
import { HOLDEM, OMAHA, SHORT_DECK, type Card } from './cards'
import { deckFor, HOLDEM_GAME, isDeckOf, OMAHA_GAME, SHORT_DECK_GAME, shuffle, type GameDef } from './game'
import { ownGameDef, ownGameError, ownGamesError, parseOwnGames, seatsFor, type OwnGame } from './ownGame'
import { PROTOCOL_VERSION, VERSION_ERROR, type ClientBody } from './protocol'
import type { RandomBytes } from './tokens'
import { createTable, gameFor, handle, limitFor, type Settings, type TableState } from './table'
import { allin, call, fold, MODES, newTable, play, stackedDeck, start, type Step } from './testing'

// Встроенные, записанные своими играми
const OWN_HOLDEM: OwnGame = { id: 'own-holdem', name: 'Свой холдем', hole: 2, fromHand: 'any', deck: 52, order: 'standard', board: [3, 1, 1], limit: 'nolimit' }
const OWN_OMAHA: OwnGame = { ...OWN_HOLDEM, id: 'own-omaha', name: 'Своя омаха', hole: 4, fromHand: 2, limit: 'pot' }
const OWN_SHORT: OwnGame = { ...OWN_HOLDEM, id: 'own-short', name: 'Свой шорт-дек', deck: 36, order: 'shortdeck' }
const omahaOf = (hole: number): OwnGame => ({ ...OWN_OMAHA, id: `own-omaha${hole}`, name: `Омаха-${hole}`, hole })

// Одна и та же случайность для обеих колод
function bytesOf(seed: number): RandomBytes {
  const next = random(seed)
  return (b) => {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(next() * 256)
    return b
  }
}

const own = (game: OwnGame, extra: Partial<Settings> = {}): Partial<Settings> => ({ cards: 'phones', games: [game], game: game.id, ...extra })

// Раздача до конца без ставок: кто ходит — чек, а если нельзя — колл
function checkDown(state: TableState, rt: boolean): TableState {
  let s = state
  for (let i = 0; i < 100 && s.hand && s.hand.toAct !== -1; i++) {
    const seat = s.hand.seats[s.hand.toAct]
    const action = seat.bet < s.hand.currentBet ? { type: 'call' as const } : { type: 'check' as const }
    s = play(s, [{ from: seat.id, msg: { type: 'act', action } }], rt)
  }
  return s
}

// Итог раздачи без мест и времени: карты, лучшие руки, банки и выплаты
const outcome = (s: TableState) => {
  const r = s.lastHand?.record
  return { board: r?.board, shown: r?.shown, hands: r?.hands, best: r?.best, pots: s.lastHand?.pots, payouts: s.lastHand?.payouts }
}

describe('своя игра: описание в GameDef', () => {
  it('холдем, омаха и шорт-дек своими играми — те же правило руки и круги, что у встроенных', () => {
    for (const [mine, builtIn] of [
      [OWN_HOLDEM, HOLDEM_GAME],
      [OWN_OMAHA, OMAHA_GAME],
      [OWN_SHORT, SHORT_DECK_GAME],
    ] as [OwnGame, GameDef][]) {
      const def = ownGameDef(mine)
      expect(def).toMatchObject({ id: mine.id, name: mine.name })
      expect(def.variant).toEqual(builtIn.variant)
      expect(def.rounds).toEqual(builtIn.rounds)
      expect(deckFor(def)).toEqual(deckFor(builtIn))
    }
    expect(ownGameDef(OWN_HOLDEM).variant).toEqual(HOLDEM)
    expect(ownGameDef(OWN_OMAHA).variant).toEqual(OMAHA)
    expect(ownGameDef(OWN_SHORT).variant).toEqual(SHORT_DECK)
  })

  it.each(MODES)('сдают и считают руки так же, как встроенные: та же колода — те же карты, победители и выплаты (%s)', (_, rt) => {
    const pairs: [OwnGame, GameDef, Partial<Settings>][] = [
      [OWN_HOLDEM, HOLDEM_GAME, { game: 'holdem' }],
      [OWN_OMAHA, OMAHA_GAME, { game: 'omaha', limit: 'pot' }],
      [OWN_SHORT, SHORT_DECK_GAME, { game: 'shortdeck' }],
    ]
    for (const [mine, builtIn, settings] of pairs) {
      for (let seed = 1; seed <= 6; seed++) {
        const ids = ['p0', 'p1', 'p2', 'p3', 'p4'].slice(0, 2 + (seed % 4))
        const a = newTable(ids, { cards: 'phones', ...settings })
        const b = newTable(ids, own(mine))
        expect(limitFor(b.settings)).toBe(limitFor(a.settings))
        const deckA = shuffle(deckFor(builtIn), bytesOf(seed))
        const deckB = shuffle(deckFor(ownGameDef(mine)), bytesOf(seed))
        expect(deckB).toEqual(deckA)
        const doneA = checkDown(play(a, [start('p0', deckA)], rt), rt)
        const doneB = checkDown(play(b, [start('p0', deckB)], rt), rt)
        expect(doneB.lastHand?.record?.game).toMatchObject({ id: mine.id, name: mine.name })
        expect(outcome(doneB)).toEqual(outcome(doneA))
        expect(doneB.players).toEqual(doneA.players)
      }
    }
  })
})

describe('омаха на 5, 6 и 7 карт («ровно 2»)', () => {
  // Хедз-ап: кнопка p0, сдача — сначала p1. На столе четыре пики: у p0 одна пика (и ни одной пары со столом
  // старше четвёрок), у p1 — две двойки к двойке на столе. По правилу «любые» у p0 был бы роял-флеш
  const P0: Card[] = ['Ts', '3c', '4d', '3h', '4h', '5c', '6c']
  const P1: Card[] = ['2c', '2h', '7d', '8c', '9d', '7h', '8h']
  const BOARD: Card[] = ['As', 'Ks', 'Qs', 'Js', '2d']

  it.each([5, 6, 7])('%i карт: сдача, лучшая рука — ровно две из руки, банк — сильнейшему', (hole) => {
    const game = omahaOf(hole)
    expect(ownGameError(game)).toBeNull()
    const t = newTable(['p0', 'p1'], own(game, { maxSeats: seatsFor(game) }))
    const deck = stackedDeck([P1.slice(0, hole), P0.slice(0, hole)], BOARD)
    const dealt = play(t, [start('p0', deck)], false)
    expect(dealt.hand?.cards?.hole.p0).toEqual(P0.slice(0, hole))
    expect(dealt.hand?.cards?.hole.p1).toEqual(P1.slice(0, hole))
    expect(dealt.hand?.limit).toBe('pot')
    const done = checkDown(dealt, false)
    const record = done.lastHand?.record
    expect(record?.board).toEqual(BOARD)
    expect(record?.hands).toEqual({ p0: 'Пара, четвёрки', p1: 'Тройка, двойки' })
    expect(record?.best?.p1).toEqual(['2c', '2h', '2d', 'As', 'Ks'])
    expect(done.lastHand?.pots).toEqual([{ amount: 20, winners: ['p1'] }])
    expect(done.lastHand?.payouts).toEqual({ p1: 20 })
    expect(done.players.map((p) => p.chips)).toEqual([990, 1010])
  })

  it('с тремя игроками — два банка: основной и побочный по своим претендентам', () => {
    const game: OwnGame = { ...omahaOf(6), limit: 'nolimit' }
    // p2 — короткий стек, у него лучшая рука; основной банк — ему, побочный — p1 против p0
    const t = newTable(['p0', 'p1', 'p2'], own(game, { maxSeats: 6 }), { p2: 100 })
    const P2: Card[] = ['Kd', 'Kh', '9c', '9h', '5d', '6d'] // ровно две: KdKh + Ks — тройка королей
    // Кнопка p0; сдача с p1: p1, p2, p0
    const deck = stackedDeck([P1.slice(0, 6), P2, P0.slice(0, 6)], BOARD)
    const s = play(t, [start('p0', deck), allin('p0'), call('p1'), call('p2')], false)
    const r = checkDown(s, false)
    expect(r.lastHand?.record?.hands.p2).toBe('Тройка, короли')
    expect(r.lastHand?.pots).toEqual([
      { amount: 300, winners: ['p2'] },
      { amount: 1800, winners: ['p1'] },
    ])
    expect(r.lastHand?.payouts).toEqual({ p2: 300, p1: 1800 })
  })
})

describe('своя игра: отказы описания', () => {
  const bad = (change: Record<string, unknown>) => ownGameError({ ...OWN_OMAHA, ...change })

  it('карт на руках 1 и 8', () => {
    expect(bad({ hole: 1, fromHand: 'any' })).toBe('„Своя омаха“: карт на руках — от 2 до 7')
    expect(bad({ hole: 8 })).toBe('„Своя омаха“: карт на руках — от 2 до 7')
  })

  it('из руки «ровно 0» и «ровно 6», «ровно 3» при двух картах, «ровно 1» при трёх картах стола', () => {
    expect(bad({ fromHand: 0 })).toBe('„Своя омаха“: из руки — любые или ровно от 1 до 4')
    expect(bad({ hole: 7, fromHand: 6 })).toBe('„Своя омаха“: из руки — любые или ровно от 1 до 5')
    expect(bad({ fromHand: 1.5 })).toBe('„Своя омаха“: из руки — любые или ровно от 1 до 4')
    expect(bad({ hole: 2, fromHand: 3 })).toBe('„Своя омаха“: из руки ровно 3, а карт на руках 2')
    // bestHand берёт со стола ровно 5 − N
    expect(bad({ fromHand: 1, board: [3] })).toBe('„Своя омаха“: из руки ровно 1 — нужно карт стола 4, а их 3')
    expect(bad({ fromHand: 1, board: [3, 1] })).toBeNull()
    expect(bad({ hole: 5, fromHand: 5, board: [3] })).toBeNull()
  })

  it('карт стола 2 и 6; круг из 0 и из 4 карт; четыре круга', () => {
    expect(bad({ board: [2] })).toBe('„Своя омаха“: карт стола — от 3 до 5, а не 2')
    expect(bad({ board: [3, 3] })).toBe('„Своя омаха“: карт стола — от 3 до 5, а не 6')
    expect(bad({ board: [0, 3] })).toBe('„Своя омаха“: в круге стола — от 1 до 3 карт')
    expect(bad({ board: [4, 1] })).toBe('„Своя омаха“: в круге стола — от 1 до 3 карт')
    expect(bad({ board: [1, 1, 1, 1] })).toBe('„Своя омаха“: кругов карт стола — от 1 до 3')
    expect(bad({ board: [] })).toBe('„Своя омаха“: кругов карт стола — от 1 до 3')
    expect(bad({ board: [1, 1, 1] })).toBeNull()
    expect(bad({ board: [2, 3] })).toBeNull()
  })

  it('название пустое, из пробелов, длиннее 24 знаков', () => {
    expect(bad({ name: '' })).toBe('У своей игры нет названия')
    expect(bad({ name: '   ' })).toBe('У своей игры нет названия')
    expect(bad({ name: 'О'.repeat(25) })).toBe('Название своей игры — не длиннее 24 знаков')
    expect(bad({ name: 'О'.repeat(24) })).toBeNull()
    expect(bad({ name: 7 })).toBe('У своей игры нет названия')
  })

  it('колода 40, лимит не тот, старшинство не то', () => {
    expect(bad({ deck: 40 })).toBe('„Своя омаха“: колода — 52 или 36 карт')
    expect(bad({ limit: 'fixed' })).toBe('„Своя омаха“: лимит — без лимита или пот-лимит')
    expect(bad({ order: 'lowball' })).toBe('„Своя омаха“: старшинство — обычное или как в шорт-деке')
  })

  it('лишние и битые поля, id без приставки', () => {
    expect(bad({ up: 1 })).toBe('В описании своей игры лишнее поле «up»')
    expect(bad({ hole: '4' })).toBe('„Своя омаха“: карт на руках — от 2 до 7')
    expect(bad({ board: '3,1,1' })).toBe('„Своя омаха“: кругов карт стола — от 1 до 3')
    expect(bad({ board: [3, '1', 1] })).toBe('„Своя омаха“: в круге стола — от 1 до 3 карт')
    expect(ownGameError(null)).toBe('Своя игра — не описание игры')
    expect(ownGameError([OWN_OMAHA])).toBe('Своя игра — не описание игры')
    expect(bad({ id: 'omaha6' })).toBe('Своя игра без верного id')
    expect(bad({ id: 'omaha' })).toBe('Своя игра без верного id')
    expect(bad({ id: 'own-' })).toBe('Своя игра без верного id')
    expect(bad({ id: undefined })).toBe('Своя игра без верного id')
  })

  it('из памяти и копии: битые и повторы — мимо, не список — пусто', () => {
    expect(parseOwnGames([OWN_OMAHA, { ...OWN_OMAHA, hole: 9 }, OWN_HOLDEM, { ...OWN_OMAHA, name: 'Повтор' }])).toEqual([OWN_OMAHA, OWN_HOLDEM])
    expect(parseOwnGames('битое')).toEqual([])
    expect(parseOwnGames(null)).toEqual([])
  })
})

describe('своя игра: версия протокола', () => {
  it('19 — старое приложение (18) за стол не пускают: «обновите приложение»', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(19) // свои игры — с версии 19; 20 — страддл (#222)
    const r = handle(newTable(['p0', 'p1'], own(OWN_HOLDEM)), 'p0', { v: 18, type: 'start' }, 0, deckFor(HOLDEM_GAME))
    expect(r).toEqual({ ok: false, error: VERSION_ERROR })
  })
})

describe('своя игра: места за столом', () => {
  it('меньшее из 10 и ⌊(колода − карты стола) / карт на руках⌋', () => {
    expect(seatsFor(omahaOf(7))).toBe(6)
    expect(seatsFor({ ...omahaOf(5), deck: 36 })).toBe(6)
    expect(seatsFor({ ...omahaOf(7), deck: 36 })).toBe(4)
    expect(seatsFor(OWN_HOLDEM)).toBe(10)
    expect(seatsFor(OWN_OMAHA)).toBe(10)
    expect(seatsFor(OWN_SHORT)).toBe(10)
  })

  it('стол, где мест больше, чем хватит карт на любую его свою игру, — отказ', () => {
    const omaha7 = omahaOf(7)
    expect(createTable('h', 'H', own(omaha7, { maxSeats: 9 }), 0)).toEqual({
      ok: false,
      error: '„Омаха-7“: за столом не больше 6 — карт на всех не хватит',
    })
    expect(createTable('h', 'H', own(omaha7, { maxSeats: 6 }), 0).ok).toBe(true)
    // И когда эта игра — не текущая, а одна из своих для «Микса»
    expect(createTable('h', 'H', { cards: 'phones', mix: true, maxSeats: 7, games: [OWN_HOLDEM, omaha7] }, 0)).toMatchObject({ ok: false })
    expect(ownGamesError([OWN_HOLDEM, omaha7], 6)).toBeNull()
  })
})

describe.each(MODES)('стол со своими играми (%s)', (_, rt) => {
  const refuse = (s: TableState, from: string, body: ClientBody, deck?: Card[]) => {
    const r = handle(s, from, { ...body, v: PROTOCOL_VERSION }, 0, deck)
    return r.ok ? null : r.error
  }
  const created = (settings: Partial<Settings>) => {
    const r = createTable('h', 'H', settings, 0)
    return r.ok ? null : r.error
  }

  it('settings.games — до восьми, id без повторов; game — встроенная или своя игра стола; своя — только на телефонах', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...OWN_HOLDEM, id: `own-g${i}` }) as OwnGame)
    expect(created({ cards: 'phones', games: many.slice(0, 8) })).toBeNull()
    expect(created({ cards: 'phones', games: many })).toBe('Своих игр за столом — не больше 8')
    expect(created({ cards: 'phones', games: [OWN_HOLDEM, { ...OWN_OMAHA, id: OWN_HOLDEM.id }] })).toBe('Своя игра „Своя омаха“ — дважды')
    expect(created({ cards: 'phones', games: [{ ...OWN_HOLDEM, hole: 8 }] })).toBe('„Свой холдем“: карт на руках — от 2 до 7')
    expect(created({ cards: 'phones', games: 'нет' as never })).toBe('Свои игры — списком')
    expect(created({ cards: 'phones', game: 'own-nope', games: [OWN_HOLDEM] })).toBe('Такой своей игры за этим столом нет')
    expect(created({ cards: 'phones', game: 'own-nope' })).toBe('Такой своей игры за этим столом нет')
    expect(created({ ...own(OWN_HOLDEM), cards: 'live' })).toBe('Свои игры — только с картами на телефонах')
    expect(created({ cards: 'live', game: OWN_HOLDEM.id })).toBe('Своя игра — только с картами на телефонах')
    expect(created({ cards: 'live', games: [] })).toBeNull()
    expect(created({ cards: 'phones', game: 'stud' as never })).toBe('Игра — холдем, омаха или шорт-дек')
  })

  it('старые столы без games — как раньше: холдем, омаха — пот-лимит, шорт-дек — без лимита', () => {
    expect(gameFor(newTable(['p0', 'p1'], { cards: 'phones' }).settings)).toBe(HOLDEM_GAME)
    expect(gameFor(newTable(['p0', 'p1'], { cards: 'phones', game: 'omaha' }).settings)).toBe(OMAHA_GAME)
    expect(limitFor({ ...newTable(['p0', 'p1'], { game: 'omaha' }).settings })).toBe('pot')
    expect(limitFor({ ...newTable(['p0', 'p1'], { game: 'shortdeck' }).settings })).toBe('nolimit')
    expect(gameFor(newTable(['p0', 'p1']).settings)).toBeNull()
  })

  it('раздача своей игры: колода 36, круги стола 1-2-2, лимит из описания', () => {
    const game: OwnGame = { id: 'own-odd', name: 'Чудная', hole: 3, fromHand: 'any', deck: 36, order: 'shortdeck', board: [1, 2, 2], limit: 'pot' }
    const t = newTable(['p0', 'p1', 'p2'], own(game))
    const def = gameFor(t.settings)!
    expect(def).toEqual(ownGameDef(game))
    expect(limitFor(t.settings)).toBe('pot')
    expect(refuse(t, 'p0', { type: 'start' }, deckFor(HOLDEM_GAME))).toBe('Нет колоды — раздача не начата')
    const deck = shuffle(deckFor(def), bytesOf(7))
    expect(isDeckOf(def, deck)).toBe(true)
    let s = play(t, [start('p0', deck)], rt)
    expect(s.hand?.limit).toBe('pot')
    expect(s.hand?.cards?.hole.p0).toHaveLength(3)
    expect(s.hand?.cards?.board).toEqual([])
    // Префлоп: p0 (кнопка) — колл, p1 — колл, p2 — чек; на «флопе» — одна карта
    s = play(s, [call('p0'), call('p1'), { from: 'p2', msg: { type: 'act', action: { type: 'check' } } }], rt)
    expect(s.hand?.stage).toBe('flop')
    expect(s.hand?.cards?.board).toHaveLength(1)
    const done = checkDown(s, rt)
    expect(done.lastHand?.record?.board).toHaveLength(5)
    expect(done.lastHand?.record?.game.rounds.map((r) => r.street)).toEqual(['preflop', 'flop', 'turn', 'river'])
    expect(Object.values(done.lastHand?.payouts ?? {}).reduce((a, b) => a + b, 0)).toBe(30)
  })

  it('«Прогнать несколько раз» (Р-58) — по описанию своей игры: каждый борд своей длины', () => {
    const game: OwnGame = { ...omahaOf(5), id: 'own-two', name: 'Два круга', board: [3, 2], limit: 'nolimit' }
    const t = newTable(['p0', 'p1'], own(game, { maxRuns: 2, maxSeats: 6 }))
    const choose = (from: string): Step => ({ from, msg: { type: 'runChoice', times: 2 } })
    const s = play(t, [start('p0', shuffle(deckFor(ownGameDef(game)), bytesOf(3))), allin('p0'), call('p1'), choose('p0'), choose('p1')], rt)
    const runs = s.lastHand?.record?.runs
    expect(runs).toHaveLength(2)
    for (const r of runs ?? []) expect(r.board).toHaveLength(5)
    expect(Object.values(s.lastHand?.payouts ?? {}).reduce((a, b) => a + b, 0)).toBe(2000)
  })

  it('«Микс» (Р-57): батон предлагает свою игру стола; чужой id — отказ; после смены — её колода и лимит', () => {
    const omaha6 = omahaOf(6)
    const t = newTable(['p0', 'p1', 'p2', 'p3'], { cards: 'phones', mix: true, games: [OWN_HOLDEM, omaha6], maxSeats: 6 })
    const after = play(t, [start('p0', deckFor(HOLDEM_GAME)), fold('p3'), fold('p0'), fold('p1')], rt)
    expect(refuse(after, 'p0', { type: 'mixPropose', game: 'own-other' })).toBe('Такой своей игры за этим столом нет')
    const vote = (from: string): Step => ({ from, msg: { type: 'mixVote', yes: true } })
    const changed = play(after, [{ from: 'p0', msg: { type: 'mixPropose', game: omaha6.id } }, vote('p1'), vote('p2'), vote('p3')], rt)
    expect(changed.mixResult).toMatchObject({ from: 'holdem', game: omaha6.id, changed: true })
    expect(changed.settings.game).toBe(omaha6.id)
    expect(limitFor(changed.settings)).toBe('pot')
    const next = play(changed, [start('p0', shuffle(deckFor(ownGameDef(omaha6)), bytesOf(5)))], rt)
    expect(next.hand?.cards?.game).toEqual(ownGameDef(omaha6))
    expect(next.hand?.cards?.hole.p1).toHaveLength(6)
    expect(next.hand?.limit).toBe('pot')
    expect(checkDown(next, rt).lastHand?.record?.game.name).toBe('Омаха-6')
  })
})
