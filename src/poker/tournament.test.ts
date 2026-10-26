import { describe, expect, it } from 'vitest'
import { gameFromTournament, tournamentResults } from '../calc/pokerGame'
import { tournamentView } from '../calc/pokerView'
import { balance, playerTotals } from '../calc/totals'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { closeRebuyWait, createTable, handle, nextDeadline, onTime, waitingRebuy, type Settings, type TableState } from './table'
import { allin, award, call, check, fold, MODES, newTable, play, start, type Step } from './testing'
import {
  buildLevels,
  clockAt,
  DEFAULT_TOURNAMENT,
  defaultPrizes,
  LEVEL_COUNT,
  prizeAmounts,
  rebuyOpen,
  standings,
  type TournamentSettings,
  type TournamentState,
} from './tournament'

const MIN = 60_000
const send = (state: TableState, from: string, body: ClientBody, now = 0) => handle(state, from, { v: PROTOCOL_VERSION, ...body }, now)
const at = (step: Step, now: number): Step => ({ ...step, now })

// Турнир: блайнды 10/20, стек 1000, уровень — 10 минут, бай-ин 500 ₽
function cup(t: Partial<TournamentSettings> = {}, s: Partial<Settings> = {}): Partial<Settings> {
  return {
    sb: 10,
    bb: 20,
    startingStack: 1000,
    format: 'tournament',
    tournament: { ...DEFAULT_TOURNAMENT, buyIn: 500, levelMinutes: 10, ...t },
    ...s,
  }
}

// Стеки до начала турнира — прямо в столе: правка стека в турнире закрыта
function withStacks(state: TableState, stacks: Record<string, number>): TableState {
  const next = structuredClone(state)
  for (const p of next.players) if (p.id in stacks) p.chips = stacks[p.id]
  return next
}

function clock(c: Partial<TournamentState> = {}): TournamentState {
  return { startedAt: 0, pausedAt: null, pausedMs: 0, entrants: [], prizes: [100], out: [], endedAt: null, ...c }
}

describe('шкалы уровней', () => {
  it('классика: от стартовых блайндов по шкале, после последнего — не растут', () => {
    const levels = buildLevels({ ...DEFAULT_TOURNAMENT, scheme: 'classic' }, 10, 20)
    expect(levels).toHaveLength(LEVEL_COUNT)
    expect(levels.slice(0, 6)).toEqual([
      { sb: 10, bb: 20, ante: 0 },
      { sb: 15, bb: 30, ante: 0 },
      { sb: 20, bb: 40, ante: 0 },
      { sb: 30, bb: 60, ante: 0 },
      { sb: 40, bb: 80, ante: 0 },
      { sb: 50, bb: 100, ante: 0 },
    ])
    expect(levels.at(-1)).toEqual({ sb: 1200, bb: 2400, ante: 0 })
  })

  it('проценты: каждый уровень больше прошлого на N %, с округлением', () => {
    const levels = buildLevels({ ...DEFAULT_TOURNAMENT, scheme: 'percent', growthPct: 50 }, 10, 20)
    expect(levels.slice(0, 4).map((l) => [l.sb, l.bb])).toEqual([
      [10, 20],
      [15, 30],
      [23, 45], // 22,5 и 45
      [34, 68], // 33,75 и 67,5
    ])
  })

  it('анте — % от большого блайнда уровня', () => {
    const levels = buildLevels({ ...DEFAULT_TOURNAMENT, antePct: 10 }, 10, 20)
    expect(levels.slice(0, 3).map((l) => l.ante)).toEqual([2, 3, 4])
  })
})

describe('уровень по времени', () => {
  const t = { ...DEFAULT_TOURNAMENT, levelMinutes: 10 }

  it('от старта: номер уровня и сколько до следующего', () => {
    expect(clockAt(t, clock({ startedAt: 1000 }), 1000)).toEqual({ index: 0, msLeft: 10 * MIN })
    expect(clockAt(t, clock({ startedAt: 1000 }), 1000 + 25 * MIN)).toEqual({ index: 2, msLeft: 5 * MIN })
    // После последнего уровня — он и остаётся, отсчёта нет
    expect(clockAt(t, clock(), 10 * MIN * LEVEL_COUNT + 1)).toEqual({ index: LEVEL_COUNT - 1, msLeft: null })
  })

  it('пауза: часы стоят; прошлые паузы не считаются', () => {
    // Встали на 8-й минуте: и через час — тот же уровень и те же 2 минуты
    expect(clockAt(t, clock({ pausedAt: 8 * MIN }), 68 * MIN)).toEqual({ index: 0, msLeft: 2 * MIN })
    // Стояли 30 минут: на 41-й минуте от старта прошло 11
    expect(clockAt(t, clock({ pausedMs: 30 * MIN }), 41 * MIN)).toEqual({ index: 1, msLeft: 9 * MIN })
  })
})

