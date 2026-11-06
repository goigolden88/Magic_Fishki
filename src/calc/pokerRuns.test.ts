import { describe, expect, it } from 'vitest'
import type { Card } from '../poker/cards'
import type { HistoryHand } from '../poker/history'
import type { ClientBody } from '../poker/protocol'
import { RUN_VOTE_MS } from '../poker/runs'
import { viewFor, type Settings, type TableState } from '../poker/table'
import { allin, call, newTable, play, stackedDeck, start, type Step } from '../poker/testing'
import { BOARD_GROUP, dealPlan, flyKey, STREET_TOTAL_MS, tableSnapshot } from './dealAnimation'
import { roomEvening, savedHands } from './evenings'
import { handText } from './handText'
import { historyHandView, historyList, lastHandRecord, tableView } from './pokerView'
import { runView } from './pokerRuns'
import { roomSettings, ROOM_DEFAULTS, runsText } from './quickRoom'

const RUNS: Partial<Settings> = { cards: 'phones', maxRuns: 2 }
const choose = (from: string, times: number): Step => ({ from, msg: { type: 'runChoice', times } as ClientBody })

// Хедз-ап: у p1 тузы, у p0 короли; борд 1 — тузам, борд 2 — каре королей
const BOARD_1: Card[] = ['2c', '3d', '7h', '9s', 'Jd']
const BOARD_2: Card[] = ['Kd', 'Kc', '4s', '5h', '8d']
const DECK = stackedDeck([['As', 'Ah'], ['Ks', 'Kh']], [...BOARD_1, ...BOARD_2])

// Двое за столом в раздаче, третий смотрит
function allInTable(): TableState {
  const t = play(newTable(['p0', 'p1', 'p2'], RUNS), [{ from: 'p2', msg: { type: 'sitOut', sittingOut: true } }], false)
  return play(t, [start('p0', DECK), allin('p0'), call('p1')], false)
}

describe('выбор на экране', () => {
  it('дошедшим — кнопки 1…max с отсчётом; остальным — кто выбирает', () => {
    const s = allInTable()
    expect(runView(s, 'p0', 2000)).toEqual({
      line: 'Сколько раз прогнать?',
      left: RUN_VOTE_MS / 1000 - 2,
      canChoose: true,
      choices: [1, 2],
      answer: null,
      waiting: ['P0', 'P1'],
    })
    const t = play(s, [choose('p0', 2)], false)
    expect(runView(t, 'p0', 0)?.answer).toBe(2)
    expect(runView(t, 'p2', 0)).toMatchObject({ line: 'P0, P1 выбирают, сколько раз прогнать', canChoose: false, waiting: ['P1'] })
    expect(runView(play(newTable(['p0', 'p1'], RUNS), [start('p0', DECK)], false), 'p0', 0)).toBeNull()
  })

  it('описание стола и настройка при создании', () => {
    expect(runsText({ cards: 'phones', maxRuns: 2 })).toBe('прогон до двух раз')
    expect(runsText({ cards: 'phones', maxRuns: 3 })).toBe('прогон до трёх раз')
    expect(runsText({ cards: 'phones' })).toBeNull()
    expect(runsText({ cards: 'live', maxRuns: 3 })).toBeNull()
    const base = { ...ROOM_DEFAULTS, startingStack: 1000 }
    expect(roomSettings({ ...base, maxRuns: 3 }).maxRuns).toBe(3)
    expect('maxRuns' in roomSettings({ ...base, maxRuns: 1 })).toBe(false)
    expect('maxRuns' in roomSettings({ ...base, cards: 'live', maxRuns: 2 })).toBe(false)
  })
})

describe('два борда: стол, прошлая раздача, история, выгрузка', () => {
  const done = play(allInTable(), [choose('p0', 2), choose('p1', 2)], false)
  const hand = done.lastHand as HistoryHand

  it('на столе — два борда друг под другом, у каждого свой победитель', () => {
    const v = tableView(viewFor(done, 'p2'), 'p2', 0)
    expect(v.board).toEqual(BOARD_1)
    expect(v.runs?.map((r) => [r.label, r.cards, r.winners])).toEqual([
      ['Борд 1', BOARD_1, 'P1 — Пара, тузы'],
      ['Борд 2', BOARD_2, 'P0 — Каре, короли'],
    ])
    expect(v.runs?.[1].win).toEqual(['Kd', 'Kc', '8d'])
    expect(v.boardWin).toBeNull()
    expect(v.seats.map((s) => s.handName)).toEqual([null, null, null])
  })

  it('прошлая раздача и история — оба борда', () => {
    const last = lastHandRecord(done)
    expect(last?.runs?.map((r) => r.cards)).toEqual([BOARD_1, BOARD_2])
    expect(last?.players.map((p) => [p.name, p.won])).toEqual([
      ['P0', 1000],
      ['P1', 1000],
    ])
    expect(historyList([hand])).toEqual([{ number: 1, board: BOARD_1, wins: [{ name: 'P1', amount: 1000 }, { name: 'P0', amount: 1000 }], more: [BOARD_2] }])
    expect(historyHandView(hand).runs?.map((r) => r.winners)).toEqual(['P1 — Пара, тузы', 'P0 — Каре, короли'])
    expect(historyHandView(hand).pots).toEqual([{ label: 'Банк', amount: 2000, winners: ['P0', 'P1'] }])
  })

  it('выгрузка — каждый борд своими улицами и вскрытием', () => {
    const text = handText(savedHands(roomEvening('KQ7MZP', done, 'p0'), [hand])[0])
    expect(text).toContain(`*** FIRST FLOP *** [2c 3d 7h]`)
    expect(text).toContain(`*** FIRST RIVER *** [2c 3d 7h 9s] [Jd]`)
    expect(text).toContain(`*** SECOND FLOP *** [Kd Kc 4s]`)
    expect(text).toContain(`*** SECOND RIVER *** [Kd Kc 4s 5h] [8d]`)
    expect(text).toContain('*** FIRST SHOW DOWN ***')
    expect(text).toContain('*** SECOND SHOW DOWN ***')
    expect(text).toContain('Hand was run twice')
    expect(text).toContain('FIRST Board [2c 3d 7h 9s Jd]')
    expect(text).toContain('SECOND Board [Kd Kc 4s 5h 8d]')
    expect(text).not.toContain('*** FLOP ***')
  })

  it('HUD считает раздачу один раз', () => {
    expect(done.hud?.p0?.hands).toBe(1)
    expect(done.hud?.p1?.hands).toBe(1)
  })

  it('анимация: первый борд, следом новые карты второго', () => {
    const before = tableSnapshot(tableView(viewFor(allInTable(), 'p2'), 'p2', 0))
    const after = tableSnapshot(tableView(viewFor(done, 'p2'), 'p2', 0))
    const plan = dealPlan(before, after)
    expect(plan?.kind).toBe('street')
    expect(plan?.flights.map((f) => f.key)).toEqual([
      ...[0, 1, 2, 3, 4].map((i) => flyKey(BOARD_GROUP, i)),
      ...[0, 1, 2, 3, 4].map((i) => flyKey('board-2', i)),
    ])
    expect(plan!.flights[5].delay).toBeGreaterThanOrEqual(STREET_TOTAL_MS)
  })
})
