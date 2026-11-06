import { describe, expect, it } from 'vitest'
import { call, check, newTable, play, start } from '../poker/testing'
import { formatBB, stackText } from './format'
import { actionsView } from './pokerView'
import {
  addBet,
  isDefaultBets,
  parsePotPct,
  parsePreTenths,
  parseQuickBets,
  potBetLabel,
  preBetLabel,
  QUICK_BETS_DEFAULT,
  QUICK_BETS_MAX,
  quickRaises,
  type RaiseSpot,
} from './quickBets'

const spot = (over: Partial<RaiseSpot> = {}): RaiseSpot => ({
  preflop: false,
  currentBet: 0,
  toCall: 0,
  pot: 300,
  min: 10,
  max: 1000,
  potTop: false,
  bb: 10,
  ...over,
})

describe('быстрые ставки (Р-62)', () => {
  it('после флопа — «Мин» и доли банка: ⅓, ½, ¾, банк', () => {
    expect(quickRaises(spot())).toEqual([
      { label: 'Мин', to: 10 },
      { label: '⅓ банка', to: 100 },
      { label: '½ банка', to: 150 },
      { label: '¾ банка', to: 225 },
      { label: 'Банк', to: 300 },
    ])
  })

  it('доля — от банка после колла, поверх ставки улицы', () => {
    // Ставка 100 в банк 300: банк с ней 400, после колла 500 → полбанка — до 100 + 250
    const quick = quickRaises(spot({ currentBet: 100, toCall: 100, pot: 400, min: 200 }), { pot: [50], pre: [] })
    expect(quick).toEqual([
      { label: 'Мин', to: 200 },
      { label: '½ банка', to: 350 },
    ])
  })

  it('до флопа — «Мин» и множители ББ: 2,5, 3, 4', () => {
    expect(quickRaises(spot({ preflop: true, currentBet: 10, toCall: 10, pot: 15, min: 20 }))).toEqual([
      { label: 'Мин', to: 20 },
      { label: '2,5 ББ', to: 25 },
      { label: '3 ББ', to: 30 },
      { label: '4 ББ', to: 40 },
    ])
  })

  it('сумма вне min…max — кнопки нет; max — у олл-ина; одинаковые суммы — одна кнопка', () => {
    // После рейза до 30: 2,5 ББ и 3 ББ — ниже минимума
    expect(quickRaises(spot({ preflop: true, currentBet: 30, toCall: 20, pot: 45, min: 50 })).map((q) => q.label)).toEqual([
      'Мин',
    ])
    // Стек 200: банк 300 — больше стека, его нет
    expect(quickRaises(spot({ max: 200 })).map((q) => q.to)).toEqual([10, 100, 150])
    // Одна сумма у двух кнопок — первая
    expect(quickRaises(spot({ pot: 30 }), { pot: [33], pre: [] })).toEqual([{ label: 'Мин', to: 10 }])
  })

  it('пот-лимит: «Банк» — «Пот» до предела; до флопа «Пот» всегда, после — когда «Банк» среди своих', () => {
    const potTop = spot({ max: 300, potTop: true })
    expect(quickRaises(potTop).map((q) => [q.label, q.to])).toEqual([
      ['Мин', 10],
      ['⅓ банка', 100],
      ['½ банка', 150],
      ['¾ банка', 225],
      ['Пот', 300],
    ])
    expect(quickRaises(potTop, { pot: [50], pre: [] }).map((q) => q.label)).toEqual(['Мин', '½ банка'])
    expect(quickRaises(spot({ preflop: true, currentBet: 10, toCall: 10, pot: 15, min: 20, max: 35, potTop: true })).map((q) => q.label)).toEqual(
      ['Мин', '2,5 ББ', '3 ББ', 'Пот'],
    )
  })

  it('свои кнопки — в виде стола: панель хода показывает их', () => {
    const s = play(newTable(['p0', 'p1', 'p2']), [start('p0'), call('p0'), call('p1'), check('p2')], false)
    expect(s.hand?.stage).toBe('flop')
    // Банк 30: четверть — 7, меньше минимума 10 — кнопки нет
    expect(actionsView(s, 'p1', { pot: [25, 200], pre: [] })?.raise?.quick).toEqual([
      { label: 'Мин', to: 10 },
      { label: '200 % банка', to: 60 },
    ])
    const pre = play(newTable(['p0', 'p1', 'p2']), [start('p0')], false)
    expect(actionsView(pre, 'p0', { pot: [], pre: [50] })?.raise?.quick).toEqual([
      { label: 'Мин', to: 20 },
      { label: '5 ББ', to: 50 },
    ])
  })

  it('подписи кнопок', () => {
    expect([25, 33, 50, 67, 75, 100, 150].map(potBetLabel)).toEqual([
      '¼ банка',
      '⅓ банка',
      '½ банка',
      '⅔ банка',
      '¾ банка',
      'Банк',
      '150 % банка',
    ])
    expect([20, 25, 30, 125].map(preBetLabel)).toEqual(['2 ББ', '2,5 ББ', '3 ББ', '12,5 ББ'])
  })

  it('ввод: доля — целые проценты, множитель — до десятых; вне предела — null', () => {
    expect(parsePotPct('33')).toBe(33)
    expect(parsePotPct('50 %')).toBe(50)
    expect([parsePotPct('5'), parsePotPct('301'), parsePotPct('1,5'), parsePotPct('')]).toEqual([null, null, null, null])
    expect(parsePreTenths('2,5')).toBe(25)
    expect(parsePreTenths('3')).toBe(30)
    expect(parsePreTenths('2.5')).toBe(25)
    expect([parsePreTenths('1,5'), parsePreTenths('21'), parsePreTenths('2,55'), parsePreTenths('х')]).toEqual([null, null, null, null])
  })

  it('добавление — по возрастанию, без повторов, не больше пяти', () => {
    expect(addBet([50, 100], 33)).toEqual([33, 50, 100])
    expect(addBet([50], 50)).toEqual([50])
    const full = [10, 20, 30, 40, 50]
    expect(full.length).toBe(QUICK_BETS_MAX)
    expect(addBet(full, 60)).toBe(full)
  })

  it('из памяти и копии: годное — как есть, по возрастанию; негодное — null', () => {
    expect(parseQuickBets(QUICK_BETS_DEFAULT)).toEqual(QUICK_BETS_DEFAULT)
    expect(parseQuickBets({ pot: [100, 50], pre: [] })).toEqual({ pot: [50, 100], pre: [] })
    expect(parseQuickBets({ pot: [50], pre: [5] })).toBeNull()
    expect(parseQuickBets({ pot: [1, 2, 3, 4, 5, 6].map((n) => n * 20), pre: [] })).toBeNull()
    expect(parseQuickBets({ pot: [50.5], pre: [] })).toBeNull()
    expect(parseQuickBets(null)).toBeNull()
    expect(parseQuickBets({})).toBeNull()
    expect(isDefaultBets(QUICK_BETS_DEFAULT)).toBe(true)
    expect(isDefaultBets({ pot: [50], pre: [30] })).toBe(false)
  })
})

describe('суммы в больших блайндах (Р-62)', () => {
  // Пробелы на экране — неразрывные
  const plain = (s: string) => s.replace(/ /g, ' ')

  it('десятые — округлением, целое — без запятой', () => {
    expect(plain(formatBB(425, 10))).toBe('42,5 ББ')
    expect(plain(formatBB(400, 10))).toBe('40 ББ')
    expect(plain(formatBB(333, 20))).toBe('16,7 ББ')
    expect(plain(formatBB(125000, 10))).toBe('12 500 ББ')
    expect(plain(formatBB(0, 10))).toBe('0 ББ')
  })

  it('выключено — фишками', () => {
    expect(plain(stackText(1500, null))).toBe('1 500')
    expect(plain(stackText(1500, 50))).toBe('30 ББ')
  })
})
