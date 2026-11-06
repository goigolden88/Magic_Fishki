import { describe, expect, it } from 'vitest'
import { deckFor, HOLDEM_GAME } from '../poker/game'
import { finishedHand, keepHand, type HistoryHand } from '../poker/history'
import { HUD_FEW_HANDS, type HudCounts } from '../poker/hud'
import { createTable, type Settings, type TableState } from '../poker/table'
import { award, call, check, fold, play, raise, start, type Step } from '../poker/testing'
import { localEvening, roomEvening, savedHands, type SavedHand } from './evenings'
import { allTimeHud } from './pokerAllTime'
import { countsView } from './pokerView'

type Run = { state: TableState; history: HistoryHand[] }

// Стол с постоянными: regularId нет — гость
function table(players: { id: string; name: string; regularId?: string }[], settings: Partial<Settings>): Run {
  const [host, ...rest] = players
  const r = createTable(host.id, host.name, settings, 0, host.regularId ?? null)
  if (!r.ok) throw new Error(r.error)
  const sits: Step[] = rest.map((p) => ({
    from: p.id,
    msg: { type: 'sit', name: p.name, ...(p.regularId ? { regularId: p.regularId } : {}) },
  }))
  return { state: play(r.state, sits, false), history: [] }
}

// Шаги по одному, история вечера — как у телефона (finishedHand → keepHand)
function go(run: Run, steps: Step[]): Run {
  let { state, history } = run
  for (const step of steps) {
    const next = play(state, [step], false)
    history = keepHand(history, finishedHand(state, next))
    state = next
  }
  return { state, history }
}

// Живые карты: торги закрыты — ведущий отдаёт каждый банк первому из претендентов
function finish(run: Run): Run {
  const pots = run.state.hand?.pots ?? []
  return go(run, [award(run.state.hostId, pots.map((p) => [p.eligible[0]]))])
}

const checkDown = (ids: string[], streets: number): Step[] => Array.from({ length: streets }, () => ids.map(check)).flat()

const ZERO: HudCounts = { hands: 0, vpip: 0, pfr: 0, stealChances: 0, steals: 0, cbChances: 0, cbs: 0, raises: 0, calls: 0 }

function sum(...list: (HudCounts | undefined)[]): HudCounts {
  const out = { ...ZERO }
  for (const c of list) if (c) for (const k of Object.keys(out) as (keyof HudCounts)[]) out[k] += c[k]
  return out
}

const PETYA = { id: 'r-petya', name: 'Петя' }
const KOLYA = { id: 'r-kolya', name: 'Коля' }
const VASYA = { id: 'r-vasya', name: 'Вася' }

// Вечер A — комната, карты на телефонах: Петя и Коля — постоянные, Вася — гость.
// Кнопка a0, малый a1, большой a2; во второй раздаче кнопка у a1
function eveningA(): { run: Run; saved: SavedHand[] } {
  let run = table(
    [
      { id: 'a0', name: 'Петя', regularId: PETYA.id },
      { id: 'a1', name: 'Вася' },
      { id: 'a2', name: 'Коля', regularId: KOLYA.id },
    ],
    { cards: 'phones' },
  )
  run = go(run, [start('a0', deckFor(HOLDEM_GAME)), raise('a0', 30), call('a1'), fold('a2'), ...checkDown(['a1', 'a0'], 3)])
  run = go(run, [start('a0', deckFor(HOLDEM_GAME)), raise('a1', 30), fold('a2'), call('a0'), check('a0'), raise('a1', 40), fold('a0')])
  return { run, saved: savedHands(roomEvening('KQ7MZP', run.state, 'a0'), run.history) }
}

