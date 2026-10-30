import { describe, expect, it } from 'vitest'
import type { Entry, EntryKind, Game, Player } from '../model'
import { addRound, gameResult, newNames, parseRound } from './casino'
import { shareText } from './share'
import { regularStats } from './stats'

// Выдуманные игроки и числа
const NOW = '2026-10-15T22:00:00.000Z'

function makeGame(rate: number, rows: [string, number, number][], extra: Partial<Game> = {}): Game {
  const entries: Entry[] = []
  const add = (playerId: string, kind: EntryKind, chips: number) =>
    entries.push({ id: `e${entries.length}`, playerId, kind, chips, at: NOW })
  for (const [name, buyin, cashout] of rows) {
    add(name, 'buyin', buyin)
    if (cashout > 0) add(name, 'cashout', cashout)
  }
  return {
    id: 'g',
    name: '',
    date: '2026-10-15',
    rate,
    players: rows.map(([name]): Player => ({ id: name, name })),
    entries,
    updatedAt: NOW,
    ...extra,
  }
}

function idMaker() {
  let n = 0
  return () => `id${++n}`
}

const plain = (s: string) => s.replace(/ /g, ' ')

describe('разбор раунда казино', () => {
  it('каждый названный получает число строки; без знака — плюс', () => {
    const r = parseRound('Эрик, Артём +150\nЭдик 550\nАрман, Аскар -250\nНика −350')
    expect(r.amounts).toEqual([
      { name: 'Эрик', kopecks: 15000 },
      { name: 'Артём', kopecks: 15000 },
      { name: 'Эдик', kopecks: 55000 },
      { name: 'Арман', kopecks: -25000 },
      { name: 'Аскар', kopecks: -25000 },
      { name: 'Ника', kopecks: -35000 },
    ])
    expect(r.sum).toBe(0)
    expect(r.bad).toEqual([])
  })

  it('имя дважды — сложено; пустые строки пропускаются', () => {
    const r = parseRound('\nЭрик 100\n\n  Эрик, Эдик -50  \n')
    expect(r.amounts).toEqual([
      { name: 'Эрик', kopecks: 5000 },
      { name: 'Эдик', kopecks: -5000 },
    ])
    expect(r.sum).toBe(0)
  })

  it('копейки, разряды, знак рубля', () => {
    const r = parseRound('Эрик 1 000,5 ₽\nЭдик -1000.50 руб')
    expect(r.amounts).toEqual([
      { name: 'Эрик', kopecks: 100050 },
      { name: 'Эдик', kopecks: -100050 },
    ])
  })

  it('сумма не ноль — видна разница', () => {
    const r = parseRound('Эрик +150\nЭдик -100')
    expect(r.sum).toBe(5000)
  })

  it('строки без имени, без числа или с нулём — не разобраны', () => {
    const r = parseRound('+150\nЭрик\nЭдик 0\nАрман 100')
    expect(r.bad).toEqual(['+150', 'Эрик', 'Эдик 0'])
    expect(r.amounts).toEqual([{ name: 'Арман', kopecks: 10000 }])
  })
})

describe('раунд в игре', () => {
  it('имя не из игры — участник только казино, без покерных записей', () => {
    const game = makeGame(0.5, [['А', 1000, 1000]])
    const round = parseRound('А +300\nВ -300')
    expect(newNames(round, game.players)).toEqual(['В'])
    const next = addRound(game, round, [{ id: 'r-v', name: 'В' }], idMaker(), NOW)
    expect(next.players).toEqual([
      { id: 'А', name: 'А' },
      { id: 'id1', name: 'В', regularId: 'r-v' },
    ])
    expect(next.entries).toEqual(game.entries)
    expect(next.casino).toEqual([
      {
        id: 'id2',
        at: NOW,
        amounts: [
          { playerId: 'А', kopecks: 30000 },
          { playerId: 'id1', kopecks: -30000 },
        ],
      },
    ])
    const res = gameResult(next)
    const v = res.players.find((p) => p.playerId === 'id1')!
    expect(v.inPoker).toBe(false)
    expect(v.inCasino).toBe(true)
    // На сходимость покера не влияет
    expect(res.balance.ok).toBe(true)
    expect(res.ok).toBe(true)
  })

  it('доля, сложившаяся в ноль, не пишется', () => {
    const game = makeGame(1, [])
    const next = addRound(game, parseRound('А 100\nА -100\nБ 50\nВ -50'), [], idMaker(), NOW)
    expect(next.casino![0].amounts.map((a) => a.kopecks)).toEqual([5000, -5000])
  })
})

// Пример из задачи: курс 0,5; А закуп 2000 выход 0, Б закуп 1000 выход 3000; казино «А +300 / Б −300»
const EXAMPLE = makeGame(0.5, [
  ['А', 2000, 0],
  ['Б', 1000, 3000],
])
const WITH_CASINO: Game = {
  ...EXAMPLE,
  casino: [
    {
      id: 'c1',
      at: NOW,
      amounts: [
        { playerId: 'А', kopecks: 30000 },
        { playerId: 'Б', kopecks: -30000 },
      ],
    },
  ],
}

