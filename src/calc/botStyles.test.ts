import { describe, expect, it } from 'vitest'
import { deckFor, HOLDEM_GAME, OMAHA_GAME, shuffle } from '../poker/game'
import type { Hud, HudCounts } from '../poker/hud'
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

type Stat = {
  hands: number
  vpip: number
  pfr: number
  tbChances: number
  tb: number
  aggr: number
  calls: number
  late: number // ставки и повышения на тёрне и ривере
  air: number // из них — с рукой слабее пары (ни пары на столе и в руке, ни готового флеша и стрита)
  chips: number
  vs: Record<string, number> // фишек выиграно у каждого соперника (минус — проиграно)
}

type Game = 'holdem' | 'omaha'

// Как гонять: hud — подавать ботам HUD вечера (#146), копится через раздачи; unsigned — эти игроки без
// подписи стиля (соперники читают их только по HUD)
type SimOptions = { hud?: boolean; unsigned?: (id: string) => boolean }

// Рука слабее пары: среди своих и общих карт нет двух одного ранга, пяти одной масти и пяти рангов подряд
function air(cards: string[]): boolean {
  const ranks = cards.map((c) => '23456789TJQKA'.indexOf(c[0]))
  if (new Set(ranks).size < ranks.length) return false
  const suits = new Map<string, number>()
  for (const c of cards) suits.set(c[1], (suits.get(c[1]) ?? 0) + 1)
  if ([...suits.values()].some((k) => k >= 5)) return false
  const has = new Set(ranks.includes(12) ? [...ranks, -1] : ranks)
  for (let lo = -1; lo <= 8; lo++) if ([0, 1, 2, 3, 4].every((d) => has.has(lo + d))) return false
  return true
}

const sumHud = (a: HudCounts | undefined, b: HudCounts): HudCounts =>
  a ? (Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v + a[k as keyof HudCounts]])) as HudCounts) : { ...b }

