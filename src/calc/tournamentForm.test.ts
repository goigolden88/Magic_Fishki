import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../poker/protocol'
import { handle, type TableState } from '../poker/table'
import { allin, award, fold, newTable, play, start } from '../poker/testing'
import { DEFAULT_TOURNAMENT } from '../poker/tournament'
import { formatNumber } from './format'
import { startLocalTable, tournamentRebuyFor } from './localTable'
import { clockText, tableView } from './pokerView'
import { formSettings, levelText, prizeRuleText, prizesSum, tournamentForm } from './tournamentForm'

const MIN = 60_000

describe('форма «Кэш» / «Турнир»', () => {
  it('сначала — кэш без анте', () => {
    expect(formSettings(tournamentForm(4))).toEqual({ ok: true, settings: { format: 'cash', ante: 0 } })
    expect(formSettings({ ...tournamentForm(4), ante: '2,5' })).toEqual({ ok: false, error: 'Анте — целое число фишек, не меньше нуля' })
  })

  it('турнир: поля — в настройки; призы по умолчанию — по числу игроков', () => {
    const form = { ...tournamentForm(6), format: 'tournament' as const, buyIn: '1 500', rebuy: true, rebuyLevels: '3' }
    expect(form.prizes).toEqual(['65', '35'])
    expect(formSettings(form)).toEqual({
      ok: true,
      settings: { format: 'tournament', tournament: { ...DEFAULT_TOURNAMENT, buyIn: 1500, rebuyLevels: 3 } },
    })
  })

  it('подписи: уровень и правило призов', () => {
    expect(levelText({ sb: 10, bb: 20, ante: 0 })).toBe('10/20')
    expect(levelText({ sb: 500, bb: 1000, ante: 100 })).toBe(`500/${formatNumber(1000)}, анте 100`)
    expect(prizeRuleText()).toBe('до 4 игроков — всё первому, 5–7 — 65/35, от 8 — 50/30/20')
  })

  it('свои призы — сумма 100; ошибки — словами стола', () => {
    const form = { ...tournamentForm(8), format: 'tournament' as const, prizesOwn: true, prizes: ['60', '30'] }
    expect(prizesSum(form.prizes)).toBe(90)
    expect(formSettings(form)).toEqual({ ok: false, error: 'Проценты призов в сумме — 100, сейчас 90' })
    expect(formSettings({ ...form, prizes: ['60', '40'] })).toMatchObject({ ok: true, settings: { tournament: { prizes: [60, 40] } } })
    expect(formSettings({ ...form, prizesOwn: false, minutes: '0' })).toEqual({ ok: false, error: 'Уровень — от 1 до 120 минут' })
    expect(formSettings({ ...form, prizesOwn: false, buyIn: '' })).toEqual({ ok: false, error: 'Бай-ин — целое число рублей больше нуля' })
  })
})

describe('турнир на экране', () => {
  const cup = { format: 'tournament' as const, sb: 10, bb: 20, tournament: { ...DEFAULT_TOURNAMENT, levelMinutes: 10, buyIn: 500, rebuyLevels: 1 } }

  it('до начала — первый уровень целиком, фонд и призы по числу игроков', () => {
    const v = tableView(newTable(['h', 'a', 'b'], cup), 'h', 0).tournament!
    expect(v).toMatchObject({ started: false, level: 1, blinds: { sb: 10, bb: 20 }, next: { sb: 15, bb: 30 }, nextLeft: 10 * MIN })
    expect(v.pool).toBe(1500)
    expect(v.prizes).toEqual([{ place: 1, pct: 100, amount: 1500 }])
    expect(tableView(newTable(['h', 'g']), 'h', 0).tournament).toBeNull()
  })

  it('идёт: уровень и отсчёт по времени сервера; выбывший — с местом и «Ребай»', () => {
    let s: TableState = newTable(['h', 'a', 'b'], cup)
    s.players[1].chips = 100
    s = play(s, [start('h'), allin('h'), allin('a'), fold('b'), award('h', [['h']])], false)
    const v = tableView(s, 'a', 13 * MIN + 30_000)
    expect(v.tournament).toMatchObject({ level: 2, nextLeft: 6 * MIN + 30_000, rebuyOpen: false, canRebuy: false })
    expect(clockText(v.tournament!.nextLeft!)).toBe('06:30')
    expect(v.seats.find((x) => x.id === 'a')?.place).toBe(3)
    expect(v.seats.find((x) => x.id === 'h')?.place).toBeNull()
    expect(tableView(s, 'a', 5 * MIN).tournament?.canRebuy).toBe(true)
    expect(tableView(s, 'b', 5 * MIN).tournament?.canRebuy).toBe(false)
  })

  it('на одном телефоне: турнир и ребай за игрока', () => {
    let n = 0
    const r = startLocalTable(
      [
        { name: 'Аня', regularId: null },
        { name: 'Боря', regularId: null },
        { name: 'Вера', regularId: null },
      ],
      { sb: 10, bb: 20, startingStack: 100, felt: 'green', format: 'tournament', tournament: cup.tournament },
      0,
      () => `id${n++}`,
    )
    if (!r.ok) throw new Error(r.error)
    const [h, a, b] = r.local.table.players.map((p) => p.id)
    let s = r.local.table
    s = play(s, [start(h), allin(h), allin(a), fold(b)], false)
    s = play(s, [award(h, [[h]])], false)
    expect(s.tournament?.out.map((x) => x.playerId)).toEqual([a])
    const rebuy = tournamentRebuyFor(s, a, MIN)
    expect(rebuy.ok && rebuy.state.players.find((p) => p.id === a)?.chips).toBe(100)
    expect(handle(s, a, { v: PROTOCOL_VERSION, type: 'tournamentRebuy' }, 10 * MIN).ok).toBe(false)
  })
})
