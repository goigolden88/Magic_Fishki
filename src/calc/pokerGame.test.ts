import { describe, expect, it } from 'vitest'
import type { Game } from '../model'
import { allin, award, call, fold, newTable, play, raise, start, type Step } from '../poker/testing'
import { createTable, type TableState } from '../poker/table'
import { gameFromTable, LEFT_NAME } from './pokerGame'
import { balance, playerTotals } from './totals'
import { transfers } from './transfers'

const NOW = '2026-10-25T21:00:00.000Z'
const input = { name: '25 октября 2026', date: '2026-10-25', rate: 0.5, now: NOW }

function ids() {
  let n = 0
  return () => `id${++n}`
}

const toGame = (table: TableState) => gameFromTable(table, input, ids())

// Записи игры: имя, вид, фишки
function rows(g: Game): [string | undefined, string, number][] {
  const names = new Map(g.players.map((p) => [p.id, p.name]))
  return g.entries.map((e) => [names.get(e.playerId), e.kind, e.chips])
}

const totals = (g: Game) => playerTotals(g.players, g.entries, g.rate)
const rebuy = (from: string, amount: number, now = 0): Step => ({ from, msg: { type: 'rebuy', amount }, now })
const approve = (host: string, playerId: string, now = 0): Step => ({
  from: host,
  msg: { type: 'rebuyAnswer', playerId, approve: true },
  now,
})
const remove = (host: string, playerId: string, now = 0): Step => ({ from: host, msg: { type: 'remove', playerId }, now })

