import { describe, expect, it } from 'vitest'
import { createGame, type Entry, type Game } from '../model'
import { clockText, formatDuration, gameClock } from './duration'
import { draftFromChat, gameFromDraft, parseChat } from './telegram'

// Выдуманные игроки и время
const plain = (s: string) => s.replace(/ /g, ' ')

function entry(id: string, at: string, kind: Entry['kind'] = 'buyin'): Entry {
  return { id, playerId: 'А', kind, chips: 1000, at }
}

function makeGame(entries: Entry[], extra: Partial<Game> = {}): Game {
  return {
    id: 'g',
    name: '',
    date: '2026-10-09',
    rate: 0.5,
    players: [{ id: 'А', name: 'А' }],
    entries,
    updatedAt: '2026-10-09T20:00:00.000Z',
    ...extra,
  }
}

// Закуп в 20:00, докуп в 21:30, выход в 00:20 — 4 ч 20 мин
const EVENING = [
  entry('1', '2026-10-09T20:00:00.000Z'),
  entry('2', '2026-10-09T21:30:00.000Z', 'rebuy'),
  entry('3', '2026-10-10T00:20:00.000Z', 'cashout'),
]

describe('часы вечера (#49)', () => {
  it('идущая игра — от первой записи до «сейчас», минуты вниз', () => {
    const g = makeGame(EVENING.slice(0, 2))
    expect(gameClock(g, '2026-10-09T21:05:59.000Z')).toEqual({ running: true, minutes: 65 })
    expect(gameClock(g, '2026-10-09T21:06:00.000Z')).toEqual({ running: true, minutes: 66 })
  })

  it('закрытая игра — от первой записи до последней и больше не меняется', () => {
    const g = makeGame(EVENING, { closed: true })
    expect(gameClock(g, '2026-10-10T00:30:00.000Z')).toEqual({ running: false, minutes: 260 })
    expect(gameClock(g, '2026-10-20T00:00:00.000Z')).toEqual({ running: false, minutes: 260 })
  })

  it('«Открыть снова» — часы снова идут до «сейчас»', () => {
    const g = makeGame(EVENING, { closed: false })
    expect(gameClock(g, '2026-10-10T00:30:00.000Z')).toEqual({ running: true, minutes: 270 })
  })

  it('порядок записей не важен: самая ранняя и самая поздняя', () => {
    const g = makeGame([...EVENING].reverse(), { closed: true })
    expect(gameClock(g, '2026-10-10T01:00:00.000Z')).toEqual({ running: false, minutes: 260 })
  })

  it('раунды казино — тоже записи; игра только с казино получает часы', () => {
    const casino = [
      { id: 'c1', at: '2026-10-09T19:30:00.000Z', amounts: [] },
      { id: 'c2', at: '2026-10-10T01:00:00.000Z', amounts: [] },
    ]
    expect(gameClock(makeGame(EVENING, { casino, closed: true }), '2026-10-11T00:00:00.000Z')).toEqual({
      running: false,
      minutes: 330,
    })
    expect(gameClock(makeGame([], { casino: casino.slice(0, 1) }), '2026-10-09T20:15:00.000Z')).toEqual({
      running: true,
      minutes: 45,
    })
  })

  it('удалённая запись не считается — часы по оставшимся', () => {
    const g = makeGame(EVENING.slice(1), { closed: true })
    expect(gameClock(g, '2026-10-11T00:00:00.000Z')).toEqual({ running: false, minutes: 170 })
  })

  it('записей нет — часов нет', () => {
    expect(gameClock(makeGame([]), '2026-10-09T21:00:00.000Z')).toBeNull()
    expect(gameClock(makeGame([], { casino: [], closed: true }), '2026-10-09T21:00:00.000Z')).toBeNull()
  })

  it('все записи в одну минуту: идущая — «0 мин» и растёт, закрытая — без часов', () => {
    const now = '2026-10-09T20:00:00.000Z'
    const g = createGame(
      { name: '', date: '2026-10-09', rate: 0.5, players: [{ id: 'r1', name: 'А' }, { id: 'r2', name: 'Б' }], buyin: 1000, now },
      (() => {
        let n = 0
        return () => `id${++n}`
      })(),
    )
    expect(gameClock(g, now)).toEqual({ running: true, minutes: 0 })
    expect(gameClock(g, '2026-10-09T20:07:00.000Z')).toEqual({ running: true, minutes: 7 })
    expect(gameClock({ ...g, closed: true }, '2026-10-09T20:07:00.000Z')).toBeNull()
  })

  it('забыли закрыть: больше 12 часов с последней записи — «играли» от первой до последней', () => {
    const g = makeGame(EVENING)
    expect(gameClock(g, '2026-10-10T12:20:00.000Z')).toEqual({ running: true, minutes: 980 })
    expect(gameClock(g, '2026-10-10T12:20:01.000Z')).toEqual({ running: false, minutes: 260 })
    expect(gameClock(g, '2026-10-17T00:00:00.000Z')).toEqual({ running: false, minutes: 260 })
  })

  it('забыли закрыть, а все записи в одну минуту — часов нет', () => {
    expect(gameClock(makeGame(EVENING.slice(0, 1)), '2026-10-10T09:00:00.000Z')).toBeNull()
  })

  it('из Телеграма — по времени сообщений: закуп — первое сообщение, выход — своё', () => {
    const chat = parseChat(
      [
        '[09.10.2026 20:10] Кирилл: #rebuy',
        '[09.10.2026 22:40] Вика: #rebuy',
        '[10.10.2026 00:25] Кирилл: #cashout 2400',
        '[10.10.2026 00:30] Вика: #cashout 1600',
      ].join('\n'),
    )
    let n = 0
    const draft = draftFromChat(chat, 1000, () => `d${++n}`)!
    const game = gameFromDraft(draft, { name: '', rate: 0.5, now: '2026-10-20T10:00:00.000Z' }, () => `g${++n}`, [])
    expect(gameClock(game, '2026-10-20T10:00:00.000Z')).toEqual({ running: false, minutes: 260 })
  })
})

describe('формат часов', () => {
  it('меньше часа — минуты, час и больше — «ч» и две цифры минут', () => {
    expect(plain(formatDuration(0))).toBe('0 мин')
    expect(plain(formatDuration(45))).toBe('45 мин')
    expect(plain(formatDuration(60))).toBe('1 ч 00 мин')
    expect(plain(formatDuration(65))).toBe('1 ч 05 мин')
    expect(plain(formatDuration(260))).toBe('4 ч 20 мин')
    expect(plain(formatDuration(1015))).toBe('16 ч 55 мин')
  })

  it('строка экрана: «Идёт» и «Играли»', () => {
    expect(plain(clockText({ running: true, minutes: 65 }))).toBe('Идёт 1 ч 05 мин')
    expect(plain(clockText({ running: false, minutes: 260 }))).toBe('Играли 4 ч 20 мин')
  })
})
