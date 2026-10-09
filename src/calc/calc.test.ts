import { describe, expect, it } from 'vitest'
import type { Entry, EntryKind, Player } from '../model'
import { balanceText, chipsGenitive, formatRub, parseChips, parseRate } from './format'
import { balance, playerTotals, toKopecks } from './totals'
import { transfers } from './transfers'

// Пример со скриншота: курс 0,5; закуп / выход
const EXAMPLE: [string, number, number][] = [
  ['Кирилл', 1000, 3950],
  ['Искоч', 5000, 0],
  ['Вика', 1000, 3340],
  ['Эрик', 2000, 2365],
  ['Здик', 1000, 0],
  ['Арман', 1000, 1345],
]

function makeGame(rows: [string, number, number][]) {
  const players: Player[] = rows.map(([name]) => ({ id: name, name }))
  const entries: Entry[] = []
  const add = (playerId: string, kind: EntryKind, chips: number) =>
    entries.push({ id: String(entries.length), playerId, kind, chips, at: '2026-10-09T20:00:00.000Z' })
  for (const [name, buyin, cashout] of rows) {
    add(name, 'buyin', buyin)
    if (cashout > 0) add(name, 'cashout', cashout)
  }
  return { players, entries }
}

const plain = (s: string) => s.replace(/ /g, ' ')

describe('пример со скриншота', () => {
  const { players, entries } = makeGame(EXAMPLE)
  const totals = playerTotals(players, entries, 0.5)

  it('итоги в рублях', () => {
    expect(totals.map((t) => t.kopecks)).toEqual([147500, -250000, 117000, 18250, -50000, 17250])
    expect(totals.map((t) => plain(formatRub(t.kopecks, true)))).toEqual([
      '+1 475 ₽',
      '−2 500 ₽',
      '+1 170 ₽',
      '+182,50 ₽',
      '−500 ₽',
      '+172,50 ₽',
    ])
  })

  it('игра сходится: 11 000 = 11 000', () => {
    const b = balance(totals)
    expect(b).toEqual({ chipsIn: 11000, chipsOut: 11000, diff: 0, ok: true })
    expect(plain(balanceText(b))).toBe('Игра сходится: выведено 11 000 из 11 000 фишек')
  })

  it('5 переводов на 3000 ₽, и после них все на нуле', () => {
    const list = transfers(totals, 0.5)
    expect(list).toHaveLength(5)
    expect(list.reduce((s, t) => s + t.kopecks, 0)).toBe(300000)
    expect(list.map((t) => [t.from, t.to, t.chips])).toEqual([
      ['Искоч', 'Кирилл', 2950],
      ['Искоч', 'Вика', 2050],
      ['Здик', 'Эрик', 365],
      ['Здик', 'Арман', 345],
      ['Здик', 'Вика', 290],
    ])
    const left = new Map(totals.map((t) => [t.playerId, t.chips]))
    for (const t of list) {
      left.set(t.from, left.get(t.from)! + t.chips)
      left.set(t.to, left.get(t.to)! - t.chips)
    }
    expect([...left.values()].every((v) => v === 0)).toBe(true)
  })
})

describe('выход не записан', () => {
  const rows = EXAMPLE.map(([n, b, c]): [string, number, number] => [n, b, n === 'Арман' ? 0 : c])
  const { players, entries } = makeGame(rows)
  const totals = playerTotals(players, entries, 0.5)

  it('«не хватает N фишек», переводов нет', () => {
    const b = balance(totals)
    expect(b.ok).toBe(false)
    expect(b.diff).toBe(1345)
    expect(plain(balanceText(b))).toContain('Не хватает 1 345 фишек — у кого-то не записан выход')
    expect(transfers(totals, 0.5)).toEqual([])
  })
})

describe('мелочи расчёта', () => {
  it('докупы складываются с закупом', () => {
    const players: Player[] = [{ id: 'a', name: 'А' }, { id: 'b', name: 'Б' }]
    const at = '2026-10-09T20:00:00.000Z'
    const entries: Entry[] = [
      { id: '1', playerId: 'a', kind: 'buyin', chips: 1000, at },
      { id: '2', playerId: 'a', kind: 'rebuy', chips: 1000, at },
      { id: '3', playerId: 'b', kind: 'buyin', chips: 1000, at },
      { id: '4', playerId: 'a', kind: 'cashout', chips: 500, at },
      { id: '5', playerId: 'b', kind: 'cashout', chips: 2500, at },
    ]
    const totals = playerTotals(players, entries, 1)
    expect(totals.map((t) => [t.chipsIn, t.chipsOut, t.chips])).toEqual([
      [2000, 500, -1500],
      [1000, 2500, 1500],
    ])
    expect(transfers(totals, 1)).toEqual([{ from: 'a', to: 'b', chips: 1500, kopecks: 150000 }])
  })

  it('выведено больше, чем закуплено', () => {
    const text = plain(balanceText({ chipsIn: 1000, chipsOut: 1200, diff: -200, ok: false }))
    expect(text).toContain('на 200')
  })

  it('пустая игра', () => {
    expect(balanceText(balance([]))).toBe('Записей пока нет')
    expect(transfers([], 0.5)).toEqual([])
  })

  it('копейки округляются одинаково в плюс и в минус', () => {
    expect(toKopecks(1, 0.125)).toBe(13)
    expect(toKopecks(-1, 0.125)).toBe(-13)
    expect(toKopecks(3, 0.1)).toBe(30)
    expect(Object.is(toKopecks(0, 0.5), 0)).toBe(true)
  })

  it('падеж фишек', () => {
    expect([1, 2, 5, 11, 21, 111].map(chipsGenitive)).toEqual(['фишки', 'фишек', 'фишек', 'фишек', 'фишки', 'фишек'])
  })

  it('ввод чисел', () => {
    expect(parseChips('1 000')).toBe(1000)
    expect(parseChips('0')).toBeNull()
    expect(parseChips('12,5')).toBeNull()
    expect(parseChips('')).toBeNull()
    expect(parseRate('0,5')).toBe(0.5)
    expect(parseRate('1')).toBe(1)
    expect(parseRate('0')).toBeNull()
    expect(parseRate('')).toBeNull()
    expect(parseRate('abc')).toBeNull()
  })
})
