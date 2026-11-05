import { describe, expect, it } from 'vitest'
import { bestHand, buildDeck, compareHands, HOLDEM, OMAHA, SHORT_DECK, type Card } from '../poker/cards'
import { deckFor, HOLDEM_GAME, OMAHA_GAME, SHORT_DECK_GAME, shuffle } from '../poker/game'
import { handScore } from './allInOdds'
import { HUD_FEW_HANDS, type Hud, type HudCounts } from '../poker/hud'
import { PROTOCOL_VERSION } from '../poker/protocol'
import { createTable, handle, viewFor, type Result, type TableState } from '../poker/table'
import type { RandomBytes } from '../poker/tokens'
import { botMove, LEVEL_STYLES, pickStyles, preflopStrength, PUSH_FOLD_BB, seededRandom, type BotStyle, type Random } from './bot'
import { COMBOS } from './botRanges'
import { bluffShare, boardInfo, quantiles, rangeOf, readHand } from './botRead'
import { toActId } from './localTable'

const LEVELS: BotStyle[] = LEVEL_STYLES.mixed
type BotLevel = BotStyle

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

// Колода, где у мест заданные карты (первая раздача: кнопка — место 0, сдача по кругу с места 1) и общие
function riggedDeck(n: number, holes: Record<number, [Card, Card]>, board: Card[] = []): Card[] {
  const deck: (Card | null)[] = Array(52).fill(null)
  for (const [seat, cards] of Object.entries(holes)) {
    const p = (Number(seat) - 1 + n) % n
    deck[p] = cards[0]
    deck[n + p] = cards[1]
  }
  board.forEach((c, i) => (deck[2 * n + i] = c))
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
      Array.from({ length: 50 }, (_, i) => JSON.stringify(botMove(viewFor(t, 'p3'), 'p3', 'maniac', seededRandom(i)))),
    )
    expect(moves.size).toBeGreaterThan(1)
  })

  it('не его ход — null', () => {
    const t = start(table(6), riggedDeck(6, {}))
    expect(botMove(viewFor(t, 'p4'), 'p4', 'tag', seededRandom(1))).toBeNull()
  })

  for (const style of ['tag', 'lag', 'abc', 'nit'] as const) {
    it(`${style} с AA до флопа не пасует — первым и после повышения`, () => {
      for (let seed = 0; seed < 100; seed++) {
        const first = start(table(6), riggedDeck(6, { 3: ['Ah', 'As'] }))
        const move = botMove(viewFor(first, 'p3'), 'p3', style, seededRandom(seed))
        expect(move?.type).not.toBe('fold')

        // UTG повысил до 30, CO с тузами отвечает
        const raised = ok(
          handle(start(table(6), riggedDeck(6, { 5: ['Ad', 'Ac'] })), 'p3', { v: PROTOCOL_VERSION, type: 'act', action: { type: 'raise', to: 30 } }, 0),
        )
        const r1 = ok(handle(raised, 'p4', { v: PROTOCOL_VERSION, type: 'act', action: { type: 'fold' } }, 0))
        expect(botMove(viewFor(r1, 'p5'), 'p5', style, seededRandom(seed))?.type).not.toBe('fold')

        // Олл-ин перед ним больше его стека — колл
        const shove = ok(
          handle(start(table(6), riggedDeck(6, { 5: ['Ad', 'Ac'] })), 'p3', { v: PROTOCOL_VERSION, type: 'act', action: { type: 'allin' } }, 0),
        )
        const r2 = ok(handle(shove, 'p4', { v: PROTOCOL_VERSION, type: 'act', action: { type: 'fold' } }, 0))
        expect(botMove(viewFor(r2, 'p5'), 'p5', style, seededRandom(seed))?.type).not.toBe('fold')
      }
    })
  }

  it('с 72 разной масти на ранней позиции ТАГ, ЛАГ, нит и ABC пасуют всегда; с J8 разной масти маньяк входит, ТАГ — нет', () => {
    const fold72 = start(table(6), riggedDeck(6, { 3: ['7h', '2c'] }))
    for (const style of ['tag', 'lag', 'nit', 'abc'] as const) {
      for (let i = 0; i < 50; i++) expect(botMove(viewFor(fold72, 'p3'), 'p3', style, seededRandom(i))?.type).toBe('fold')
    }
    const j8 = start(table(6), riggedDeck(6, { 3: ['Jh', '8c'] }))
    const enters = (style: BotStyle) =>
      Array.from({ length: 100 }, (_, i) => botMove(viewFor(j8, 'p3'), 'p3', style, seededRandom(i))).filter((m) => m?.type !== 'fold').length
    expect(enters('maniac')).toBeGreaterThan(90)
    expect(enters('tag')).toBe(0)
  })

  // Хедз-ап: p0 — кнопка и малый блайнд (ходит первым до флопа), p1 — большой. p0 открывает до 25, p1 уравнивает,
  // флоп и тёрн — чек-чек, на ривере p1 чек, p0 ставит банк (50 в 50). Ход p1: колл или пас
  const BOARD: Card[] = ['Kd', '8s', '4c', '2h', 'Jd']
  const OPP: [Card, Card] = ['Ah', 'Qc']
  function riverSpot(hole: [Card, Card]): TableState {
    const deck = riggedDeck(2, { 0: OPP, 1: hole }, BOARD)
    let t = start(table(2), deck)
    const act = (id: string, action: { type: 'check' | 'call' } | { type: 'raise'; to: number }) => {
      t = ok(handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action }, 0))
    }
    act('p0', { type: 'raise', to: 25 })
    act('p1', { type: 'call' })
    for (let k = 0; k < 2; k++) {
      act('p1', { type: 'check' })
      act('p0', { type: 'check' })
    }
    act('p1', { type: 'check' })
    act('p0', { type: 'raise', to: 50 })
    return t
  }

  it('ривер, ставка в банк: сильный уравнивает лучшей частью диапазона с частотой защиты банка, ABC пасует среднюю пару', () => {
    const base = riverSpot(['7c', '7s'])
    expect(toActId(base)).toBe('p1')
    const hand = base.hand!
    // Защита банка: 1 − ставка / (банк + ставка) = 1 − 50 / 100
    const mdf = 1 - 50 / (50 + 50)
    // Диапазон p1 — каким его видит соперник: защита большого блайнда, чеки на флопе, тёрне и ривере
    const own = rangeOf(readHand(hand), 'p1', 'tag', BOARD, [...BOARD, ...OPP])
    let total = 0
    let called = 0
    let checked = 0
    for (let c = 0; c < COMBOS.length; c++) {
      if (own[c] < 0.05) continue
      const hole: [Card, Card] = [COMBOS[c].a, COMBOS[c].b]
      const t = riverSpot(hole)
      const move = botMove(viewFor(t, 'p1'), 'p1', 'tag', seededRandom(c), { p0: 'tag' })
      total += own[c]
      if (move?.type === 'call' || move?.type === 'raise' || move?.type === 'allin') called += own[c]
      checked++
    }
    console.log(`Ривер, ставка в банк: рук в диапазоне ${checked}, уравнивает ${((100 * called) / total).toFixed(0)} % (защита банка — ${mdf * 100} %)`)
    expect(checked).toBeGreaterThan(200)
    // Не «пасует всё, кроме натсов»: уравнивает около половины диапазона
    expect(called / total).toBeGreaterThan(mdf - 0.15)
    expect(called / total).toBeLessThan(mdf + 0.2)

    // Средняя пара (восьмёрки на K-8-4-2-J): ABC пасует всегда, сильный — уравнивает хоть иногда
    const eights = riverSpot(['8h', '7h'])
    for (let seed = 0; seed < 30; seed++) {
      expect(botMove(viewFor(eights, 'p1'), 'p1', 'abc', seededRandom(seed), { p0: 'tag' })?.type).toBe('fold')
    }
    const strongCalls = Array.from({ length: 30 }, (_, seed) =>
      botMove(viewFor(eights, 'p1'), 'p1', 'tag', seededRandom(seed), { p0: 'tag' }),
    ).filter((m) => m?.type === 'call').length
    expect(strongCalls).toBeGreaterThan(0)
  })

  it('чтение соперника: крупная ставка — поляризованный диапазон с долей блефов от размера, мелкая — широкий, чек — без части сильнейших', () => {
    const t = riverSpot(['7c', '7s'])
    const read = readHand(t.hand!)
    const known = [...BOARD, '7c', '7s']
    const info = boardInfo(BOARD)
    // До ставки на ривере (ходы без последнего) и после
    const before = rangeOf({ ...read, moves: read.moves.slice(0, -1) }, 'p0', 'tag', BOARD, known)
    const big = rangeOf(read, 'p0', 'tag', BOARD, known)
    const small = rangeOf({ ...read, moves: read.moves.map((m, i) => (i === read.moves.length - 1 ? { ...m, size: 0.33 } : m)) }, 'p0', 'tag', BOARD, known)
    const parts = (w: Float64Array) => {
      const q = quantiles(before, info)!
      const sum = { low: 0, mid: 0, top: 0 }
      for (const c of info.order) {
        if (q[c] < 0.4) sum.low += w[c]
        else if (q[c] < 0.6) sum.mid += w[c]
        else sum.top += w[c]
      }
      const all = sum.low + sum.mid + sum.top
      return { low: sum.low / all, mid: sum.mid / all, top: sum.top / all }
    }
    const b = parts(big)
    const s = parts(small)
    // Крупная: середины почти нет, блефы снизу — около доли равновесия банк / (1 + 2 банка) = 1/3
    expect(b.mid).toBeLessThan(0.08)
    expect(b.low).toBeGreaterThan(0.2)
    expect(b.low).toBeLessThan(0.45)
    expect(Math.abs(b.low - bluffShare(1, 'tag'))).toBeLessThan(0.1)
    // Мелкая — середина остаётся
    expect(s.mid).toBeGreaterThan(b.mid * 2)
    // Чек: сильнейшие руки не вычеркнуты целиком
    const flopRead = { ...read, moves: read.moves.filter((m) => m.street === 'preflop' || (m.street === 'flop' && m.type === 'check')) }
    const pre = rangeOf({ ...read, moves: read.moves.filter((m) => m.street === 'preflop') }, 'p0', 'tag', BOARD.slice(0, 3), known)
    const checked = rangeOf(flopRead, 'p0', 'tag', BOARD.slice(0, 3), known)
    const flopInfo = boardInfo(BOARD.slice(0, 3))
    const q = quantiles(pre, flopInfo)!
    let topBefore = 0
    let topAfter = 0
    for (const c of flopInfo.order) {
      if (q[c] < 0.9) continue
      topBefore += pre[c]
      topAfter += checked[c]
    }
    expect(topAfter).toBeGreaterThan(0.2 * topBefore)
    expect(topAfter).toBeLessThan(0.7 * topBefore)
  })

  it(`короткий стек (≤ ${PUSH_FOLD_BB} ББ) — сильный играет пуш/фолд; хедз-ап — открывает шире`, () => {
    const random = seededRandom(15)
    for (let k = 0; k < 200; k++) {
      let t = start(table(2 + (k % 5), 120), shuffle(deckFor(HOLDEM_GAME), bytesOf(random)))
      const id = toActId(t) as string
      for (const style of ['tag', 'lag'] as const) {
        const move = botMove(viewFor(t, id), id, style, random)
        expect(['allin', 'fold', 'check']).toContain(move?.type)
      }
      t = ok(handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action: { type: 'allin' } }, 0))
      const next = toActId(t)
      if (!next) continue
      for (const style of ['tag', 'lag'] as const) expect(['allin', 'fold', 'call']).toContain(botMove(viewFor(t, next), next, style, random)?.type)
    }
    // K7 разной масти: хедз-ап на кнопке — повышение, на шестерых с первой позиции — пас
    const hu = start(table(2), riggedDeck(2, { 0: ['Kh', '7c'] }))
    const six = start(table(6), riggedDeck(6, { 3: ['Kh', '7c'] }))
    for (let seed = 0; seed < 20; seed++) {
      expect(botMove(viewFor(hu, 'p0'), 'p0', 'tag', seededRandom(seed))?.type).toBe('raise')
      expect(botMove(viewFor(six, 'p3'), 'p3', 'tag', seededRandom(seed))?.type).toBe('fold')
    }
  })

  it('стили по уровню: без повтора, пока хватает, затем новый круг', () => {
    const random = seededRandom(4)
    expect(new Set(pickStyles('mixed', 5, random)).size).toBe(5)
    expect(new Set(pickStyles('mixed', 6, random)).size).toBe(6)
    const novice = pickStyles('novice', 5, random)
    expect(new Set(novice.slice(0, 3)).size).toBe(3)
    expect(novice.every((s) => LEVEL_STYLES.novice.includes(s))).toBe(true)
    expect(pickStyles('amateur', 3, random)).toEqual(['abc', 'abc', 'abc'])
    expect(pickStyles('strong', 2, random).sort()).toEqual(['lag', 'tag'])
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

// Чтение соперников за вечер по HUD (#146, Р-47): счётчики по ходам, без карт
describe('сильный бот читает соперников по HUD вечера', () => {
  const hudOf = (c: Partial<HudCounts>): HudCounts => ({
    hands: 100, vpip: 0, pfr: 0, stealChances: 30, steals: 0, cbChances: 10, cbs: 0, raises: 0, calls: 0, ...c,
  })
  // Типажи за 100 раздач: всё уравнивает; играет очень узко; много давит; тот же, но спокойный
  const STATION = hudOf({ vpip: 55, pfr: 2, steals: 1, raises: 5, calls: 120 })
  const NIT = hudOf({ vpip: 11, pfr: 8, steals: 3, cbs: 6, raises: 20, calls: 6 })
  const PUSHY = hudOf({ vpip: 30, pfr: 22, steals: 15, cbs: 9, raises: 90, calls: 15 })
  const CALM = hudOf({ vpip: 30, pfr: 22, steals: 15, cbs: 9, raises: 20, calls: 40 })

  it(`меньше ${HUD_FEW_HANDS} раздач — соперник средний (ABC): ходы те же, что против подписанного ABC`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const random = seededRandom(seed)
      let t = start(table(4), shuffle(deckFor(HOLDEM_GAME), bytesOf(random)))
      let moves = 0
      while (t.hand) {
        const id = toActId(t) as string
        const others = t.players.map((p) => p.id).filter((x) => x !== id)
        // Без подписи, у каждого 29 раздач колл-станции
        const few: Hud = Object.fromEntries(others.map((x) => [x, { ...STATION, hands: HUD_FEW_HANDS - 1 }]))
        const abc = Object.fromEntries(others.map((x) => [x, 'abc' as const]))
        for (const style of ['tag', 'lag'] as const) {
          const read = botMove(viewFor(t, id), id, style, seededRandom(seed * 100 + moves), {}, few)
          expect(read).toEqual(botMove(viewFor(t, id), id, style, seededRandom(seed * 100 + moves), abc))
          // Человек без HUD — тоже средний
          expect(botMove(viewFor(t, id), id, style, seededRandom(seed * 100 + moves))).toEqual(read)
        }
        const move = botMove(viewFor(t, id), id, 'tag', seededRandom(seed * 100 + moves), {}, few)!
        t = ok(handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action: move }, 0))
        if (++moves > 100) throw new Error('раздача не кончается')
      }
    }
  })

  // Хедз-ап: p0 — кнопка, открыл до 25, p1 уравнял; флоп и тёрн — чек-чек; ривер — p1 чек, ход p0 без пары
  function airRiver(): TableState {
    let t = start(table(2), riggedDeck(2, { 0: ['6h', '5h'], 1: OPP }, BOARD))
    const act = (id: string, action: { type: 'check' | 'call' } | { type: 'raise'; to: number }) => {
      t = ok(handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action }, 0))
    }
    act('p0', { type: 'raise', to: 25 })
    act('p1', { type: 'call' })
    for (let k = 0; k < 3; k++) {
      act('p1', { type: 'check' })
      if (k < 2) act('p0', { type: 'check' })
    }
    return t
  }

  it('против колл-станции по HUD блефует на ривере реже, чем против среднего', () => {
    const t = airRiver()
    expect(toActId(t)).toBe('p0')
    for (const style of ['tag', 'lag'] as const) {
      const bets = (hud?: Hud) =>
        Array.from({ length: 300 }, (_, seed) => botMove(viewFor(t, 'p0'), 'p0', style, seededRandom(seed), {}, hud)).filter(
          (m) => m?.type === 'raise' || m?.type === 'allin',
        ).length
      const vsStation = bets({ p1: STATION })
      const vsAbc = bets()
      expect(vsAbc, style).toBeGreaterThan(30)
      expect(vsStation, style).toBeLessThan(vsAbc / 2)
    }
  })

  it('против нита по HUD в блайндах — кража из поздней позиции шире', () => {
    // Шестеро: до кнопки (p0) все пасуют, на блайндах p1 и p2
    const random = seededRandom(31)
    let vsNit = 0
    let vsAbc = 0
    for (let k = 0; k < 400; k++) {
      let t = start(table(6), shuffle(deckFor(HOLDEM_GAME), bytesOf(random)))
      for (const id of ['p3', 'p4', 'p5']) t = ok(handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action: { type: 'fold' } }, 0))
      expect(toActId(t)).toBe('p0')
      const steals = (hud?: Hud) => (botMove(viewFor(t, 'p0'), 'p0', 'tag', seededRandom(k), {}, hud)?.type === 'raise' ? 1 : 0)
      vsNit += steals({ p1: NIT, p2: NIT })
      vsAbc += steals()
    }
    expect(vsAbc).toBeGreaterThan(80)
    expect(vsNit).toBeGreaterThan(vsAbc * 1.3)
  })

  it('против того, кто много давит (AF по HUD высокий), ловит блефы на ривере шире', () => {
    const base = riverSpot(['7c', '7s'])
    const own = rangeOf(readHand(base.hand!), 'p1', 'tag', BOARD, [...BOARD, ...OPP])
    const calls = (hud: Hud) => {
      let total = 0
      let called = 0
      for (let c = 0; c < COMBOS.length; c++) {
        if (own[c] < 0.05) continue
        const t = riverSpot([COMBOS[c].a, COMBOS[c].b])
        const move = botMove(viewFor(t, 'p1'), 'p1', 'tag', seededRandom(c), {}, hud)
        total += own[c]
        if (move?.type !== 'fold') called += own[c]
      }
      return called / total
    }
    expect(calls({ p0: PUSHY })).toBeGreaterThan(calls({ p0: CALM }))
  })
})
})
