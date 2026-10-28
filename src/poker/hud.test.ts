import { describe, expect, it } from 'vitest'
import { localTableView, startLocalTable } from '../calc/localTable'
import { hudView, positionLabels, tableView } from '../calc/pokerView'
import { addHand, HUD_FEW_HANDS, stealSeat, type HudCounts } from './hud'
import { viewFor, type TableState } from './table'
import { award, allin, call, check, fold, MODES, newTable, play, raise, stackedDeck, start, type Step } from './testing'

const three = (stacks: Record<string, number> = {}, publicHud?: boolean) =>
  newTable(['p0', 'p1', 'p2'], publicHud === undefined ? {} : { publicHud }, stacks)

// Торги закрыты — ведущий отдаёт каждый банк первому из претендентов
function finish(s: TableState): TableState {
  const pots = s.hand?.pots ?? []
  return play(s, [award(s.hostId, pots.map((p) => [p.eligible[0]]))], false)
}

const counts = (s: TableState, id: string) => s.hud?.[id]

// Улицы флоп, тёрн, ривер — все дошедшие чекают по очереди
const checkDown = (ids: string[]): Step[] => [0, 1, 2].flatMap(() => ids.map(check))

describe('HUD вечера: счётчики по ходам раздачи', () => {
  // Кнопка p0, SB p1, BB p2
  it('рейз с кнопки, колл BB, продолженная ставка на флопе — каждое из пяти чисел', () => {
    let s = play(three(), [start('p0'), raise('p0', 30), fold('p1'), call('p2'), check('p2'), raise('p0', 40), fold('p2')], false)
    s = finish(s)
    expect(counts(s, 'p0')).toEqual({
      hands: 1,
      vpip: 1,
      pfr: 1,
      stealChances: 1,
      steals: 1,
      cbChances: 1,
      cbs: 1,
      raises: 2,
      calls: 0,
    })
    // SB сбросил после рейза — случая украсть не было
    expect(counts(s, 'p1')).toEqual({ ...ZERO, hands: 1 })
    expect(counts(s, 'p2')).toEqual({ ...ZERO, hands: 1, vpip: 1, calls: 1 })
    expect(hudView(s, 'p0')).toEqual({ hands: 1, few: true, vpip: 100, pfr: 100, af: '∞', ats: 100, cb: 100 })
    expect(hudView(s, 'p1')).toEqual({ hands: 1, few: true, vpip: 0, pfr: 0, af: '—', ats: null, cb: null })
    expect(hudView(s, 'p2')).toEqual({ hands: 1, few: true, vpip: 100, pfr: 0, af: '0,0', ats: null, cb: null })
  })

  it('блайнд не VPIP: SB доставил до большого — VPIP, BB чекнул — нет', () => {
    const s = finish(play(three(), [start('p0'), fold('p0'), call('p1'), check('p2'), ...checkDown(['p1', 'p2'])], false))
    expect(counts(s, 'p1')).toMatchObject({ hands: 1, vpip: 1, pfr: 0, calls: 1, stealChances: 1, steals: 0 })
    expect(counts(s, 'p2')).toMatchObject({ hands: 1, vpip: 0, pfr: 0, calls: 0, raises: 0 })
    // Кнопка сбросила, когда рейза не было, — случай украсть был, кражи нет
    expect(counts(s, 'p0')).toMatchObject({ hands: 1, vpip: 0, stealChances: 1, steals: 0 })
  })

  it('раздача без торгов (все сбросили до хода BB) — засчитана всем, VPIP нет ни у кого', () => {
    const s = finish(play(three(), [start('p0'), fold('p0'), fold('p1')], false))
    for (const id of ['p0', 'p1', 'p2']) expect(counts(s, id)).toMatchObject({ hands: 1, vpip: 0, pfr: 0 })
    expect(hudView(s, 'p2')).toMatchObject({ vpip: 0, af: '—' })
  })

  it('PFR и CB: рейз после рейза — оба PFR, CB — у последнего повысившего; чек на флопе — случай без ставки', () => {
    const steps = [start('p0'), raise('p0', 30), call('p1'), raise('p2', 90), call('p0'), fold('p1'), raise('p2', 100), call('p0')]
    const s = finish(play(three(), [...steps, check('p2'), check('p0'), check('p2'), check('p0')], false))
    expect(counts(s, 'p0')).toMatchObject({ pfr: 1, cbChances: 0, raises: 1, calls: 2 })
    expect(counts(s, 'p2')).toMatchObject({ pfr: 1, cbChances: 1, cbs: 1, stealChances: 0 })
    expect(counts(s, 'p1')).toMatchObject({ vpip: 1, pfr: 0, stealChances: 0 })
    expect(hudView(s, 'p0')?.af).toBe('0,5')

    const quiet = finish(play(three(), [start('p0'), raise('p0', 30), fold('p1'), call('p2'), ...checkDown(['p2', 'p0'])], false))
    expect(counts(quiet, 'p0')).toMatchObject({ cbChances: 1, cbs: 0 })
    expect(hudView(quiet, 'p0')?.cb).toBe(0)
  })

  it('олл-ин выше ставки круга — рейз, в пределах уравнивания — колл', () => {
    const s = finish(play(three({ p2: 20 }), [start('p0'), raise('p0', 30), fold('p1'), allin('p2')], false))
    expect(counts(s, 'p2')).toMatchObject({ vpip: 1, pfr: 0, calls: 1, raises: 0 })
    const up = finish(play(three({ p0: 25 }), [start('p0'), allin('p0'), fold('p1'), fold('p2')], false))
    expect(counts(up, 'p0')).toMatchObject({ vpip: 1, pfr: 1, raises: 1, stealChances: 1, steals: 1 })
  })

  it('хедз-ап: ATS — только у кнопки (она же SB), у BB — никогда', () => {
    let s = newTable(['p0', 'p1'])
    // Кнопка p0 повышает, BB уравнивает; затем кнопка у p1 — он лишь доставляет
    s = finish(play(s, [start('p0'), raise('p0', 30), call('p1'), ...checkDown(['p1', 'p0'])], false))
    s = finish(play(s, [start('p0'), call('p1'), check('p0'), ...checkDown(['p0', 'p1'])], false))
    expect(counts(s, 'p0')).toMatchObject({ hands: 2, stealChances: 1, steals: 1, cbChances: 1, cbs: 0 })
    expect(counts(s, 'p1')).toMatchObject({ hands: 2, stealChances: 1, steals: 0 })
    expect(hudView(s, 'p0')?.ats).toBe(100)
    expect(hudView(s, 'p1')?.ats).toBe(0)
  })

  it('позиции кражи — BTN, SB и CO по подписям экрана, без BB', () => {
    for (let n = 2; n <= 10; n++) {
      const labels = positionLabels(n)
      labels.forEach((label, rel) => {
        expect(stealSeat(rel, n), `${n} мест, ${label}`).toBe(['BTN', 'BTN/SB', 'SB', 'CO'].includes(label))
      })
    }
  })

  it('AF без коллов — «∞», без рейзов и коллов — «—», иначе с одним знаком', () => {
    const table = (c: Partial<HudCounts>) => ({ ...three(), hud: { p0: { ...ZERO, hands: 1, ...c } } })
    expect(hudView(table({ raises: 3 }), 'p0')?.af).toBe('∞')
    expect(hudView(table({}), 'p0')?.af).toBe('—')
    expect(hudView(table({ raises: 3, calls: 2 }), 'p0')?.af).toBe('1,5')
    expect(hudView(table({ vpip: 1, hands: 3 }), 'p0')?.vpip).toBe(33)
    expect(hudView(table({ hands: HUD_FEW_HANDS }), 'p0')?.few).toBe(false)
    expect(hudView(table({ hands: HUD_FEW_HANDS - 1 }), 'p0')?.few).toBe(true)
    expect(hudView(three(), 'p0')).toBeNull() // раздач ещё не было
  })

  it('прибавляет к прежним, прежние не меняет', () => {
    const s = play(three(), [start('p0'), fold('p0'), fold('p1')], false)
    const before = { p0: { ...ZERO, hands: 5, vpip: 2 } }
    const after = addHand(before, s.hand!)
    expect(before.p0.hands).toBe(5)
    expect(after.p0).toMatchObject({ hands: 6, vpip: 2, stealChances: 1 })
    expect(after.p2).toMatchObject({ hands: 1 })
  })

  it('карты на телефонах: до флопа — первый круг торгов, тот же счёт', () => {
    const deck = stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s'])
    const s = play(newTable(['p0', 'p1', 'p2'], { cards: 'phones' }), [start('p0', deck), raise('p0', 30), fold('p1'), fold('p2')], false)
    expect(s.hand).toBeNull() // банк раздан сам
    expect(counts(s, 'p0')).toMatchObject({ hands: 1, vpip: 1, pfr: 1, steals: 1 })
  })
})

