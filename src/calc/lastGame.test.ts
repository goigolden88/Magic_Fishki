import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type TableState } from '../poker/table'
import { daysAgoText, formatNumber } from './format'
import { isLastGame, lastGameText, parseLastGame, type LastGame } from './lastGame'

// Момент по часам телефона — в любом поясе тот же день
const at = (y: number, m: number, d: number, h = 21) => new Date(y, m - 1, d, h).getTime()

function table(over: Partial<TableState['settings']>, handCount: number): Pick<TableState, 'settings' | 'handCount'> {
  return { settings: { ...DEFAULT_SETTINGS, ...over }, handCount }
}

describe('сегодня / вчера / N дней назад', () => {
  it('по календарю, со склонением', () => {
    expect(daysAgoText('2026-11-14', '2026-11-14')).toBe('сегодня')
    expect(daysAgoText('2026-11-13', '2026-11-14')).toBe('вчера')
    expect(daysAgoText('2026-11-12', '2026-11-14')).toBe('2 дня назад')
    expect(daysAgoText('2026-11-09', '2026-11-14')).toBe('5 дней назад')
    expect(daysAgoText('2026-10-24', '2026-11-14')).toBe('21 день назад')
    expect(daysAgoText('2026-10-03', '2026-11-14')).toBe('42 дня назад')
    expect(daysAgoText('2026-10-03', '2026-10-14')).toBe('11 дней назад')
  })

  it('через месяц и год — по календарю', () => {
    expect(daysAgoText('2026-10-31', '2026-11-01')).toBe('вчера')
    expect(daysAgoText('2025-12-31', '2026-01-01')).toBe('вчера')
  })

  it('часы ушли назад — «сегодня», а не минус дни', () => {
    expect(daysAgoText('2026-11-15', '2026-11-14')).toBe('сегодня')
  })
})

describe('разбор записи «Продолжить»', () => {
  it('стол ботов и стол на телефоне — без кода', () => {
    expect(parseLastGame({ kind: 'bots', at: 1000 })).toEqual({ kind: 'bots', at: 1000 })
    expect(parseLastGame({ kind: 'local', at: 1000, code: 'KQ7MZP' })).toEqual({ kind: 'local', at: 1000 })
  })

  it('комната — с кодом, свой сервер — адресом без хвоста', () => {
    expect(parseLastGame({ kind: 'room', at: 5, code: 'KQ7MZP' })).toEqual({ kind: 'room', at: 5, code: 'KQ7MZP' })
    expect(parseLastGame({ kind: 'room', at: 5, code: 'KQ7MZP', server: 'https://my.example.dev/' })).toEqual({
      kind: 'room',
      at: 5,
      code: 'KQ7MZP',
      server: 'https://my.example.dev',
    })
    // Кривой или пустой сервер — как без сервера
    expect(parseLastGame({ kind: 'room', at: 5, code: 'KQ7MZP', server: 'не адрес' })).toEqual({ kind: 'room', at: 5, code: 'KQ7MZP' })
    expect(parseLastGame({ kind: 'room', at: 5, code: 'KQ7MZP', server: ' ' })).toEqual({ kind: 'room', at: 5, code: 'KQ7MZP' })
  })

  it('кривое — null', () => {
    expect(parseLastGame(null)).toBeNull()
    expect(parseLastGame('bots')).toBeNull()
    expect(parseLastGame([])).toBeNull()
    expect(parseLastGame({})).toBeNull()
    expect(parseLastGame({ kind: 'casino', at: 5 })).toBeNull()
    expect(parseLastGame({ kind: 'bots' })).toBeNull()
    expect(parseLastGame({ kind: 'bots', at: '5' })).toBeNull()
    expect(parseLastGame({ kind: 'bots', at: 0 })).toBeNull()
    expect(parseLastGame({ kind: 'bots', at: Number.NaN })).toBeNull()
    expect(parseLastGame({ kind: 'room', at: 5 })).toBeNull()
    expect(parseLastGame({ kind: 'room', at: 5, code: '' })).toBeNull()
    expect(parseLastGame({ kind: 'room', at: 5, code: 7 })).toBeNull()
  })

  it('запись про этот стол', () => {
    const room: LastGame = { kind: 'room', at: 5, code: 'KQ7MZP' }
    expect(isLastGame(room, 'room', 'KQ7MZP')).toBe(true)
    expect(isLastGame(room, 'room', 'AAAAAA')).toBe(false)
    expect(isLastGame(room, 'bots')).toBe(false)
    expect(isLastGame({ kind: 'bots', at: 5 }, 'bots')).toBe(true)
    expect(isLastGame({ kind: 'local', at: 5 }, 'bots')).toBe(false)
    expect(isLastGame(null, 'local')).toBe(false)
  })
})

describe('строка полосы', () => {
  const today = '2026-11-14'

  it('против ботов: игра, блайнды, мест, раздач, когда', () => {
    const t = table({ game: 'holdem', sb: 5, bb: 10, maxSeats: 6 }, 43)
    expect(lastGameText({ kind: 'bots', at: at(2026, 11, 13) }, t, today)).toEqual({
      title: 'Против ботов · холдем 5/10',
      line: '6 мест · раздач 43 · вчера',
    })
  })

  it('стол на телефоне: омаха, крупные блайнды — с пробелом тысяч, места склоняются', () => {
    const t = table({ game: 'omaha', sb: 500, bb: 1000, maxSeats: 2 }, 0)
    expect(lastGameText({ kind: 'local', at: at(2026, 11, 14, 1) }, t, today)).toEqual({
      title: `Стол на телефоне · омаха 500/${formatNumber(1000)}`,
      line: '2 места · раздач 0 · сегодня',
    })
    expect(lastGameText({ kind: 'local', at: at(2026, 11, 9) }, table({ game: 'shortdeck', maxSeats: 10 }, 7), today)).toEqual({
      title: 'Стол на телефоне · шорт-дек 5/10',
      line: '10 мест · раздач 7 · 5 дней назад',
    })
  })

  it('стол без поля игры — холдем', () => {
    const t = table({}, 1)
    delete (t.settings as { game?: unknown }).game
    expect(lastGameText({ kind: 'bots', at: at(2026, 11, 14) }, t, today).title).toBe('Против ботов · холдем 5/10')
  })

  it('комната — код и только когда', () => {
    expect(lastGameText({ kind: 'room', at: at(2026, 11, 12), code: 'KQ7MZP' }, null, today)).toEqual({
      title: 'Комната KQ7MZP',
      line: '2 дня назад',
    })
  })
})