describe('призы', () => {
  it('по умолчанию: до 4 — всё первому, 5–7 — 65/35, от 8 — 50/30/20', () => {
    expect([2, 4, 5, 7, 8, 10].map(defaultPrizes)).toEqual([[100], [100], [65, 35], [65, 35], [50, 30, 20], [50, 30, 20]])
  })

  it('в рублях по местам; не делится ровно — остаток первому', () => {
    expect(prizeAmounts(3000, [50, 30, 20])).toEqual([1500, 900, 600])
    expect(prizeAmounts(1001, [65, 35])).toEqual([651, 350])
    expect(prizeAmounts(1000, [33, 33, 34])).toEqual([330, 330, 340])
    expect(prizeAmounts(7, [50, 30, 20])).toEqual([4, 2, 1])
  })
})

describe('анте в кэше', () => {
  it('ставят все до блайндов, в банк, не в ставку круга: большой блайнд может чек', () => {
    const s = play(newTable(['h', 'a', 'b'], { ante: 5 }), [start('h')], false)
    const hand = s.hand!
    expect(hand.ante).toBe(5)
    expect(hand.seats.map((x) => [x.chips, x.bet, x.committed])).toEqual([
      [995, 0, 5],
      [990, 5, 10],
      [985, 10, 15],
    ])
    expect(hand.log.filter((e) => e.type === 'ante')).toHaveLength(3)
    const after = play(s, [call('h'), call('a')], false)
    expect(after.hand?.toAct).toBe(2) // большой блайнд: колл до 10 покрыл его — чек можно
    expect(play(after, [check('b')], false).hand?.stage).toBe('flop')
  })

  it('не хватает на анте — олл-ин на остаток; банк — слоями', () => {
    const base = newTable(['h', 'a', 'b'], { ante: 5 }, { h: 3 })
    const s = play(base, [start('h')], false)
    expect(s.hand?.seats[0]).toMatchObject({ chips: 0, committed: 3, allIn: true, bet: 0 })
    expect(s.hand?.log[0]).toEqual({ street: 'preflop', playerId: 'h', type: 'ante', bet: 3, allIn: true })
    const done = play(s, [call('a'), check('b'), check('a'), check('b'), check('a'), check('b'), check('a'), check('b')], false)
    expect(done.hand?.pots.map((p) => p.amount)).toEqual([9, 24])
  })

  it('анте меняет ведущий между раздачами; в турнире — по уровням', () => {
    const s = newTable(['h', 'g'])
    const r = send(s, 'h', { type: 'tableSettings', ante: 2 })
    expect(r.ok && r.state.settings.ante).toBe(2)
    expect(send(s, 'h', { type: 'tableSettings', ante: -1 })).toEqual({ ok: false, error: 'Анте — целое число фишек, не меньше нуля' })
    expect(send(newTable(['h', 'g'], cup()), 'h', { type: 'tableSettings', ante: 2 })).toEqual({
      ok: false,
      error: 'В турнире анте — по уровням',
    })
  })

  it('столы до турнира — кэш без анте', () => {
    const old = newTable(['h', 'g'])
    delete old.settings.ante
    delete old.settings.format
    delete old.tournament
    const s = play(old, [start('h')], false)
    expect(s.hand?.ante).toBeUndefined()
    expect(s.hand?.seats.map((x) => x.committed)).toEqual([5, 10])
  })
})

