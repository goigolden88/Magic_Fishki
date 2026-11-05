import { describe, expect, it } from 'vitest'
import { bestHand, buildDeck, OMAHA, type Card } from '../poker/cards'
import { deckFor, OMAHA_GAME, shuffle } from '../poker/game'
import { PROTOCOL_VERSION, type BetAction } from '../poker/protocol'
import { createTable, handle, viewFor, type Result, type TableState } from '../poker/table'
import type { RandomBytes } from '../poker/tokens'
import { botMove, LEVEL_STYLES, PUSH_FOLD_BB, seededRandom, type BotStyle, type Random } from './bot'
import { omahaBoardRank, omahaDraw, omahaPoints, omahaRangeOf, omahaTop, type OmahaRange } from './botOmaha'
import { quantiles, readHand } from './botRead'
import { toActId } from './localTable'

// Омаха против ботов (#147, Р-46): оценка четырёх карт до флопа, правило «две из руки» после флопа,
// натсы, короткий стек, хедз-ап, чтение диапазонов

const cards = (s: string): Card[] => s.match(/../g) as Card[]

function ok(r: Result): TableState {
  if (!r.ok) throw new Error(r.error)
  return r.state
}

function bytesOf(random: Random): RandomBytes {
  return (b) => {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(random() * 256)
    return b
  }
}

// Стол омахи пот-лимит на n мест; ids — p0…p(n−1) по местам
function table(n: number, stack = 1000): TableState {
  let t = ok(createTable('p0', 'Игрок 0', { sb: 5, bb: 10, startingStack: stack, maxSeats: n, cards: 'phones', game: 'omaha', limit: 'pot' }, 0))
  for (let i = 1; i < n; i++) t = ok(handle(t, `p${i}`, { v: PROTOCOL_VERSION, type: 'sit', name: `Игрок ${i}` }, 0))
  return t
}

const start = (t: TableState, deck: Card[]) => ok(handle(t, 'p0', { v: PROTOCOL_VERSION, type: 'start' }, 0, deck))
const act = (t: TableState, id: string, action: BetAction) => ok(handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action }, 0))

// Колода, где у мест заданные четыре карты (первая раздача: кнопка — место 0, сдача по кругу с места 1) и общие
function riggedDeck(n: number, holes: Record<number, Card[]>, board: Card[] = []): Card[] {
  const deck: (Card | null)[] = Array(52).fill(null)
  for (const [seat, hole] of Object.entries(holes)) {
    const p = (Number(seat) - 1 + n) % n
    hole.forEach((c, k) => (deck[k * n + p] = c))
  }
  board.forEach((c, i) => (deck[4 * n + i] = c))
  const used = new Set(deck.filter((c) => c !== null))
  const rest = buildDeck(OMAHA).filter((c) => !used.has(c))
  return deck.map((c) => c ?? (rest.shift() as Card))
}

const move = (t: TableState, id: string, style: BotStyle, seed: number, styles: Record<string, BotStyle> = {}) =>
  botMove(viewFor(t, id), id, style, seededRandom(seed), styles)

const SEEDS = Array.from({ length: 40 }, (_, i) => i)

// Сколько раз из SEEDS ход — такой
function count(t: TableState, id: string, style: BotStyle, types: BetAction['type'][], styles: Record<string, BotStyle> = {}): number {
  return SEEDS.filter((seed) => types.includes(move(t, id, style, seed, styles)?.type as BetAction['type'])).length
}

// Хедз-ап: p0 — кнопка и малый блайнд, p1 — большой. До флопа p0 уравнивает, p1 — чек; флоп и тёрн — чек-чек;
// на ривере p1 — чек: ход p0. bet — и p0 ставит в банк: ход p1
function headsUpRiver(hole0: Card[], hole1: Card[], board: Card[], bet = false): TableState {
  let t = start(table(2), riggedDeck(2, { 0: hole0, 1: hole1 }, board))
  t = act(t, 'p0', { type: 'call' })
  t = act(t, 'p1', { type: 'check' })
  for (let k = 0; k < 2; k++) {
    t = act(t, 'p1', { type: 'check' })
    t = act(t, 'p0', { type: 'check' })
  }
  t = act(t, 'p1', { type: 'check' })
  if (bet) t = act(t, 'p0', { type: 'raise', to: 20 })
  return t
}