describe('итог стола → игра в историю', () => {
  it('закуп, одобренный докуп и стек в конце — «Закуп», «Докуп», «Выход»; игра сходится и закрыта', () => {
    // Между раздачами p1 докупает 500; в раздаче p0 и p1 сбрасывают — блайнды забирает p2
    const s = play(
      newTable(['p0', 'p1', 'p2']),
      [
        rebuy('p1', 500, 60_000),
        approve('p0', 'p1', 60_000),
        { from: 'p1', msg: { type: 'rebuy', amount: 300 } },
        { from: 'p0', msg: { type: 'rebuyAnswer', playerId: 'p1', approve: false } },
        start('p0'),
        fold('p0'),
        fold('p1'),
        award('p0', [['p2']]),
      ],
      false,
    )
    const g = toGame(s)
    expect(g).toMatchObject({ name: input.name, date: '2026-10-25', rate: 0.5, closed: true, updatedAt: NOW })
    expect(g.players.map((p) => p.name)).toEqual(['P0', 'P1', 'P2'])
    expect(rows(g)).toEqual([
      ['P0', 'buyin', 1000],
      ['P1', 'buyin', 1000],
      ['P2', 'buyin', 1000],
      ['P1', 'rebuy', 500],
      ['P0', 'cashout', 1000],
      ['P1', 'cashout', 1495],
      ['P2', 'cashout', 1005],
    ])
    expect(g.entries[3].at).toBe(new Date(60_000).toISOString())
    expect(g.entries[6].at).toBe(NOW)
    expect(balance(totals(g))).toEqual({ chipsIn: 3500, chipsOut: 3500, diff: 0, ok: true })
    const id = (name: string) => g.players.find((p) => p.name === name)?.id
    expect(transfers(totals(g), g.rate)).toEqual([{ from: id('P1'), to: id('P2'), chips: 5, kopecks: 250 }])
  })

  it('ушедший до конца — «Выход» со стеком в момент ухода и его имя', () => {
    const s = play(newTable(['p0', 'p1', 'p2']), [remove('p0', 'p1', 90_000)], false)
    const g = toGame(s)
    expect(rows(g)).toEqual([
      ['P0', 'buyin', 1000],
      ['P1', 'buyin', 1000],
      ['P2', 'buyin', 1000],
      ['P1', 'cashout', 1000],
      ['P0', 'cashout', 1000],
      ['P2', 'cashout', 1000],
    ])
    expect(g.entries[3].at).toBe(new Date(90_000).toISOString())
    expect(g.closed).toBe(true)
  })

  it('постоянный связан с собой, гость — без связи; постоянный, севший снова, — тот же участник', () => {
    const created = createTable('h', 'Аня', {}, 0, 'r-anya')
    if (!created.ok) throw new Error(created.error)
    const s = play(
      created.state,
      [
        { from: 'g', msg: { type: 'sit', name: 'Петя' } },
        { from: 'd1', msg: { type: 'sit', name: 'Дима', regularId: 'r-dima' } },
        remove('h', 'd1', 1000),
        { from: 'd2', msg: { type: 'sit', name: 'Дима', regularId: 'r-dima' } },
      ],
      true,
    )
    const g = toGame(s)
    expect(g.players.map((p) => [p.name, p.regularId])).toEqual([
      ['Аня', 'r-anya'],
      ['Петя', undefined],
      ['Дима', 'r-dima'],
    ])
    expect('regularId' in g.players[1]).toBe(false)
    expect(rows(g).filter(([name]) => name === 'Дима')).toEqual([
      ['Дима', 'buyin', 1000],
      ['Дима', 'cashout', 1000],
      ['Дима', 'buyin', 1000],
      ['Дима', 'cashout', 1000],
    ])
  })

  it('ведущий правил стек — фишки не сходятся: игра открыта, расхождение видно, переводов нет', () => {
    const s = newTable(['p0', 'p1'], {}, { p1: 1500 })
    const g = toGame(s)
    expect(rows(g)).toEqual([
      ['P0', 'buyin', 1000],
      ['P1', 'buyin', 1000],
      ['P0', 'cashout', 1000],
      ['P1', 'cashout', 1500],
    ])
    expect(g.closed).toBeUndefined()
    expect(balance(totals(g))).toEqual({ chipsIn: 2000, chipsOut: 2500, diff: -500, ok: false })
    expect(transfers(totals(g), g.rate)).toEqual([])
  })

  it('«Закончить» во время раздачи — раздача отменяется: стеки до неё, докупы в ней — игрока, фишки сходятся', () => {
    // p0 — кнопка, p1 — малый, p2 — большой. p1 сбрасывает, докупает 200 и уходит;
    // p2 в раздаче докупает 300 — в стек после раздачи, которой не будет
    const s = play(
      newTable(['p0', 'p1', 'p2']),
      [
        start('p0'),
        raise('p0', 30),
        fold('p1'),
        rebuy('p1', 200),
        approve('p0', 'p1'),
        remove('p0', 'p1', 7),
        rebuy('p2', 300),
        approve('p0', 'p2'),
      ],
      true,
    )
    expect(s.hand?.stage).toBe('preflop')
    const g = toGame(s)
    expect(rows(g)).toEqual([
      ['P0', 'buyin', 1000],
      ['P1', 'buyin', 1000],
      ['P2', 'buyin', 1000],
      ['P1', 'rebuy', 200],
      ['P1', 'cashout', 1200], // 995 после малого блайнда + 200 докупа + 5 блайнда назад
      ['P2', 'rebuy', 300],
      ['P0', 'cashout', 1000],
      ['P2', 'cashout', 1300],
    ])
    expect(balance(totals(g)).ok).toBe(true)
    expect(g.closed).toBe(true)
  })

  it('проигравший всё — без «Выхода», игра сходится', () => {
    const s = play(newTable(['p0', 'p1']), [start('p0'), allin('p0'), call('p1'), award('p0', [['p0']])], false)
    const g = toGame(s)
    expect(rows(g)).toEqual([
      ['P0', 'buyin', 1000],
      ['P1', 'buyin', 1000],
      ['P0', 'cashout', 2000],
    ])
    expect(g.closed).toBe(true)
    const [p0, p1] = g.players.map((p) => p.id)
    expect(transfers(totals(g), g.rate)).toEqual([{ from: p1, to: p0, chips: 1000, kopecks: 50000 }])
  })

  it('уход, записанный до #60, — без имени: участник «Ушёл со стола»', () => {
    const s = play(newTable(['p0', 'p1']), [remove('p0', 'p1')], false)
    const leave = s.chipLog.at(-1)
    if (leave?.kind !== 'leave') throw new Error('нет ухода')
    delete leave.name
    delete leave.regularId
    const g = toGame(s)
    expect(g.players.map((p) => p.name)).toEqual(['P0', LEFT_NAME])
    expect(g.players[1].regularId).toBeUndefined()
  })

  it('стол не меняется', () => {
    const s = play(newTable(['p0', 'p1']), [start('p0')], false)
    const copy = structuredClone(s)
    toGame(s)
    expect(s).toEqual(copy)
  })
})