describe.each(MODES)('HUD вечера: стол и вид — %s', (_, roundtrip) => {
  const hand = [start('p0'), raise('p0', 30), fold('p1'), call('p2'), check('p2'), raise('p0', 40), fold('p2')]

  it('«только свою» (по умолчанию): чужой HUD в вид игрока не приходит', () => {
    const s = finish(play(three(), hand, roundtrip))
    expect(s.settings.publicHud).toBeUndefined()
    const mine = viewFor(s, 'p1')
    expect(Object.keys(mine.hud ?? {})).toEqual(['p1'])
    expect(JSON.stringify(mine)).not.toContain('"p0":{')
    const v = tableView(mine, 'p1', 0)
    expect(v.seats.map((x) => x.hud !== null)).toEqual([false, true, false])
    expect(v.me?.hud?.hands).toBe(1)
    // Не вошедшему — ничьего
    expect(viewFor(s, null).hud).toEqual({})
  })

  it('«видят все»: HUD всех мест у каждого', () => {
    const s = finish(play(three({}, true), hand, roundtrip))
    expect(viewFor(s, 'p1')).toBe(s)
    expect(tableView(viewFor(s, 'p1'), 'p1', 0).seats.map((x) => x.hud?.vpip)).toEqual([100, 0, 100])
  })

  it('ведущий меняет «HUD видят» между раздачами, в раздаче — нет', () => {
    let s = finish(play(three(), hand, roundtrip))
    s = play(s, [{ from: 'p0', msg: { type: 'tableSettings', publicHud: true } }], roundtrip)
    expect(s.settings.publicHud).toBe(true)
    expect(() => play(s, [{ from: 'p1', msg: { type: 'tableSettings', publicHud: false } }], roundtrip)).toThrow('только ведущий')
    s = play(s, [start('p0')], roundtrip)
    expect(() => play(s, [{ from: 'p0', msg: { type: 'tableSettings', publicHud: false } }], roundtrip)).toThrow('между раздачами')
  })

  it('ушёл и вернулся (вне сети и снова в сети) — счётчики на месте; новый стол — с нуля', () => {
    let s = finish(play(three(), hand, roundtrip))
    s = play(s, [{ from: 'p2', online: false }, { from: 'p2', online: true }], roundtrip)
    expect(counts(s, 'p2')).toMatchObject({ hands: 1, vpip: 1 })
    expect(three().hud).toEqual({})
  })

  it('убранный со стола — без счётчиков', () => {
    let s = finish(play(three(), hand, roundtrip))
    s = play(s, [{ from: 'p0', msg: { type: 'remove', playerId: 'p2' } }], roundtrip)
    expect(s.hud?.p2).toBeUndefined()
    expect(counts(s, 'p0')?.hands).toBe(1)
  })

  it('стол до выкатки (без поля hud) — HUD с нуля, без ошибок', () => {
    const old = three()
    delete old.hud
    expect(tableView(old, 'p0', 0).seats.every((x) => x.hud === null)).toBe(true)
    const s = finish(play(old, hand, roundtrip))
    expect(counts(s, 'p0')?.hands).toBe(1)
  })
})

describe('HUD вечера: стол на одном телефоне', () => {
  it('HUD у всех мест — телефон один', () => {
    const r = startLocalTable([{ name: 'Аня', regularId: null }, { name: 'Боря', regularId: null }], { sb: 5, bb: 10, startingStack: 1000, felt: 'green' }, 0, idMaker())
    if (!r.ok) throw new Error(r.error)
    const t = r.local.table
    const [a, b] = t.players.map((p) => p.id)
    const s = finish(play(t, [start(a), raise(a, 30), fold(b)], false))
    expect(localTableView(s, 0).seats.map((x) => x.hud?.hands)).toEqual([1, 1])
  })
})

const ZERO: HudCounts = { hands: 0, vpip: 0, pfr: 0, stealChances: 0, steals: 0, cbChances: 0, cbs: 0, raises: 0, calls: 0 }

function idMaker(): () => string {
  let k = 0
  return () => `id${k++}`
}