describe('омаха: оценка руки до флопа', () => {
  it('A♠A♥K♠Q♥ — в верхней доле, 2♣7♦9♥K♠ — в нижней, J♠T♥9♠8♥ выше K♠K♦7♣2♥', () => {
    expect(omahaTop(cards('AsAhKsQh'))).toBeLessThan(0.03)
    expect(omahaTop(cards('2c7d9hKs'))).toBeGreaterThan(0.5)
    expect(omahaTop(cards('JsTh9s8h'))).toBeLessThan(omahaTop(cards('KsKd7c2h')))
    // Двойная одномастная выше одной масти, одна масть — выше разномастной
    expect(omahaPoints(cards('JsTh9s8h'))).toBeGreaterThan(omahaPoints(cards('JsTh9s8d')))
    expect(omahaPoints(cards('JsTh9s8d'))).toBeGreaterThan(omahaPoints(cards('JsTh9c8d')))
    // Связанные выше разорванных, «висящая» карта — ниже
    expect(omahaPoints(cards('QsJhTd9c'))).toBeGreaterThan(omahaPoints(cards('Qs9hTd4c')))
    expect(omahaPoints(cards('AsKsQhJh'))).toBeGreaterThan(omahaPoints(cards('AsKsQh2d')))
    // Пары с поддержкой выше голой пары с мусором
    expect(omahaPoints(cards('KsKhQsJh'))).toBeGreaterThan(omahaPoints(cards('KsKh7c2d')))
    // Три одной масти — хуже двух
    expect(omahaPoints(cards('AsKsQs2h'))).toBeLessThan(omahaPoints(cards('AsKsQh2h')))
  })

  it('доли рук — от 0 до 1 и одни при каждом счёте', () => {
    const random = seededRandom(1)
    const deck = buildDeck(OMAHA)
    for (let k = 0; k < 200; k++) {
      const h = shuffle(deck, bytesOf(random)).slice(0, 4)
      const t = omahaTop(h)
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(1)
      expect(omahaTop(h)).toBe(t)
    }
  })

  it('бот до флопа различает руки: ТАГ на ранней позиции пасует 2♣7♦9♥K♠ и не пасует A♠A♥K♠Q♥', () => {
    const junk = start(table(6), riggedDeck(6, { 3: cards('2c7d9hKs') }))
    const aces = start(table(6), riggedDeck(6, { 3: cards('AsAhKsQh') }))
    for (const style of ['tag', 'lag', 'abc', 'nit'] as const) {
      expect(count(junk, 'p3', style, ['fold']), style).toBe(SEEDS.length)
      expect(count(aces, 'p3', style, ['fold']), style).toBe(0)
    }
    // Средняя рука: маньяк входит, ТАГ на ранней позиции — нет
    const mid = start(table(6), riggedDeck(6, { 3: cards('Ts9h6s5d') }))
    expect(count(mid, 'p3', 'maniac', ['fold'])).toBe(0)
    expect(count(mid, 'p3', 'tag', ['fold'])).toBe(SEEDS.length)
  })
})

