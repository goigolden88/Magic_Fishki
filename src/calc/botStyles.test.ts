import { describe, expect, it } from 'vitest'
import { deckFor, HOLDEM_GAME, shuffle } from '../poker/game'
import { PROTOCOL_VERSION } from '../poker/protocol'
import { createTable, handle, viewFor, type Result, type TableState } from '../poker/table'
import type { RandomBytes } from '../poker/tokens'
import { botMove, LEVEL_STYLES, seededRandom, styleLabel, type BotStyle, type Random } from './bot'
import { toActId } from './localTable'

// Прогон ботов между собой (#139): стол на 6, только боты, стек 100 ББ в начале каждой раздачи,
// места по кругу — каждый стиль на каждой позиции. Счёт VPIP / PFR — HUD вечера (hud.ts, Р-32)

const BB = 10
const STACK = 100 * BB

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

type Stat = { hands: number; vpip: number; pfr: number; tbChances: number; tb: number; aggr: number; calls: number; chips: number }

export function simulate(players: { id: string; style: BotStyle }[], hands: number, seed: number): Map<string, Stat> {
  const random = seededRandom(seed)
  const stats = new Map<string, Stat>(players.map((p) => [p.id, { hands: 0, vpip: 0, pfr: 0, tbChances: 0, tb: 0, aggr: 0, calls: 0, chips: 0 }]))
  const styles = Object.fromEntries(players.map((p) => [p.id, p.style]))
  const n = players.length
  for (let k = 0; k < hands; k++) {
    // Места по кругу: кнопка — всегда место 0, игроки сдвигаются на одно каждую раздачу
    const order = players.map((_, i) => players[(i + k) % n])
    let t = ok(createTable(order[0].id, order[0].id, { sb: BB / 2, bb: BB, startingStack: STACK, maxSeats: n, cards: 'phones', game: 'holdem' }, 0))
    for (const p of order.slice(1)) t = ok(handle(t, p.id, { v: PROTOCOL_VERSION, type: 'sit', name: p.id }, 0))
    t = ok(handle(t, order[0].id, { v: PROTOCOL_VERSION, type: 'start' }, 0, shuffle(deckFor(HOLDEM_GAME), bytesOf(random))))
    let moves = 0
    while (t.hand) {
      const id = toActId(t) as string
      const move = botMove(viewFor(t, id), id, styles[id], random, styles)
      if (!move) throw new Error('нет хода')
      t = ok(handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action: move }, 0))
      if (++moves > 300) throw new Error('раздача не кончается')
    }
    const log = t.lastHand?.record?.log ?? []
    for (const p of t.players) {
      const s = stats.get(p.id)!
      const hud = t.hud?.[p.id]
      s.hands++
      s.vpip += hud?.vpip ?? 0
      s.pfr += hud?.pfr ?? 0
      s.chips += p.chips - STACK
    }
    // 3-бет: ход до флопа против одного повышения; агрессия — после флопа ставки и повышения к уравниваниям
    let toBeat = BB
    let raises = 0
    let street = 'preflop'
    const faced = new Set<string>()
    for (const e of log) {
      if (e.type === 'ante') continue
      if (e.street !== street) {
        street = e.street
        toBeat = 0
      }
      const s = stats.get(e.playerId)!
      const aggressive = e.type === 'raise' || (e.type === 'allin' && e.bet > toBeat)
      const passive = e.type === 'call' || (e.type === 'allin' && !aggressive)
      if (street === 'preflop') {
        if (raises === 1 && !faced.has(e.playerId)) {
          faced.add(e.playerId)
          s.tbChances++
          if (aggressive) s.tb++
        }
        if (aggressive) raises++
      } else {
        if (aggressive) s.aggr++
        if (passive) s.calls++
      }
      toBeat = Math.max(toBeat, e.bet)
    }
  }
  return stats
}

const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0)
const bb100 = (s: Stat) => (s.chips / BB / s.hands) * 100

function table(stats: Map<string, Stat>, styles: Record<string, BotStyle>): string {
  const rows = [...stats].map(([id, s]) =>
    [
      styleLabel(styles[id]),
      pct(s.vpip, s.hands).toFixed(1),
      pct(s.pfr, s.hands).toFixed(1),
      pct(s.tb, s.tbChances).toFixed(1),
      (s.calls > 0 ? s.aggr / s.calls : s.aggr).toFixed(2),
      bb100(s).toFixed(1),
    ].join(' | '),
  )
  return ['Стиль | VPIP | PFR | 3-бет | Агрессия | bb/100', ...rows].join('\n')
}

// Раздач в прогоне; отчёт PR — на 6000 раздач тем же тестом
const HANDS = 600

describe('стили ботов на прогоне между собой', () => {
  it('VPIP / PFR в полосах стилей, агрессия, сильные сильнее', () => {
    const players = LEVEL_STYLES.mixed.map((style) => ({ id: style, style }))
    const styles = Object.fromEntries(players.map((p) => [p.id, p.style]))
    const started = Date.now()
    const stats = simulate(players, HANDS, 139)
    console.log(`${HANDS} раздач за ${((Date.now() - started) / 1000).toFixed(1)} с\n${table(stats, styles)}`)
    const s = (style: BotStyle) => stats.get(style)!
    const band = (style: BotStyle, vpip: [number, number], pfr: [number, number]) => {
      const x = s(style)
      expect(pct(x.vpip, x.hands), `${style} VPIP`).toBeGreaterThanOrEqual(vpip[0])
      expect(pct(x.vpip, x.hands), `${style} VPIP`).toBeLessThanOrEqual(vpip[1])
      expect(pct(x.pfr, x.hands), `${style} PFR`).toBeGreaterThanOrEqual(pfr[0])
      expect(pct(x.pfr, x.hands), `${style} PFR`).toBeLessThanOrEqual(pfr[1])
    }
    band('nit', [10, 16], [7, 13])
    band('station', [40, 100], [0, 8])
    band('maniac', [45, 100], [30, 100])
    band('abc', [20, 28], [12, 18])
    band('tag', [19, 25], [15, 21])
    band('lag', [27, 36], [22, 30])
    expect(s('station').aggr / s('station').calls).toBeLessThan(1)
    expect(s('maniac').aggr / s('maniac').calls).toBeGreaterThan(3)
    expect(bb100(s('tag'))).toBeGreaterThan(bb100(s('abc')))
    expect(bb100(s('lag'))).toBeGreaterThan(bb100(s('abc')))
    for (const weak of ['nit', 'station', 'maniac'] as const) expect(bb100(s('abc'))).toBeGreaterThan(bb100(s(weak)))
  }, 600_000)
})