// Вечер B — стол на телефоне, живые карты: Коля ведёт, Петя — постоянный, и гость тоже «Петя».
// Кнопка b0, малый b1, большой b2; во второй раздаче кнопка у b1
function eveningB(): { run: Run; saved: SavedHand[] } {
  let run = table(
    [
      { id: 'b0', name: 'Коля', regularId: KOLYA.id },
      { id: 'b1', name: 'Петя', regularId: PETYA.id },
      { id: 'b2', name: 'Петя' },
    ],
    {},
  )
  run = finish(go(run, [start('b0'), raise('b0', 30), call('b1'), fold('b2'), check('b1'), raise('b0', 40), fold('b1')]))
  run = finish(
    go(run, [start('b0'), raise('b1', 30), call('b2'), fold('b0'), check('b2'), raise('b1', 40), call('b2'), ...checkDown(['b2', 'b1'], 2)]),
  )
  return { run, saved: savedHands(localEvening('01B', run.state), run.history) }
}

describe('покер за всё время: HUD постоянного по сохранённым вечерам', () => {
  const a = eveningA()
  const b = eveningB()
  const all = [...a.saved, ...b.saved]

  it('сумма двух вечеров — как HUD вечера за столом на тех же раздачах', () => {
    expect(a.saved).toHaveLength(2)
    expect(b.saved).toHaveLength(2)
    expect(a.saved.every((s) => s.hand.record)).toBe(true) // карты на телефонах — запись раздачи
    expect(b.saved.every((s) => s.hand.live)).toBe(true) // живые карты — места и ходы раздачи

    const petya = allTimeHud(PETYA, all)
    expect(petya).toEqual(sum(a.run.state.hud?.a0, b.run.state.hud?.b1))
    expect(petya.hands).toBe(4)
    expect(petya.pfr).toBeGreaterThan(0)
    expect(petya.cbs).toBeGreaterThan(0)
    expect(allTimeHud(KOLYA, all)).toEqual(sum(a.run.state.hud?.a2, b.run.state.hud?.b0))
  })

  it('гость с именем постоянного не засчитывается постоянному', () => {
    // Гость «Петя» в вечере B входил в раздачи — у постоянного Пети его чисел нет
    expect(b.run.state.hud?.b2?.vpip).toBeGreaterThan(0)
    expect(allTimeHud(PETYA, b.saved)).toEqual(b.run.state.hud?.b1)
    // Вася в вечере A — гость: постоянному Васе ничего
    expect(allTimeHud(VASYA, all)).toEqual(ZERO)
  })

  it('удалённый вечер — его раздачи уходят из счёта', () => {
    expect(allTimeHud(PETYA, b.saved)).toEqual(sum(b.run.state.hud?.b1))
    expect(allTimeHud(PETYA, [])).toEqual(ZERO)
  })

  it('не играл в покер — раздач нет, блока нет', () => {
    const none = allTimeHud({ id: 'r-masha', name: 'Маша' }, all)
    expect(none).toEqual(ZERO)
    expect(countsView(none)).toBeNull()
  })

  it('записи до Р-55 — по имени; двое с этим именем в раздаче — раздача не в счёт', () => {
    const old = all.map(({ table: t, ...rest }) => ({ ...rest, ...(t ? { table: { ...t, regulars: undefined } } : {}) }))
    // В вечере B два «Пети» — не различить, только вечер A
    expect(allTimeHud(PETYA, old)).toEqual(sum(a.run.state.hud?.a0))
    expect(allTimeHud(KOLYA, old)).toEqual(sum(a.run.state.hud?.a2, b.run.state.hud?.b0))
    // Гость Вася в старых записях не отличить от постоянного
    expect(allTimeHud(VASYA, old)).toEqual(a.run.state.hud?.a1)
  })

  it('мало раздач — как строка HUD у места', () => {
    const view = countsView(allTimeHud(PETYA, all))
    expect(view).toMatchObject({ hands: 4, few: true })
    expect(countsView({ ...ZERO, hands: HUD_FEW_HANDS, vpip: 15 })).toMatchObject({ few: false, vpip: 50 })
  })
})