describe('омаха: сила после флопа — ровно две из руки и три со стола', () => {
  it('четыре червы в руке, на столе одна — флеша и флеш-дро нет; на столе четыре, у бота одна — тоже', () => {
    const fourInHand = cards('AhKhQhJh')
    const board = cards('2h7c9d3s5c')
    expect(bestHand(OMAHA, fourInHand, board).category).toBe('high')
    expect(omahaDraw(fourInHand, board.slice(0, 3)).flush).toBe(false)
    const oneInHand = cards('AhKcQdJs')
    const hearts = cards('2h7h9h3h5c')
    expect(bestHand(OMAHA, oneInHand, hearts).category).toBe('high')
    // Две своих червы и четыре на столе — флеш, и старший: натсы
    const flush = cards('AhTh4c4d')
    expect(bestHand(OMAHA, flush, hearts).category).toBe('flush')
    expect(omahaBoardRank(flush, hearts).nuts).toBe(true)
    // Место на столе: «флеш» без флеша — внизу, настоящий — наверху
    expect(omahaBoardRank(fourInHand, board).beats).toBeLessThan(0.5)
    expect(omahaBoardRank(oneInHand, hearts).beats).toBeLessThan(0.5)
    expect(omahaBoardRank(flush, hearts).beats).toBeGreaterThan(0.95)
  })

  it('дро омахи: флеш-дро — две своих и две на столе, натс-дро — со старшей картой масти; «обёртка» — больше 8 карт к стриту', () => {
    expect(omahaDraw(cards('AhTh4c4d'), cards('Kh7h2c'))).toMatchObject({ flush: true, nutFlush: true })
    expect(omahaDraw(cards('QhTh4c4d'), cards('Kh7h2c'))).toMatchObject({ flush: true, nutFlush: false })
    expect(omahaDraw(cards('AhKdQcJs'), cards('Kh7h2c')).flush).toBe(false)
    // Q-J-9-8 на T-7-2: стрит дают шестёрки, восьмёрки, девятки и валеты — 13 карт, «обёртка»
    const wrap = omahaDraw(cards('QsJd9h8c'), cards('Tc7d2s'))
    expect(wrap.outs).toBeGreaterThanOrEqual(12)
    expect(wrap.straight).toBe(2)
    // Гатшот: A-K на Q-T-2 ждёт валета
    expect(omahaDraw(cards('AsKd5h5c'), cards('QcTd2s'))).toMatchObject({ outs: 4, straight: 1 })
  })

  it('бот не ставит «флеш» без флеша: с четырьмя червами в руке и одной на столе — как без руки', () => {
    // Ривер, чек ко мне (p0): та же раздача с настоящим флешем и с «флешем» из руки
    const opp = cards('8s8dTcTs')
    const fake = headsUpRiver(cards('AhKhQhJh'), opp, cards('2h7c9d3s5c'))
    const real = headsUpRiver(cards('AhKh8c6d'), opp, cards('2h7h9h3s5c'))
    const fakeBoard = headsUpRiver(cards('AhKcQdJs'), opp, cards('2h7h9h3h5c'))
    for (const style of ['nit', 'abc'] as const) {
      const bets = (t: TableState) => count(t, 'p0', style, ['raise', 'allin'])
      expect(bets(real), `${style}: флеш`).toBeGreaterThan(SEEDS.length * 0.8)
      expect(bets(fake), `${style}: четыре червы в руке`).toBeLessThan(SEEDS.length * 0.2)
      expect(bets(fakeBoard), `${style}: одна черва при четырёх на столе`).toBeLessThan(SEEDS.length * 0.2)
    }
    // Сильный блефует и без руки, но с флешем ставит чаще
    const tagBets = (t: TableState) => count(t, 'p0', 'tag', ['raise', 'allin'])
    expect(tagBets(real)).toBeGreaterThan(tagBets(fake))
    expect(tagBets(real)).toBeGreaterThan(tagBets(fakeBoard))
  })

  it('натсы: сильный ставит на вэлью и повышает; второй флеш против ставки и повышения на спаренном столе — осторожнее', () => {
    // Неспаренный стол, три червы: туз червей — старший флеш (натсы), дама — второй
    const board = cards('Kh8h3hJc2s')
    const opp = cards('9s9dTcTs')
    const nut = cards('AhTh4c5d')
    const second = cards('QhTh4c5d')
    expect(omahaBoardRank(nut, board).nuts).toBe(true)
    expect(omahaBoardRank(second, board).nuts).toBe(false)
    for (const style of ['tag', 'lag'] as const) {
      // Чек ко мне — ставка; ставка против меня — повышение
      expect(count(headsUpRiver(nut, opp, board), 'p0', style, ['raise', 'allin'])).toBe(SEEDS.length)
      expect(count(headsUpRiver(opp, nut, board, true), 'p1', style, ['raise', 'allin'])).toBe(SEEDS.length)
    }

    // Спаренный стол, три червы. 3 места: p0 — кнопка, p1 — малый, p2 — большой. До флопа все уравнивают,
    // флоп и тёрн — чеки; на ривере p1 ставит банк, p2 повышает в банк: ход p0
    const paired = cards('Kh8h8c3h2s')
    const spot = (hole: Card[]) => {
      let t = start(table(3), riggedDeck(3, { 0: hole, 1: cards('9s9dTcTs'), 2: cards('QsQdJcJs') }, paired))
      t = act(t, 'p0', { type: 'call' })
      t = act(t, 'p1', { type: 'call' })
      t = act(t, 'p2', { type: 'check' })
      for (let k = 0; k < 2; k++) for (const id of ['p1', 'p2', 'p0']) t = act(t, id, { type: 'check' })
      t = act(t, 'p1', { type: 'raise', to: 30 })
      t = act(t, 'p2', { type: 'raise', to: 120 })
      expect(toActId(t)).toBe('p0')
      return t
    }
    const styles = { p1: 'tag', p2: 'tag' } as const
    for (const style of ['tag', 'lag'] as const) {
      const folds = (hole: Card[]) => count(spot(hole), 'p0', style, ['fold'], styles)
      const raises = (hole: Card[]) => count(spot(hole), 'p0', style, ['raise', 'allin'], styles)
      const n = folds(nut)
      const s = folds(second)
      console.log(`${style}, спаренный стол, ставка и повышение: старший флеш — пас ${n}, повышение ${raises(nut)}; второй — пас ${s}, повышение ${raises(second)} из ${SEEDS.length}`)
      expect(s, `${style}: второй флеш пасует чаще`).toBeGreaterThan(n)
      expect(raises(second)).toBeLessThanOrEqual(raises(nut))
    }
    // Сотни ходов омахи с выборкой: при полном наборе тестов рядом с прогоном стилей дольше 5 с (#146)
  }, 30_000)
})