describe.each(MODES)('турнир (%s)', (_, rt) => {
  // Торги закрыты: ведущий отдаёт банки — winner в каждом, где он претендует, иначе первому претенденту
  const won = (s: TableState, winner: string, now = 0) =>
    play(s, [award('h', s.hand!.pots.map((p) => (p.eligible.includes(winner) ? [winner] : [p.eligible[0]])), now)], rt)

  it('«Начать турнир» запускает часы; блайнды и анте — уровня на момент раздачи', () => {
    const t = { antePct: 10 }
    let s = play(newTable(['h', 'g'], cup(t)), [at(start('h'), 1000)], rt)
    expect(s.tournament).toMatchObject({ startedAt: 1000, entrants: ['h', 'g'], prizes: [100], out: [], endedAt: null })
    expect(s.hand).toMatchObject({ sb: 10, bb: 20, ante: 2 })
    // Уровень сменился во время раздачи — она доигрывается со своими; новая — со следующими
    s = won(play(s, [at(fold('h'), 1000 + 12 * MIN)], rt), 'g', 1000 + 12 * MIN)
    expect(s.hand).toBeNull()
    s = play(s, [at(start('h'), 1000 + 12 * MIN)], rt)
    expect(s.hand).toMatchObject({ sb: 15, bb: 30, ante: 3 })
  })

  it('«Перерыв» стоит часы, «Продолжить» — с того же места', () => {
    let s = won(play(newTable(['h', 'g'], cup()), [start('h'), at(fold('h'), 1)], rt), 'g', 1)
    s = play(s, [at({ from: 'h', msg: { type: 'pause', paused: true } }, 8 * MIN)], rt)
    expect(s.tournament?.pausedAt).toBe(8 * MIN)
    s = play(s, [at({ from: 'h', msg: { type: 'pause', paused: false } }, 60 * MIN)], rt)
    expect(s.tournament).toMatchObject({ pausedAt: null, pausedMs: 52 * MIN })
    // 61-я минута с начала, из них 9 — игра: ещё первый уровень
    s = play(s, [at(start('h'), 61 * MIN)], rt)
    expect(s.hand).toMatchObject({ sb: 10, bb: 20 })
  })

  it('раздача «сама» в турнире — тоже по уровню на момент начала', () => {
    let s = won(play(newTable(['h', 'g'], cup({}, { autoStart: 'fast' })), [start('h'), at(fold('h'), 25 * MIN)], rt), 'g', 25 * MIN)
    expect(s.nextHandAt).toBe(25 * MIN + 3000)
    s = onTime(s, 25 * MIN + 3000)!
    expect(s.hand).toMatchObject({ sb: 20, bb: 40 })
  })

  it('выбыли в одной раздаче — выше место у того, у кого было больше; остался один — турнир окончен', () => {
    const base = withStacks(newTable(['h', 'a', 'b'], cup()), { a: 300, b: 500 })
    // Кнопка — h, малый — a, большой — b; первым ходит h
    const s = won(play(base, [start('h'), allin('h'), allin('a'), allin('b')], rt), 'h', 5 * MIN)
    expect(s.tournament?.out.map((b) => b.playerId)).toEqual(['a', 'b'])
    expect(standings(s)).toEqual([
      { playerId: 'h', place: 1, out: false },
      { playerId: 'b', place: 2, out: true },
      { playerId: 'a', place: 3, out: true },
    ])
    expect(s.tournament?.endedAt).toBe(5 * MIN)
    expect(send(s, 'h', { type: 'start' })).toEqual({ ok: false, error: 'Турнир окончен' })
  })

  it('ребай — выбывшему до конца уровня N: стек стартовый, бай-ин — в журнал; после — отказ', () => {
    const base = withStacks(newTable(['h', 'a', 'b'], cup({ rebuyLevels: 1 })), { a: 100 })
    const busted = won(play(base, [start('h'), allin('h'), allin('a'), fold('b')], rt), 'h', 2 * MIN)
    expect(busted.tournament?.out.map((b) => b.playerId)).toEqual(['a'])
    expect(busted.tournament?.endedAt).toBeNull()
    // Не выбывшему ребая нет
    expect(send(busted, 'b', { type: 'tournamentRebuy' }, 3 * MIN)).toEqual({ ok: false, error: 'Ребай — когда кончились фишки' })
    // До конца уровня 1 (10 минут) — можно
    const r = send(busted, 'a', { type: 'tournamentRebuy' }, 10 * MIN - 1)
    expect(r.ok).toBe(true)
    const s = (r as { ok: true; state: TableState }).state
    expect(s.players.find((p) => p.id === 'a')).toMatchObject({ chips: 1000, buyIn: 2000 })
    expect(s.tournament?.out).toEqual([])
    expect(s.chipLog.at(-1)).toEqual({ kind: 'rebuy', playerId: 'a', by: 'a', from: 0, to: 1000, at: 10 * MIN - 1 })
    // Со второго уровня — отказ
    expect(send(busted, 'a', { type: 'tournamentRebuy' }, 10 * MIN)).toEqual({ ok: false, error: 'Ребай был до конца уровня 1' })
    expect(rebuyOpen(cup({ rebuyLevels: 1 }).tournament!, busted.tournament!, 10 * MIN)).toBe(false)
  })

  it('без ребая — отказ; докупы кэша и правка стека в турнире выключены', () => {
    const base = withStacks(newTable(['h', 'a', 'b'], cup()), { a: 100 })
    const s = won(play(base, [start('h'), allin('h'), allin('a'), fold('b')], rt), 'h')
    expect(send(s, 'a', { type: 'tournamentRebuy' })).toEqual({ ok: false, error: 'В этом турнире без ребая' })
    expect(send(s, 'b', { type: 'rebuy', amount: 500 })).toEqual({
      ok: false,
      error: 'В турнире докупов нет — ребай, когда кончились фишки',
    })
    expect(send(s, 'h', { type: 'setStack', playerId: 'b', chips: 5 })).toEqual({ ok: false, error: 'В турнире стек не правится' })
  })

  it('ушёл — выбыл сразу, место — по моменту ухода; новых после начала не сажаем', () => {
    // Кнопка — h, блайнды — a и b, первым ходит c
    let s = play(newTable(['h', 'a', 'b', 'c'], cup()), [start('h'), fold('c')], rt)
    s = play(s, [{ from: 'h', msg: { type: 'remove', playerId: 'c' } }], rt)
    expect(s.tournament?.out).toEqual([{ playerId: 'c', hand: 1, chips: 1000 }])
    expect(standings(s).at(-1)).toEqual({ playerId: 'c', place: 4, out: true })
    expect(send(s, 'x', { type: 'sit', name: 'X' })).toEqual({ ok: false, error: 'Турнир уже идёт — новых не сажаем' })
  })

  it('призовых мест больше, чем игроков, — турнир не начать, пока не поправят; призы — до начала', () => {
    const s = newTable(['h', 'g'], cup({ prizes: [60, 40] }))
    expect(send(s, 'h', { type: 'start' }).ok).toBe(true)
    const three = newTable(['h', 'g'], cup({ prizes: [50, 30, 20] }))
    expect(send(three, 'h', { type: 'start' })).toEqual({ ok: false, error: 'Призовых мест — 3, а игроков — 2: поправьте призы' })
    const fixed = send(three, 'h', { type: 'tableSettings', prizes: null })
    expect(fixed.ok && send(fixed.state, 'h', { type: 'start' }).ok).toBe(true)
    expect(send(three, 'h', { type: 'tableSettings', prizes: [50, 40] })).toEqual({
      ok: false,
      error: 'Проценты призов в сумме — 100, сейчас 90',
    })
    const started = won(play(s, [start('h'), fold('h')], rt), 'g')
    expect(send(started, 'h', { type: 'tableSettings', prizes: [100] })).toEqual({ ok: false, error: 'Призы меняются до начала турнира' })
  })

  describe('ждём ребай (#94)', () => {
    // Двое, ребай до конца уровня 2 (20 минут); g выбывает на 5-й минуте
    const bust = (t: Partial<TournamentSettings> = {}, s: Partial<Settings> = {}) =>
      won(play(withStacks(newTable(['h', 'g'], cup({ rebuyLevels: 2, ...t }, s)), { g: 100 }), [start('h'), allin('h'), allin('g')], rt), 'h', 5 * MIN)

    it('остался один, ребай открыт — турнир не окончен, раздача не начинается, срок — закрытие ребая', () => {
      const s = bust({}, { autoStart: 'fast' })
      expect(s.tournament?.out.map((b) => b.playerId)).toEqual(['g'])
      expect(s.tournament?.endedAt).toBeNull()
      expect(waitingRebuy(s, 5 * MIN)).toBe(true)
      expect(s.nextHandAt).toBeNull()
      expect(nextDeadline(s)).toBe(20 * MIN)
      expect(send(s, 'h', { type: 'start' }, 6 * MIN)).toEqual({ ok: false, error: 'Нужно хотя бы двое с фишками' })
      expect(onTime(s, 20 * MIN - 1)).toBeNull()
      // На экране: «Ждём ребай» и сколько осталось; «Закончить турнир» — ведущему, «Ребай» — выбывшему
      expect(tournamentView(s, 'h', 8 * MIN)).toMatchObject({ ended: false, waiting: true, waitLeft: 12 * MIN, canEnd: true })
      expect(tournamentView(s, 'g', 8 * MIN)).toMatchObject({ waiting: true, canEnd: false, canRebuy: true })
    })

    it('ребай в ожидании — снова в игре со стартовым стеком, турнир идёт дальше', () => {
      const s = play(bust({}, { autoStart: 'fast' }), [at({ from: 'g', msg: { type: 'tournamentRebuy' } }, 6 * MIN)], rt)
      expect(s.players.find((p) => p.id === 'g')).toMatchObject({ chips: 1000, buyIn: 2000 })
      expect(waitingRebuy(s, 6 * MIN)).toBe(false)
      expect(s.nextHandAt).toBe(6 * MIN + 3000)
      expect(onTime(s, 6 * MIN + 3000)?.hand).not.toBeNull()
    })

    it('ребай закрылся по часам — турнир окончен в минуту закрытия, места как при выбывании', () => {
      const s = bust()
      const ended = onTime(rt ? JSON.parse(JSON.stringify(s)) : s, 20 * MIN + 500)!
      expect(ended.tournament?.endedAt).toBe(20 * MIN)
      expect(nextDeadline(ended)).toBeNull()
      expect(standings(ended).map((x) => x.playerId)).toEqual(['h', 'g'])
      expect(tournamentResults(ended).map((r) => r.prize)).toEqual([1000, 0])
      expect(send(ended, 'g', { type: 'tournamentRebuy' }, 21 * MIN)).toEqual({ ok: false, error: 'Турнир окончен' })
      // Будильник опоздал, а пришло сообщение — тоже окончен
      const r = send(s, 'h', { type: 'sitOut', sittingOut: false }, 25 * MIN)
      expect(r.ok && r.state.tournament?.endedAt).toBe(20 * MIN)
      expect(closeRebuyWait(s, 20 * MIN - 1)).toBeNull()
    })

    it('«Закончить турнир» — ведущий, только пока с фишками один; окончен сразу', () => {
      const s = bust()
      expect(send(s, 'g', { type: 'endTournament' }, 7 * MIN)).toEqual({ ok: false, error: 'Это может только ведущий' })
      const r = send(s, 'h', { type: 'endTournament' }, 7 * MIN)
      expect(r.ok && r.state.tournament?.endedAt).toBe(7 * MIN)
      expect(r.ok && standings(r.state).map((x) => x.playerId)).toEqual(['h', 'g'])
      const running = play(newTable(['h', 'g'], cup({ rebuyLevels: 2 })), [start('h')], rt)
      expect(send(running, 'h', { type: 'endTournament' })).toEqual({ ok: false, error: 'Закончить турнир — когда с фишками остался один' })
      expect(send(newTable(['h', 'g'], cup()), 'h', { type: 'endTournament' })).toEqual({ ok: false, error: 'Турнир ещё не начат' })
    })

    it('ребай выключен — турнир окончен сразу, как раньше', () => {
      const s = bust({ rebuyLevels: 0 })
      expect(s.tournament?.endedAt).toBe(5 * MIN)
      expect(waitingRebuy(s, 5 * MIN)).toBe(false)
    })

    it('перерыв в ожидании — часы стоят, ребай не закрывается; «Продолжить» — срок сдвигается', () => {
      let s = play(bust(), [at({ from: 'h', msg: { type: 'pause', paused: true } }, 8 * MIN)], rt)
      expect(nextDeadline(s)).toBeNull()
      expect(onTime(s, 30 * MIN)).toBeNull()
      expect(waitingRebuy(s, 30 * MIN)).toBe(true)
      s = play(s, [at({ from: 'h', msg: { type: 'pause', paused: false } }, 40 * MIN)], rt)
      expect(s.tournament?.endedAt).toBeNull()
      expect(nextDeadline(s)).toBe(52 * MIN) // 20 минут игры + 32 перерыва
    })

    it('выбыли сразу двое — при окончании места по стеку до раздачи', () => {
      const base = withStacks(newTable(['h', 'a', 'b'], cup({ rebuyLevels: 1 })), { a: 300, b: 500 })
      const s = won(play(base, [start('h'), allin('h'), allin('a'), allin('b')], rt), 'h', 5 * MIN)
      expect(s.tournament?.endedAt).toBeNull()
      const r = send(s, 'h', { type: 'endTournament' }, 6 * MIN)
      expect(r.ok && standings(r.state).map((x) => x.playerId)).toEqual(['h', 'b', 'a'])
    })
  })

  it('хедз-ап — блайнды как в кэше: кнопка ставит малый', () => {
    const s = play(newTable(['h', 'g'], cup({ antePct: 10 })), [start('h')], rt)
    expect(s.hand?.seats.map((x) => [x.bet, x.committed])).toEqual([
      [10, 12],
      [20, 22],
    ])
  })
})

