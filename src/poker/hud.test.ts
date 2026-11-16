import { describe, expect, it } from 'vitest'
import { localTableView, startLocalTable } from '../calc/localTable'
import { hudView, positionLabels, tableView } from '../calc/pokerView'
import { addHand, EMPTY_HUD, HUD_FEW_HANDS, stealSeat, type HudCounts } from './hud'
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

const MINUS = '−'

// Улицы флоп, тёрн, ривер — все дошедшие чекают по очереди
const checkDown = (ids: string[]): Step[] => [0, 1, 2].flatMap(() => ids.map(check))

describe('HUD вечера: счётчики по ходам раздачи', () => {
  // Кнопка p0, SB p1, BB p2
  it('рейз с кнопки, колл BB, продолженная ставка на флопе — каждое из пяти чисел', () => {
    let s = play(three(), [start('p0'), raise('p0', 30), fold('p1'), call('p2'), check('p2'), raise('p0', 40), fold('p2')], false)
    s = finish(s)
    // Банк 65 (p1 5, p2 30, p0 30; ставка 40 на флопе вернулась) — p0: +35 = +3,5 ББ, без вскрытия
    expect(counts(s, 'p0')).toEqual({
      ...ZERO,
      hands: 1,
      vpip: 1,
      pfr: 1,
      stealChances: 1,
      steals: 1,
      cbChances: 1,
      cbs: 1,
      raises: 2,
      calls: 0,
      flops: 1,
      netHands: 1,
      net: 350,
    })
    // SB сбросил после рейза — случая украсть не было, а случай 3-бета был
    expect(counts(s, 'p1')).toEqual({ ...ZERO, hands: 1, threeBetChances: 1, netHands: 1, net: -50 })
    expect(counts(s, 'p2')).toEqual({ ...ZERO, hands: 1, vpip: 1, calls: 1, threeBetChances: 1, flops: 1, netHands: 1, net: -300 })
    const more = { foldTo3Bet: null, wsd: null }
    expect(hudView(s, 'p0')).toEqual({ hands: 1, few: true, vpip: 100, pfr: 100, af: '∞', ats: 100, cb: 100, threeBet: null, wtsd: 0, bb100: '+350,0', ...more })
    expect(hudView(s, 'p1')).toEqual({ hands: 1, few: true, vpip: 0, pfr: 0, af: '—', ats: null, cb: null, threeBet: 0, wtsd: null, bb100: `${MINUS}50,0`, ...more })
    expect(hudView(s, 'p2')).toEqual({ hands: 1, few: true, vpip: 100, pfr: 0, af: '0,0', ats: null, cb: null, threeBet: 0, wtsd: 0, bb100: `${MINUS}300,0`, ...more })
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
    const after = addHand(before, s.hand!, { won: [], net: {} })
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

  it('страддл (#222) — не VPIP и не PFR, но во вложенном; колл страддла — вход, без рейза', () => {
    // Вчетвером: кнопка p0, SB p1, BB p2, страддл p3 — 20. p0 уравнивает, блайнды сбрасывают, страддл чекает
    const four = newTable(['p0', 'p1', 'p2', 'p3'], { straddle: true })
    const s = awardAll(play(four, [start('p0'), call('p0'), fold('p1'), fold('p2'), check('p3'), ...checkDown(['p3', 'p0'])], false), ['p0'])
    expect(counts(s, 'p3')).toMatchObject({ hands: 1, vpip: 0, pfr: 0, raises: 0, calls: 0, flops: 1, net: -200 })
    // Колл 2 ББ — VPIP без PFR; рейз над страддлом — первое повышение раздачи: кража с кнопки
    expect(counts(s, 'p0')).toMatchObject({ vpip: 1, pfr: 0, calls: 1, stealChances: 1, steals: 0, net: 350 })
    const raised = awardAll(play(four, [start('p0'), raise('p0', 60), fold('p1'), fold('p2'), fold('p3')], false), ['p0'])
    expect(counts(raised, 'p0')).toMatchObject({ vpip: 1, pfr: 1, steals: 1, threeBetChances: 0 })
    expect(counts(raised, 'p3')).toMatchObject({ vpip: 0, pfr: 0, threeBetChances: 1, threeBets: 0, net: -200 })
    // Страддл повышает в свой ход — это уже рейз
    const own = awardAll(play(four, [start('p0'), call('p0'), fold('p1'), fold('p2'), raise('p3', 60), fold('p0')], false), ['p3'])
    expect(counts(own, 'p3')).toMatchObject({ vpip: 1, pfr: 1, raises: 1 })
  })
})

// Банки торгов — все одному или делёж: winners — победители каждого банка
const awardAll = (s: TableState, winners: string[]): TableState =>
  play(s, [award(s.hostId, (s.hand?.pots ?? []).map(() => winners))], false)

describe('HUD вечера: 3-бет, фолд на 3-бет, WTSD, W$SD, bb/100 (#241)', () => {
  // Кнопка p0, SB p1, BB p2; блайнды 5/10
  it('открытие → 3-бет → пас: фолд на 3-бет у открывшего, 3-бет у перерейзившего; пас до флопа — не WTSD', () => {
    const s = finish(play(three(), [start('p0'), raise('p0', 30), raise('p1', 90), fold('p2'), fold('p0')], false))
    expect(counts(s, 'p0')).toMatchObject({ threeBetChances: 0, foldTo3BetChances: 1, foldsTo3Bet: 1, flops: 0, showdowns: 0 })
    expect(counts(s, 'p1')).toMatchObject({ threeBetChances: 1, threeBets: 1, foldTo3BetChances: 0, flops: 0 })
    // Перед BB два повышения — это случай 4-бета, не 3-бета
    expect(counts(s, 'p2')).toMatchObject({ threeBetChances: 0, flops: 0 })
    expect(hudView(s, 'p0')).toMatchObject({ foldTo3Bet: 100, threeBet: null, wtsd: null, wsd: null })
    expect(hudView(s, 'p1')).toMatchObject({ threeBet: 100, foldTo3Bet: null })
    // Непокрытые 60 вернулись p1: банк 70, p1 +40, p0 −30, p2 −10
    expect([counts(s, 'p0')?.net, counts(s, 'p1')?.net, counts(s, 'p2')?.net]).toEqual([-300, 400, -100])
  })

  it('лимп, затем 3-бет; случай 3-бета у каждого — один за раздачу, первый', () => {
    const s = finish(play(three(), [start('p0'), call('p0'), raise('p1', 40), call('p2'), raise('p0', 120), fold('p1'), call('p2'), ...checkDown(['p2', 'p0'])], false))
    // p0 доставил, затем против одного рейза — 3-бет; p2 против одного рейза уравнял, против двух — не случай
    expect(counts(s, 'p0')).toMatchObject({ threeBetChances: 1, threeBets: 1, foldTo3BetChances: 0 })
    expect(counts(s, 'p2')).toMatchObject({ threeBetChances: 1, threeBets: 0 })
    // p1 открыл, получил 3-бет и сбросил
    expect(counts(s, 'p1')).toMatchObject({ foldTo3BetChances: 1, foldsTo3Bet: 1 })
  })

  it('сквиз — тоже 3-бет: рейз, колл, перерейз', () => {
    const s = finish(play(three(), [start('p0'), raise('p0', 30), call('p1'), raise('p2', 120), fold('p0'), fold('p1')], false))
    expect(counts(s, 'p2')).toMatchObject({ threeBetChances: 1, threeBets: 1 })
    expect(counts(s, 'p1')).toMatchObject({ threeBetChances: 1, threeBets: 0 })
    expect(counts(s, 'p0')).toMatchObject({ foldTo3BetChances: 1, foldsTo3Bet: 1 })
  })

  it('4-бет — не 3-бет: перед ходом два повышения; открывший против 4-бета — не фолд на 3-бет', () => {
    const s = finish(play(three(), [start('p0'), raise('p0', 30), raise('p1', 90), raise('p2', 270), fold('p0'), fold('p1')], false))
    expect(counts(s, 'p2')).toMatchObject({ threeBetChances: 0, threeBets: 0, raises: 1 })
    expect(counts(s, 'p0')).toMatchObject({ foldTo3BetChances: 0, foldsTo3Bet: 0 })
    expect(counts(s, 'p1')).toMatchObject({ threeBetChances: 1, threeBets: 1 })
  })

  it('олл-ин до флопа со вскрытием — WTSD; банк взял другой — W$SD 0', () => {
    let s = play(three({ p0: 100 }), [start('p0'), allin('p0'), fold('p1'), call('p2')], false)
    expect(s.hand?.stage).toBe('showdown') // флоп и дальше досдаются вживую
    s = awardAll(s, ['p2'])
    expect(counts(s, 'p0')).toMatchObject({ flops: 1, showdowns: 1, showdownWins: 0, netHands: 1, net: -1000 })
    expect(counts(s, 'p2')).toMatchObject({ flops: 1, showdowns: 1, showdownWins: 1, net: 1050 })
    expect(counts(s, 'p1')).toMatchObject({ flops: 0, showdowns: 0 })
    expect(hudView(s, 'p0')).toMatchObject({ wtsd: 100, wsd: 0, bb100: `${MINUS}1000,0` })
    expect(hudView(s, 'p2')).toMatchObject({ wtsd: 100, wsd: 100 })
  })

  it('пас на флопе — флоп увидел, до вскрытия не дошёл; сплит на вскрытии — W$SD у обоих', () => {
    let s = finish(play(three(), [start('p0'), call('p0'), fold('p1'), check('p2'), raise('p2', 20), fold('p0')], false))
    expect(counts(s, 'p0')).toMatchObject({ flops: 1, showdowns: 0 })
    expect(hudView(s, 'p0')).toMatchObject({ wtsd: 0, wsd: null })
    s = awardAll(play(s, [start('p0'), call('p1'), fold('p2'), check('p0'), ...checkDown(['p0', 'p1'])], false), ['p0', 'p1'])
    expect(counts(s, 'p0')).toMatchObject({ hands: 2, flops: 2, showdowns: 1, showdownWins: 1 })
    expect(counts(s, 'p1')).toMatchObject({ flops: 1, showdowns: 1, showdownWins: 1 })
    expect(hudView(s, 'p0')).toMatchObject({ wtsd: 50, wsd: 100 })
  })

  it('bb/100 при смене блайндов: ББ — свой у каждой раздачи, итог — в сотых ББ', () => {
    const seats = [{ id: 'a' }, { id: 'b' }]
    let hud = addHand({}, { seats, button: 0, bb: 10, log: [] }, { won: ['a'], net: { a: 50, b: -50 } }) // +5 ББ
    hud = addHand(hud, { seats, button: 1, bb: 20, log: [] }, { won: ['b'], net: { a: -20, b: 20 } }) // −1 ББ
    hud = addHand(hud, { seats, button: 0, bb: 30, log: [] }, { won: ['a'], net: { a: 5, b: -5 } }) // +0,17 ББ
    expect(hud.a).toMatchObject({ hands: 3, netHands: 3, net: 500 - 100 + 17 })
    expect(hudView({ ...three(), hud }, 'a')?.bb100).toBe('+139,0')
    expect(hudView({ ...three(), hud }, 'b')?.bb100).toBe(`${MINUS}139,0`)
    // Итог неизвестен (нет в net) — раздача в bb/100 не идёт, в раздачи HUD — идёт
    hud = addHand(hud, { seats, button: 1, bb: 10, log: [] }, { won: [], net: { b: 10 } })
    expect(hud.a).toMatchObject({ hands: 4, netHands: 3 })
    expect(hud.b).toMatchObject({ netHands: 4, net: -417 + 100 })
  })

  it('HUD от старого сервера (без новых полей) — «—», старый стол считает новые с нуля', () => {
    const old = { hands: 40, vpip: 10, pfr: 5, stealChances: 4, steals: 2, cbChances: 3, cbs: 1, raises: 6, calls: 9 }
    const t = { ...three(), hud: { p0: old } }
    expect(hudView(t, 'p0')).toMatchObject({ hands: 40, vpip: 25, threeBet: null, foldTo3Bet: null, wtsd: null, wsd: null, bb100: null })
    const s = finish(play(t, [start('p0'), raise('p0', 30), fold('p1'), fold('p2')], false))
    // bb/100 — по раздачам с итогом, а не по всем 41
    expect(counts(s, 'p0')).toMatchObject({ hands: 41, netHands: 1, net: 150, threeBetChances: 0 })
    expect(hudView(s, 'p0')?.bb100).toBe('+150,0')
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

const ZERO: HudCounts = { ...EMPTY_HUD }

function idMaker(): () => string {
  let k = 0
  return () => `id${k++}`
}