describe('омаха: крайние случаи', () => {
  it(`короткий стек (≤ ${PUSH_FOLD_BB} ББ): сильный — «олл-ин или пас» только с верхними руками, повышениями в банк`, () => {
    const short = (hole: Card[]) => start(table(6, 100), riggedDeck(6, { 3: hole }))
    for (const style of ['tag', 'lag'] as const) {
      expect(count(short(cards('AsAhKsQh')), 'p3', style, ['raise', 'allin']), style).toBe(SEEDS.length)
      expect(count(short(cards('2c7d9hKs')), 'p3', style, ['fold']), style).toBe(SEEDS.length)
      // Средняя рука, что в глубоком стеке открывает с поздней позиции, коротким стеком на ранней — пас
      expect(count(short(cards('Ts9h6s5d')), 'p3', style, ['fold']), style).toBe(SEEDS.length)
      // Повысил в банк, а за ним олл-ин — до конца, без паса
      for (const seed of SEEDS.slice(0, 10)) {
        let t = short(cards('AsAhKsQh'))
        t = act(t, 'p3', move(t, 'p3', style, seed)!)
        t = act(t, 'p4', { type: 'allin' })
        for (const id of ['p5', 'p0', 'p1', 'p2']) t = act(t, id, { type: 'fold' })
        expect(toActId(t)).toBe('p3')
        expect(move(t, 'p3', style, seed)?.type).not.toBe('fold')
      }
    }
  })

  it('хедз-ап омаха — шире, чем на ранней позиции стола на 6', () => {
    const random = seededRandom(46)
    const opens = (n: number, id: string) => {
      let k = 0
      for (let i = 0; i < 300; i++) {
        const t = start(table(n), shuffle(deckFor(OMAHA_GAME), bytesOf(random)))
        if (move(t, id, 'tag', i)?.type !== 'fold') k++
      }
      return k
    }
    const early = opens(6, 'p3')
    const headsUp = opens(2, 'p0')
    expect(headsUp).toBeGreaterThan(early * 2)
  })

  for (const style of LEVEL_STYLES.mixed) {
    it(`${style}: каждый ход в омахе допустим — рейз не больше банка; чужие карты не влияют`, () => {
      const random = seededRandom(style.length * 104_729)
      for (let k = 0; k < 40; k++) {
        let t = start(table(2 + (k % 5), 50 + Math.floor(random() * 2000)), shuffle(deckFor(OMAHA_GAME), bytesOf(random)))
        let moves = 0
        while (t.hand) {
          const id = toActId(t) as string
          const seed = Math.floor(random() * 1e9)
          const m = botMove(viewFor(t, id), id, style, seededRandom(seed))
          if (!m) throw new Error('бот не нашёл хода')
          // Весь стол и вид глазами бота — один ответ
          expect(botMove(t, id, style, seededRandom(seed))).toEqual(m)
          const r = handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action: m }, 0)
          if (!r.ok) throw new Error(`${style}: недопустимый ход ${JSON.stringify(m)} — ${r.error}`)
          t = r.state
          if (++moves > 200) throw new Error('раздача не кончается')
        }
      }
    })
  }
})