// Колоды — своим случаем от seed: при тех же seed и числе раздач колоды те же, как бы ни ходили боты.
// Омаха (#147) — пот-лимит, как у стола ботов
function simulate(
  players: { id: string; style: BotStyle }[],
  hands: number,
  seed: number,
  game: Game = 'holdem',
  opts: SimOptions = { hud: true },
): Map<string, Stat> {
  const settings = game === 'omaha' ? ({ game: 'omaha', limit: 'pot' } as const) : ({ game: 'holdem' } as const)
  const def = game === 'omaha' ? OMAHA_GAME : HOLDEM_GAME
  const random = seededRandom(seed + 1)
  const decks = seededRandom(seed)
  const stats = new Map<string, Stat>(
    players.map((p) => [p.id, { hands: 0, vpip: 0, pfr: 0, tbChances: 0, tb: 0, aggr: 0, calls: 0, late: 0, air: 0, chips: 0, vs: {} }]),
  )
  const own = Object.fromEntries(players.map((p) => [p.id, p.style]))
  const styles = Object.fromEntries(players.filter((p) => !opts.unsigned?.(p.id)).map((p) => [p.id, p.style]))
  // HUD вечера: стол здесь новый на каждую раздачу — счётчики складываются сами
  const hud: Hud = {}
  const n = players.length
  for (let k = 0; k < hands; k++) {
    // Места по кругу: кнопка — всегда место 0, игроки сдвигаются на одно каждую раздачу
    const order = players.map((_, i) => players[(i + k) % n])
    let t = ok(createTable(order[0].id, order[0].id, { sb: BB / 2, bb: BB, startingStack: STACK, maxSeats: n, cards: 'phones', ...settings }, 0))
    for (const p of order.slice(1)) t = ok(handle(t, p.id, { v: PROTOCOL_VERSION, type: 'sit', name: p.id }, 0))
    t = ok(handle(t, order[0].id, { v: PROTOCOL_VERSION, type: 'start' }, 0, shuffle(deckFor(def), bytesOf(decks))))
    let moves = 0
    while (t.hand) {
      const id = toActId(t) as string
      const view = viewFor(t, id)
      const at = performance.now()
      const move = botMove(view, id, own[id], random, styles, opts.hud ? hud : undefined)
      slowest = Math.max(slowest, performance.now() - at)
      if (!move) throw new Error('нет хода')
      const h = t.hand
      const seat = h.seats.find((s) => s.id === id)!
      const aggressive = move.type === 'raise' || (move.type === 'allin' && seat.chips + seat.bet > h.currentBet)
      if ((h.stage === 'turn' || h.stage === 'river') && aggressive) {
        const s = stats.get(id)!
        s.late++
        if (air([...((h.cards?.hole[id] ?? []) as string[]), ...(h.cards?.board ?? [])])) s.air++
      }
      t = ok(handle(t, id, { v: PROTOCOL_VERSION, type: 'act', action: move }, 0))
      if (++moves > 300) throw new Error('раздача не кончается')
    }
    const log = t.lastHand?.record?.log ?? []
    for (const [id, c] of Object.entries(t.hud ?? {})) hud[id] = sumHud(hud[id], c)
    for (const p of t.players) {
      const s = stats.get(p.id)!
      const hud = t.hud?.[p.id]
      s.hands++
      s.vpip += hud?.vpip ?? 0
      s.pfr += hud?.pfr ?? 0
      s.chips += p.chips - STACK
    }
    // Кто у кого выиграл: проигрыш каждого — выигравшим пропорционально их выигрышу
    const won = t.players.filter((p) => p.chips > STACK)
    const total = won.reduce((sum, p) => sum + p.chips - STACK, 0)
    for (const l of t.players.filter((p) => p.chips < STACK)) {
      for (const w of won) {
        const flow = ((STACK - l.chips) * (w.chips - STACK)) / total
        stats.get(w.id)!.vs[l.id] = (stats.get(w.id)!.vs[l.id] ?? 0) + flow
        stats.get(l.id)!.vs[w.id] = (stats.get(l.id)!.vs[w.id] ?? 0) - flow
      }
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

// Самый долгий ход бота за прогон, мс
let slowest = 0

const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : 0)
const bb100 = (s: Stat) => (s.chips / BB / s.hands) * 100
// Против одного соперника: выиграно у него, bb на 100 раздач
const vs100 = (s: Stat, rival: string) => ((s.vs[rival] ?? 0) / BB / s.hands) * 100

function table(stats: Map<string, Stat>, styles: Record<string, BotStyle>): string {
  const ids = [...stats.keys()]
  const rows = [...stats].map(([id, s]) =>
    [
      styleLabel(styles[id]),
      pct(s.vpip, s.hands).toFixed(1),
      pct(s.pfr, s.hands).toFixed(1),
      pct(s.tb, s.tbChances).toFixed(1),
      (s.calls > 0 ? s.aggr / s.calls : s.aggr).toFixed(2),
      pct(s.air, s.late).toFixed(1),
      bb100(s).toFixed(1),
      ...ids.map((r) => (r === id ? '—' : vs100(s, r).toFixed(1))),
    ].join(' | '),
  )
  return [`Стиль | VPIP | PFR | 3-бет | Агрессия | Блефы тёрн/ривер, % | bb/100 | ${ids.map((r) => `против ${styleLabel(styles[r])}`).join(' | ')}`, ...rows].join('\n')
}

// Раздач в прогоне; отчёт PR — на 6000 раздач тем же тестом
const HANDS = 6000
// Омаха (#147): не меньше 3000 раздач
const OMAHA_HANDS = 3000

const PLAYERS = LEVEL_STYLES.mixed.map((style) => ({ id: style, style }))
const STYLES = Object.fromEntries(PLAYERS.map((p) => [p.id, p.style]))

// Прогон холдема — один на файл: с его агрессией сравнивается омаха
let holdemStats: Map<string, Stat> | null = null
function holdemRun(): Map<string, Stat> {
  if (!holdemStats) {
    const started = Date.now()
    holdemStats = simulate(PLAYERS, HANDS, 139)
    console.log(
      `Холдем: ${HANDS} раздач за ${((Date.now() - started) / 1000).toFixed(1)} с, самый долгий ход — ${slowest.toFixed(1)} мс\n${table(holdemStats, STYLES)}`,
    )
  }
  return holdemStats
}

const aggression = (x: Stat) => x.aggr / x.calls

// VPIP / PFR стиля — в полосе
function bandOf(stats: Map<string, Stat>, style: BotStyle, vpip: [number, number], pfr: [number, number]) {
  const x = stats.get(style)!
  expect(pct(x.vpip, x.hands), `${style} VPIP`).toBeGreaterThanOrEqual(vpip[0])
  expect(pct(x.vpip, x.hands), `${style} VPIP`).toBeLessThanOrEqual(vpip[1])
  expect(pct(x.pfr, x.hands), `${style} PFR`).toBeGreaterThanOrEqual(pfr[0])
  expect(pct(x.pfr, x.hands), `${style} PFR`).toBeLessThanOrEqual(pfr[1])
}

// Встреча двух стилей: стол на 6, трое против троих через место; дубликатом — те же колоды ещё раз,
// стили поменялись местами: везение карт гасится. Итог первого стиля — bb на 100 раздач
function duel(a: BotStyle, b: BotStyle, hands: number, seed: number, game: Game, opts?: SimOptions): number {
  const seat = (first: BotStyle, second: BotStyle) =>
    [0, 1, 2].flatMap((i) => [
      { id: `${first}${i}`, style: first },
      { id: `${second}${i}`, style: second },
    ])
  const both = [...simulate(seat(a, b), hands, seed, game, opts), ...simulate(seat(b, a), hands, seed, game, opts)]
  const list = both.filter(([id]) => id.startsWith(a)).map(([, x]) => x)
  return (list.reduce((sum, x) => sum + x.chips, 0) / BB / list.reduce((sum, x) => sum + x.hands, 0)) * 100
}

const DUELS: [BotStyle, BotStyle][] = [
  ['tag', 'abc'],
  ['lag', 'abc'],
  ['abc', 'nit'],
  ['abc', 'station'],
  ['abc', 'maniac'],
]

function duels(hands: number, seed: number, game: Game): void {
  const lines: string[] = []
  const results: [string, number][] = []
  for (const [a, b] of DUELS) {
    const x = duel(a, b, hands, seed, game)
    lines.push(`${styleLabel(a)} против ${styleLabel(b)}: ${x.toFixed(1)} bb/100`)
    results.push([`${a} против ${b}`, x])
  }
  console.log(`${game === 'omaha' ? 'Омаха' : 'Холдем'}, встречи по ${hands} раздач:\n${lines.join('\n')}`)
  for (const [name, x] of results) expect(x, name).toBeGreaterThan(0)
}

describe('стили ботов на прогоне между собой', () => {
  it('VPIP / PFR в полосах стилей, агрессия, сильные сильнее', () => {
    const stats = holdemRun()
    // Ход на телефоне — не дольше ≈ 0,2 с: здесь, на компьютере, с запасом в разы
    expect(slowest).toBeLessThan(100)
    const s = (style: BotStyle) => stats.get(style)!
    const band = (style: BotStyle, vpip: [number, number], pfr: [number, number]) => bandOf(stats, style, vpip, pfr)
    band('nit', [10, 16], [7, 13])
    band('station', [40, 100], [0, 8])
    band('maniac', [45, 100], [30, 100])
    band('abc', [20, 28], [12, 18])
    band('tag', [19, 25], [15, 21])
    band('lag', [27, 36], [22, 30])
    expect(s('station').aggr / s('station').calls).toBeLessThan(1)
    expect(s('maniac').aggr / s('maniac').calls).toBeGreaterThan(3)
    // Сильные в плюсе против ABC, ABC — против колл-станции и маньяка; по итогу стола сильные выше ABC,
    // ABC выше маньяка. ABC против нита за общим столом — около нуля: это проверяет встреча ниже
    expect(vs100(s('tag'), 'abc')).toBeGreaterThan(0)
    expect(vs100(s('lag'), 'abc')).toBeGreaterThan(0)
    for (const weak of ['station', 'maniac']) expect(vs100(s('abc'), weak), `ABC против ${weak}`).toBeGreaterThan(0)
    expect(bb100(s('tag'))).toBeGreaterThan(bb100(s('abc')))
    expect(bb100(s('lag'))).toBeGreaterThan(bb100(s('abc')))
    expect(bb100(s('abc'))).toBeGreaterThan(bb100(s('maniac')))
    strongAggression(stats)
    // ЛАГ блефует на тёрне и ривере чаще ТАГа — не меньше чем в 1,3 раза (#146)
    expect(bluffs(s('lag')) / bluffs(s('tag')), 'блефы ЛАГ к ТАГ').toBeGreaterThanOrEqual(1.3)
  }, 600_000)

  it('встречи: ТАГ и ЛАГ в плюсе против ABC, ABC — против нита, колл-станции и маньяка', () => {
    duels(2000, 45, 'holdem')
  }, 600_000)

  it('подстройка по HUD окупается: ТАГ против колл-станции и нита без подписи', () => {
    adapts(2000, 48, 'holdem')
  }, 600_000)
})

// Агрессия сильных после флопа (#146, Р-47): ТАГ 2–3, ЛАГ 2,5–3,5 и выше ТАГа
function strongAggression(stats: Map<string, Stat>): void {
  const tag = aggression(stats.get('tag')!)
  const lag = aggression(stats.get('lag')!)
  expect(tag, 'агрессия ТАГ').toBeGreaterThanOrEqual(2)
  expect(tag, 'агрессия ТАГ').toBeLessThanOrEqual(3)
  expect(lag, 'агрессия ЛАГ').toBeGreaterThanOrEqual(2.5)
  expect(lag, 'агрессия ЛАГ').toBeLessThanOrEqual(3.5)
  expect(lag, 'ЛАГ агрессивнее ТАГа').toBeGreaterThan(tag)
}

// Доля ставок и повышений на тёрне и ривере с рукой слабее пары
const bluffs = (x: Stat) => x.air / x.late

// Встреча дубликатом ТАГ против стиля без подписи (#146): соперника видно только по HUD. С подстройкой
// (HUD подан) и без (не подан — ТАГ считает его средним, ABC). С подстройкой ТАГ выигрывает больше
function adapts(hands: number, seed: number, game: Game): void {
  const lines: string[] = []
  for (const rival of ['station', 'nit'] as const) {
    const unsigned = (id: string) => id.startsWith(rival)
    const blind = duel('tag', rival, hands, seed, game, { hud: false, unsigned })
    const seen = duel('tag', rival, hands, seed, game, { hud: true, unsigned })
    lines.push(`ТАГ против ${styleLabel(rival)} без подписи: без подстройки ${blind.toFixed(1)}, с подстройкой ${seen.toFixed(1)} bb/100`)
    expect(seen, `подстройка против ${rival}`).toBeGreaterThan(blind)
  }
  console.log(`${game === 'omaha' ? 'Омаха' : 'Холдем'}, встречи по ${hands} раздач:\n${lines.join('\n')}`)
}

// Омаха пот-лимит (#147, Р-46): те же шесть стилей со своими для омахи диапазонами и полосами
describe('стили ботов в омахе на прогоне между собой', () => {
  it('VPIP / PFR в полосах омахи, агрессия, ход не дольше холдемного', () => {
    slowest = 0
    const started = Date.now()
    const stats = simulate(PLAYERS, OMAHA_HANDS, 147, 'omaha')
    const omahaSlowest = slowest
    console.log(
      `Омаха: ${OMAHA_HANDS} раздач за ${((Date.now() - started) / 1000).toFixed(1)} с, самый долгий ход — ${omahaSlowest.toFixed(1)} мс\n${table(stats, STYLES)}`,
    )
    expect(omahaSlowest).toBeLessThan(100)
    const band = (style: BotStyle, vpip: [number, number], pfr: [number, number]) => bandOf(stats, style, vpip, pfr)
    band('nit', [12, 20], [7, 14])
    band('station', [45, 100], [0, 8])
    band('maniac', [50, 100], [30, 100])
    band('abc', [22, 32], [12, 20])
    band('tag', [22, 30], [15, 23])
    band('lag', [32, 42], [22, 32])
    const s = (style: BotStyle) => stats.get(style)!
    expect(aggression(s('station'))).toBeLessThan(1)
    expect(aggression(s('maniac'))).toBeGreaterThan(3)
    // ТАГ и ЛАГ после флопа — в тех же полосах агрессии, что в холдеме (#146)
    strongAggression(stats)
  }, 600_000)

  it('встречи в омахе: ТАГ и ЛАГ в плюсе против ABC, ABC — против нита, колл-станции и маньяка', () => {
    duels(1500, 46, 'omaha')
  }, 600_000)

  it('подстройка по HUD в омахе окупается: ТАГ против колл-станции и нита без подписи', () => {
    adapts(1500, 49, 'omaha')
  }, 600_000)
})