describe('три итога и переводы по итого', () => {
  it('пример из задачи: один перевод А → Б 700 ₽', () => {
    const res = gameResult(WITH_CASINO)
    const [a, b] = res.players
    expect([a.poker.kopecks, a.casino, a.kopecks]).toEqual([-100000, 30000, -70000])
    expect([b.poker.kopecks, b.casino, b.kopecks]).toEqual([100000, -30000, 70000])
    expect(res.transfers).toEqual([{ from: 'А', to: 'Б', kopecks: 70000 }])
  })

  it('без казино — переводы прежние, в фишках', () => {
    const res = gameResult(EXAMPLE)
    expect(res.hasCasino).toBe(false)
    expect(res.transfers).toEqual([{ from: 'А', to: 'Б', chips: 2000, kopecks: 100000 }])
  })

  it('покер не сходится — переводов нет, даже с казино', () => {
    const res = gameResult({ ...WITH_CASINO, entries: WITH_CASINO.entries.filter((e) => e.kind !== 'cashout') })
    expect(res.balance.ok).toBe(false)
    expect(res.ok).toBe(false)
    expect(res.transfers).toEqual([])
  })

  it('только казино — итог и переводы по казино', () => {
    const game: Game = {
      ...makeGame(0.5, []),
      players: [
        { id: 'a', name: 'А' },
        { id: 'b', name: 'Б' },
        { id: 'c', name: 'В' },
      ],
      casino: [
        {
          id: 'c1',
          at: NOW,
          amounts: [
            { playerId: 'a', kopecks: 50000 },
            { playerId: 'b', kopecks: -20000 },
            { playerId: 'c', kopecks: -30000 },
          ],
        },
        {
          id: 'c2',
          at: NOW,
          amounts: [
            { playerId: 'a', kopecks: -10000 },
            { playerId: 'b', kopecks: 10000 },
          ],
        },
      ],
    }
    const res = gameResult(game)
    expect(res.ok).toBe(true)
    expect(res.players.map((p) => p.kopecks)).toEqual([40000, -10000, -30000])
    expect(res.transfers).toEqual([
      { from: 'c', to: 'a', kopecks: 30000 },
      { from: 'b', to: 'a', kopecks: 10000 },
    ])
  })

  it('раунд не в ноль — игра не сходится, переводов нет', () => {
    const bad: Game = {
      ...EXAMPLE,
      casino: [{ id: 'c1', at: NOW, amounts: [{ playerId: 'А', kopecks: 100 }] }],
    }
    const res = gameResult(bad)
    expect(res.casinoOk).toBe(false)
    expect(res.transfers).toEqual([])
  })

  it('дробный курс: копейка округления остаётся без перевода', () => {
    // Курс 0,333: покер А +2 фишки → +67 коп., Б и В по −1 фишке → −33 коп.; сумма копеек +1
    const game: Game = {
      ...makeGame(0.333, [
        ['А', 1, 3],
        ['Б', 1, 0],
        ['В', 1, 0],
      ]),
      casino: [
        {
          id: 'c1',
          at: NOW,
          amounts: [
            { playerId: 'Б', kopecks: 100 },
            { playerId: 'В', kopecks: -100 },
          ],
        },
      ],
    }
    const res = gameResult(game)
    expect(res.players.map((p) => p.kopecks)).toEqual([67, 67, -133])
    expect(res.transfers).toEqual([
      { from: 'В', to: 'А', kopecks: 67 },
      { from: 'В', to: 'Б', kopecks: 66 },
    ])
  })
})

describe('итог для мессенджера с казино', () => {
  it('покер, казино и итого; переводы по итого', () => {
    expect(plain(shareText(WITH_CASINO, NOW))).toBe(
      [
        'Покер · 15.10 · курс 0,5 ₽',
        'Покер: Б +1000 ₽ · А −1000 ₽',
        'Казино: А +300 ₽ · Б −300 ₽',
        'Итого: Б +700 ₽ · А −700 ₽',
        'Переводы:',
        'А → Б 700 ₽',
      ].join('\n'),
    )
  })

  it('только казино — одна строка «Казино», без курса', () => {
    const game: Game = { ...WITH_CASINO, entries: [] }
    expect(plain(shareText(game, NOW))).toBe(
      ['Казино · 15.10', 'Казино: А +300 ₽ · Б −300 ₽', 'Переводы:', 'Б → А 300 ₽'].join('\n'),
    )
  })
})

describe('статистика с казино', () => {
  it('три итога; в плюсе и лучший вечер — по итого', () => {
    const regulars = [
      { id: 'r-a', name: 'А' },
      { id: 'r-b', name: 'Б' },
    ]
    // Покер А −1000 ₽, казино +1500 ₽: итого +500 — вечер в плюсе
    const game: Game = {
      ...EXAMPLE,
      closed: true,
      players: [
        { id: 'А', name: 'А', regularId: 'r-a' },
        { id: 'Б', name: 'Б', regularId: 'r-b' },
      ],
      casino: [
        {
          id: 'c1',
          at: NOW,
          amounts: [
            { playerId: 'А', kopecks: 150000 },
            { playerId: 'Б', kopecks: -150000 },
          ],
        },
      ],
    }
    const a = regularStats(regulars, [game]).rows.find((r) => r.regularId === 'r-a')!
    expect([a.poker, a.casino, a.kopecks]).toEqual([-100000, 150000, 50000])
    expect(a.chips).toBe(-2000)
    expect(a.wins).toBe(1)
    expect(a.best!.kopecks).toBe(50000)
  })
})