describe('омаха: чтение соперника', () => {
  // Средняя доля рук диапазона по весу: меньше — уже (сильнее)
  const meanTop = (g: OmahaRange) => {
    let total = 0
    let sum = 0
    g.hands.forEach((h, i) => {
      total += g.w[i]
      sum += g.w[i] * omahaTop(h)
    })
    return sum / total
  }

  it('до флопа: открытие с ранней позиции уже, чем с кнопки; повышение на повышение — ещё уже', () => {
    const deck = riggedDeck(6, { 3: cards('AsAhKsQh') })
    // p3 — первым после большого блайнда; p0 — кнопка
    const utg = act(start(table(6), deck), 'p3', { type: 'raise', to: 35 })
    let btn = start(table(6), deck)
    for (const id of ['p3', 'p4', 'p5']) btn = act(btn, id, { type: 'fold' })
    btn = act(btn, 'p0', { type: 'raise', to: 35 })
    const threeBet = act(utg, 'p4', { type: 'raise', to: 120 })
    const range = (t: TableState, id: string) => omahaRangeOf(readHand(t.hand!), id, 'tag', [], [], seededRandom(3))
    const early = meanTop(range(utg, 'p3'))
    const late = meanTop(range(btn, 'p0'))
    const reraise = meanTop(range(threeBet, 'p4'))
    expect(early).toBeLessThan(late)
    expect(reraise).toBeLessThan(early)
  })

  it('крупная ставка на ривере — поляризованный диапазон: сильные и доля блефов, середина почти уходит', () => {
    const board = cards('Kd8s4c2hJd')
    const before = headsUpRiver(cards('AhQc5s6s'), cards('7c7s3d3h'), board)
    const after = act(before, 'p0', { type: 'raise', to: 20 })
    const known = [...board, ...cards('7c7s3d3h')]
    const read = readHand(after.hand!)
    const prior = omahaRangeOf({ ...read, moves: read.moves.slice(0, -1) }, 'p0', 'tag', board, known, seededRandom(5))
    // Та же выборка рук — тот же случай: веса до ставки и после
    const bet = omahaRangeOf(read, 'p0', 'tag', board, known, seededRandom(5))
    expect(bet.hands).toEqual(prior.hands)
    const q = quantiles(prior.w, prior.info)!
    const parts = (w: Float64Array) => {
      const sum = { low: 0, mid: 0, top: 0 }
      let total = 0
      for (let i = 0; i < w.length; i++) {
        total += w[i]
        if (q[i] >= 0.6) sum.top += w[i]
        else if (q[i] < 0.4) sum.low += w[i]
        else sum.mid += w[i]
      }
      return { low: sum.low / total, mid: sum.mid / total, top: sum.top / total }
    }
    const a = parts(prior.w)
    const b = parts(bet.w)
    expect(b.top).toBeGreaterThan(a.top)
    expect(b.mid).toBeLessThan(a.mid * 0.5)
    // Блефы — есть, но меньше вэлью
    expect(b.low).toBeGreaterThan(0.03)
    expect(b.low).toBeLessThan(b.top)
  })
})