describe('итог турнира — игра «Фишек»', () => {
  // Пятеро, ребай до конца уровня 1; e выбывает и делает ребай, потом выбывают по одному
  function played(): TableState {
    const ids = ['h', 'a', 'b', 'c', 'e']
    let s = withStacks(newTable(ids, cup({ rebuyLevels: 1 })), { e: 50 })
    // Раздача 1: кнопка h, малый a, большой b; e выбывает
    s = play(s, [start('h'), fold('c'), allin('e'), fold('h'), fold('a'), call('b')], false)
    s = play(s, [award('h', [['b']], MIN), at({ from: 'e', msg: { type: 'tournamentRebuy' } }, 2 * MIN)], false)
    expect(s.tournament?.out).toEqual([])
    // Остальные выбывают по раздаче: кто-то ставит всё, b — всегда коллирует и берёт банк
    let guard = 0
    while (s.tournament?.endedAt === null && guard++ < 40) {
      s = play(s, [at(start('h'), 30 * MIN)], false)
      while (s.hand && s.hand.stage !== 'showdown') {
        const seat = s.hand.seats[s.hand.toAct]
        s = play(s, [seat.id === 'b' ? (seat.bet < s.hand.currentBet ? call('b') : check('b')) : allin(seat.id)], false)
      }
      if (s.hand) s = play(s, [award('h', s.hand.pots.map((p) => (p.eligible.includes('b') ? ['b'] : [p.eligible[0]])), 30 * MIN)], false)
    }
    return s
  }

  it('у каждого выигрыш = приз − все его бай-ины; игра в ноль и закрыта', () => {
    const s = played()
    expect(s.tournament?.endedAt).not.toBeNull()
    expect(standings(s)[0].playerId).toBe('b')
    // Фонд: 5 входов + 1 ребай = 6 × 500 ₽; 5 игроков — 65/35
    const results = tournamentResults(s)
    expect(results.map((r) => r.prize)).toEqual([1950, 1050, 0, 0, 0])
    expect(results.find((r) => r.name === 'E')).toMatchObject({ buyIns: 2 })
    let n = 0
    const game = gameFromTournament(s, { name: 'Турнир', date: '2026-10-26', now: '2026-10-26T20:00:00.000Z' }, () => `id${n++}`)
    expect(game.rate).toBe(1)
    expect(game.closed).toBe(true)
    expect(game.players.map((p) => p.name)).toEqual(['H', 'A', 'B', 'C', 'E'])
    const totals = playerTotals(game.players, game.entries, game.rate)
    expect(balance(totals).ok).toBe(true)
    const e = game.players.find((p) => p.name === 'E')!
    expect(game.entries.filter((x) => x.playerId === e.id).map((x) => [x.kind, x.chips])).toEqual([
      ['buyin', 500],
      ['rebuy', 500],
      ['cashout', 1050],
    ])
    const sum = results.reduce((acc, r) => acc + r.net, 0)
    expect(sum).toBe(0)
  })

  it('стол на одном телефоне — те же правила: создаётся с турниром', () => {
    const r = createTable('h', 'H', cup(), 0)
    expect(r.ok && r.state.settings.format).toBe('tournament')
    expect(createTable('h', 'H', { format: 'tournament' }, 0)).toEqual({ ok: false, error: 'Нет настроек турнира' })
    expect(createTable('h', 'H', cup({ levelMinutes: 0 }), 0)).toEqual({ ok: false, error: 'Уровень — от 1 до 120 минут' })
  })
})
