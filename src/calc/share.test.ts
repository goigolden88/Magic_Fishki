import { describe, expect, it } from 'vitest'
import { formatDate } from '../dates'
import type { Entry, EntryKind, Game } from '../model'
import { shareText, statsShareText } from './share'
import type { RegularStat, Stats } from './stats'

// Пример со скриншота (тот же, что в calc.test.ts): курс 0,5; закуп / выход
const EXAMPLE: [string, number, number][] = [
  ['Кирилл', 1000, 3950],
  ['Искоч', 5000, 0],
  ['Вика', 1000, 3340],
  ['Эрик', 2000, 2365],
  ['Здик', 1000, 0],
  ['Арман', 1000, 1345],
]

const DATE = '2026-10-09'

function makeGame(rows: [string, number, number][], rate = 0.5, name = formatDate(DATE)): Game {
  const entries: Entry[] = []
  const add = (playerId: string, kind: EntryKind, chips: number) =>
    entries.push({ id: String(entries.length), playerId, kind, chips, at: '2026-10-09T20:00:00.000Z' })
  for (const [player, buyin, cashout] of rows) {
    add(player, 'buyin', buyin)
    if (cashout > 0) add(player, 'cashout', cashout)
  }
  return {
    id: 'g',
    name,
    date: DATE,
    rate,
    players: rows.map(([player]) => ({ id: player, name: player })),
    entries,
    updatedAt: '2026-10-09T23:00:00.000Z',
  }
}

const plain = (s: string) => s.replace(/ /g, ' ')

describe('текст итога для мессенджера', () => {
  it('пример со скриншота', () => {
    expect(plain(shareText(makeGame(EXAMPLE)))).toBe(
      [
        'Покер · 09.10 · курс 0,5 ₽',
        'Кирилл +1475 ₽ · Вика +1170 ₽ · Эрик +182,5 ₽ · Арман +172,5 ₽ · Здик −500 ₽ · Искоч −2500 ₽',
        'Переводы:',
        'Искоч → Кирилл 1475 ₽',
        'Искоч → Вика 1025 ₽',
        'Здик → Вика 145 ₽',
        'Здик → Эрик 182,5 ₽',
        'Здик → Арман 172,5 ₽',
      ].join('\n'),
    )
  })

  it('игра не сходится — вместо переводов «не хватает N фишек»', () => {
    const rows = EXAMPLE.map(([n, b, c]): [string, number, number] => [n, b, n === 'Арман' ? 0 : c])
    expect(plain(shareText(makeGame(rows)))).toBe(
      [
        'Покер · 09.10 · курс 0,5 ₽',
        'Кирилл +1475 ₽ · Вика +1170 ₽ · Эрик +182,5 ₽ · Здик −500 ₽ · Арман −500 ₽ · Искоч −2500 ₽',
        'Не хватает 1345 фишек — переводы не посчитаны',
      ].join('\n'),
    )
  })

  it('выведено больше, чем закуплено — переводов тоже нет', () => {
    const text = plain(shareText(makeGame([['А', 1000, 1200], ['Б', 1000, 1000]])))
    expect(text.split('\n')[2]).toBe('Выведено 2200 из 2000 фишек — больше, чем закуплено; переводы не посчитаны')
  })

  it('своё название игры остаётся', () => {
    const text = plain(shareText(makeGame(EXAMPLE, 0.5, 'Пятница у Кирилла')))
    expect(text.split('\n')[0]).toBe('Пятница у Кирилла · 09.10 · курс 0,5 ₽')
  })

  it('пустое название — «Покер»', () => {
    expect(plain(shareText(makeGame(EXAMPLE, 0.5, ' '))).split('\n')[0]).toBe('Покер · 09.10 · курс 0,5 ₽')
  })

  it('крупные суммы — с пробелами, копейки — как есть', () => {
    const text = plain(shareText(makeGame([['А', 10000, 30001], ['Б', 20001, 0]], 1.05)))
    expect(text).toBe(
      ['Покер · 09.10 · курс 1,05 ₽', 'А +21 001,05 ₽ · Б −21 001,05 ₽', 'Переводы:', 'Б → А 21 001,05 ₽'].join('\n'),
    )
  })

  it('все при своих — переводы не нужны', () => {
    const text = plain(shareText(makeGame([['А', 1000, 1000], ['Б', 500, 500]])))
    expect(text).toBe(['Покер · 09.10 · курс 0,5 ₽', 'А 0 ₽ · Б 0 ₽', 'Переводы не нужны'].join('\n'))
  })
})

// Строка статистики — выдуманный игрок; итого = покер + казино
function stat(name: string, games: number, wins: number, poker: number, casino = 0): RegularStat {
  return {
    regularId: `r-${name}`,
    name,
    games,
    wins,
    chips: 0,
    poker,
    casino,
    kopecks: poker + casino,
    best: null,
    worst: null,
    rebuys: 0,
  }
}

describe('статистика игроков для мессенджера', () => {
  it('заголовок с основанием, игроки в порядке экрана, казино — в скобках', () => {
    const stats: Stats = {
      closedGames: 3,
      totalGames: 4,
      rows: [
        stat('Анна', 3, 2, 147500),
        stat('Борис', 2, 1, 10000, 8250),
        stat('Вера', 3, 0, -150000, -5005),
      ],
    }
    expect(plain(statsShareText(stats))).toBe(
      [
        'Статистика · По 3 закрытым играм из 4',
        'Анна +1475 ₽ · игр 3, в плюсе 2',
        'Борис +182,5 ₽ · игр 2, в плюсе 1 (покер +100 ₽, казино +82,5 ₽)',
        'Вера −1550,05 ₽ · игр 3, в плюсе 0 (покер −1500 ₽, казино −50,05 ₽)',
      ].join('\n'),
    )
  })

  it('игроки без закрытых игр не входят', () => {
    const stats: Stats = { closedGames: 1, totalGames: 2, rows: [stat('Анна', 1, 0, 0), stat('Борис', 0, 0, 0)] }
    expect(plain(statsShareText(stats))).toBe(['Статистика · По 1 закрытой игре из 2', 'Анна 0 ₽ · игр 1, в плюсе 0'].join('\n'))
  })

  it('крупные суммы — с пробелами', () => {
    const stats: Stats = { closedGames: 12, totalGames: 12, rows: [stat('Анна', 12, 7, 2100105)] }
    expect(plain(statsShareText(stats)).split('\n')[1]).toBe('Анна +21 001,05 ₽ · игр 12, в плюсе 7')
  })
})
