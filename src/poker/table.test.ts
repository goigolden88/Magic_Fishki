// Мак на вскрытии (#279): порядок вскрытия, кто открывает и кто сбрасывает без показа, что видит каждый телефон
import { describe, expect, it } from 'vitest'
import { lastHandRecord } from '../calc/pokerView'
import type { Card } from './cards'
import { handFor } from './history'
import type { OwnGame } from './ownGame'
import { PROTOCOL_VERSION } from './protocol'
import {
  AUTO_START_MS,
  createTable,
  handle,
  hiddenOf,
  MUCK_VOTE_MS,
  MUCK_WAIT,
  nextDeadline,
  onTime,
  viewFor,
  type Settings,
  type TableState,
} from './table'
import { allin, call, check, MODES, newTable, play, raise, stackedDeck, start, type Step } from './testing'

const MUCK: Partial<Settings> = { cards: 'phones', muck: 'auto' }
const BOARD: Card[] = ['2s', '7h', '9d', 'Jc', '3c']
// Кнопка p0, сдают с p1: у p1 — король старший, у p2 — две пары (семёрки и двойки), у p0 — пара тузов
const HOLE: Card[][] = [
  ['Kh', 'Qh'],
  ['2c', '7d'],
  ['Ah', 'Ad'],
]
const preflop: Step[] = [call('p0'), call('p1'), check('p2')]
const checks = (n: number): Step[] => Array.from({ length: n }, (_, k) => check(['p1', 'p2', 'p0'][k % 3]))

const tryStep = (s: TableState, from: string, body: Record<string, unknown>) => {
  const r = handle(s, from, { v: PROTOCOL_VERSION, ...body }, 0)
  return r.ok ? r.state : r.error
}

function hand3(settings: Partial<Settings>, steps: Step[], rt: boolean, hole = HOLE, board = BOARD, stacks = {}): TableState {
  return play(newTable(['p0', 'p1', 'p2'], settings, stacks), [start('p0', stackedDeck(hole, board)), ...steps], rt)
}

// Ривер: p2 ставит, p0 и p1 уравнивают — первым открывает p2
const riverBet: Step[] = [...preflop, ...checks(6), check('p1'), raise('p2', 20), call('p0'), call('p1')]

describe.each(MODES)('мак на вскрытии (%s)', (_, rt) => {
  it('порядок: первым — последний повысивший на ривере; хуже уже открытой — сброс без показа', () => {
    const s = hand3(MUCK, riverBet, rt)
    const record = s.lastHand!.record!
    expect(record.shown).toEqual({ p2: ['2c', '7d'] })
    expect(record.mucked).toEqual(['p0', 'p1'])
    expect(record.hidden).toEqual({ p0: ['Ah', 'Ad'], p1: ['Kh', 'Qh'] })
    // Кто сколько взял — как без мака
    const open = hand3({ cards: 'phones' }, riverBet, rt)
    expect(s.lastHand?.payouts).toEqual(open.lastHand?.payouts)
    expect(s.lastHand?.pots).toEqual(open.lastHand?.pots)
  })

  it('порядок без ставок на последнем круге — от кнопки: первый открыт, хоть и проиграл', () => {
    // Ставка была на флопе, ривер — чеки: первым открывает p1 (слева от кнопки) с королём старшим, p2 — сильнее, p0 — хуже p2
    const steps: Step[] = [...preflop, check('p1'), check('p2'), raise('p0', 20), call('p1'), call('p2'), ...checks(6)]
    const record = hand3(MUCK, steps, rt).lastHand!.record!
    expect(Object.keys(record.shown).sort()).toEqual(['p1', 'p2'])
    expect(record.mucked).toEqual(['p0'])
  })

  it('проигравший, который ставил последним, — открыт первым', () => {
    const steps: Step[] = [...preflop, ...checks(6), raise('p1', 20), call('p2'), call('p0')]
    const record = hand3(MUCK, steps, rt).lastHand!.record!
    expect(Object.keys(record.shown).sort()).toEqual(['p1', 'p2'])
    expect(record.mucked).toEqual(['p0'])
  })

  it('рука не хуже открытой — открывается: ничья открыта вся', () => {
    // На столе — стрит, руки не играют: у всех один стрит, ни одной сброшенной
    const board: Card[] = ['8s', '9h', 'Td', 'Jc', 'Qs']
    const hole: Card[][] = [
      ['2h', '3d'],
      ['4h', '5d'],
      ['3h', '4d'],
    ]
    const record = hand3(MUCK, riverBet, rt, hole, board).lastHand!.record!
    expect(Object.keys(record.shown).sort()).toEqual(['p0', 'p1', 'p2'])
    expect(record.mucked).toBeUndefined()
  })

  it('побочный банк: взявший его вторым открыт, хуже его в побочном — сброс', () => {
    // p1 (малый блайнд) олл-ин на 100 с тузами — основной банк его; p2 с королями берёт побочный у p0 с дамами
    const hole: Card[][] = [
      ['Ah', 'Ad'],
      ['Kh', 'Kd'],
      ['Qh', 'Qd'],
    ]
    // На флопе p2 ставит, p0 уравнивает — побочный банк; ривер — чеки: первым открывает p1 (слева от кнопки)
    const steps: Step[] = [call('p0'), allin('p1'), call('p2'), call('p0'), raise('p2', 50), call('p0'), check('p2'), check('p0'), check('p2'), check('p0')]
    const s = hand3(MUCK, steps, rt, hole, BOARD, { p1: 100 })
    const record = s.lastHand!.record!
    expect(s.lastHand?.pots.map((p) => p.winners)).toEqual([['p1'], ['p2']])
    expect(Object.keys(record.shown).sort()).toEqual(['p1', 'p2'])
    expect(record.mucked).toEqual(['p0'])
  })

  it('олл-ин, торговаться больше некому, — открываются все', () => {
    const t = newTable(['p0', 'p1'], MUCK)
    const s = play(t, [start('p0', stackedDeck([['Kh', 'Qh'], ['Ah', 'Ad']], BOARD)), allin('p0'), call('p1')], rt)
    const record = s.lastHand!.record!
    expect(Object.keys(record.shown).sort()).toEqual(['p0', 'p1'])
    expect(record.mucked).toBeUndefined()
    expect(record.hidden).toEqual({})
  })

  it('хай/лоу: проигравший старшую, но взявший лоу, открыт; хуже по обеим — сброс', () => {
    const game: OwnGame = { id: 'own-h8', name: 'Холдем хай/лоу', hole: 2, fromHand: 'any', deck: 52, order: 'standard', board: [3, 1, 1], limit: 'nolimit', hiLo: true }
    const settings: Partial<Settings> = { ...MUCK, games: [game], game: game.id }
    // p1 — тройка королей без лоу (первый: от кнопки), p2 — валеты без лоу, p0 — туз старший и лоу 7-4-3-2-A
    const hole: Card[][] = [
      ['Ks', 'Kd'],
      ['Jc', 'Jh'],
      ['Ah', '3c'],
    ]
    const s = hand3(settings, [...preflop, ...checks(9)], rt, hole, ['2s', '4h', '7d', 'Kc', 'Qs'])
    const record = s.lastHand!.record!
    expect(record.split).toEqual([{ hi: ['p1'], lo: ['p0'] }])
    expect(Object.keys(record.shown).sort()).toEqual(['p0', 'p1'])
    expect(record.mucked).toEqual(['p2'])
    // Лоу и рука сбросившего — только ему
    expect(viewFor(s, 'p0').lastHand?.record?.hands.p2).toBeUndefined()
    expect(viewFor(s, 'p2').lastHand?.record?.hands.p2).toBe(record.hands.p2)
  })

  it('без поля muck — все открывают, как раньше', () => {
    const record = hand3({ cards: 'phones' }, riverBet, rt).lastHand!.record!
    expect(Object.keys(record.shown).sort()).toEqual(['p0', 'p1', 'p2'])
    expect(record.mucked).toBeUndefined()
    expect(record.hidden).toEqual({})
  })

  it('карты, рука и пятёрка сбросившего — только ему: в столе, в истории и в итоге раздачи', () => {
    const s = hand3(MUCK, riverBet, rt)
    for (const me of ['p2', 'p1', null]) {
      const record = viewFor(s, me).lastHand!.record!
      expect(record.hands.p0).toBeUndefined()
      expect(record.best?.p0).toBeUndefined()
      expect(JSON.stringify(record)).not.toContain('"Ad"')
      expect(JSON.stringify(handFor(s.lastHand!, me).record)).not.toContain('"Ad"')
    }
    const mine = viewFor(s, 'p0').lastHand!.record!
    expect(mine.hidden).toEqual({ p0: ['Ah', 'Ad'] })
    expect(mine.hands.p0).toBe('Пара, тузы')
    expect(mine.hands.p1).toBeUndefined()
    expect(handFor(s.lastHand!, 'p0').record?.hands).toEqual(mine.hands)
    // Итог раздачи: у других — «сбросил без показа», у себя — свои карты, «не показаны»
    const other = lastHandRecord(viewFor(s, 'p2'))!.players.find((p) => p.name === 'P0')!
    expect(other).toMatchObject({ cards: null, hand: null, note: 'сбросил без показа' })
    const self = lastHandRecord(viewFor(s, 'p0'))!.players.find((p) => p.name === 'P0')!
    expect(self).toMatchObject({ cards: ['Ah', 'Ad'], hand: 'Пара, тузы', note: 'не показаны' })
    expect(lastHandRecord(viewFor(s, 'p0'))!.players.find((p) => p.name === 'P2')?.note).toBeNull()
  })

  it('после раздачи сбросивший без показа показывает карты — видно всё, до новой раздачи', () => {
    let s = hand3(MUCK, riverBet, rt)
    s = play(s, [{ from: 'p0', msg: { type: 'show', cards: [0, 1] } }], rt)
    expect(s.lastHand?.record?.shown.p0).toEqual(['Ah', 'Ad'])
    const view = viewFor(s, 'p2').lastHand!.record!
    expect(view.hands.p0).toBe('Пара, тузы')
    expect(lastHandRecord(viewFor(s, 'p2'))!.players.find((p) => p.name === 'P0')?.note).toBeNull()
    s = play(s, [start('p0', stackedDeck(HOLE, BOARD))], rt)
    expect(tryStep(s, 'p1', { type: 'show', cards: [0] })).toBe('Показать карты можно, когда раздача кончится, — до новой')
  })

  it('HUD: сбросивший без показа дошёл до вскрытия (WTSD), но не выиграл на нём; счётчики — как без мака', () => {
    const s = hand3(MUCK, riverBet, rt)
    const open = hand3({ cards: 'phones' }, riverBet, rt)
    expect(s.hud).toEqual(open.hud)
    expect(s.hud?.p0).toMatchObject({ showdowns: 1, showdownWins: 0 })
  })

  it('настройка: «Мак сам» или «Мак по выбору» и только с картами на телефонах; ведущий меняет между раздачами', () => {
    const BAD = 'Вскрытие — все открывают, мак сам или мак по выбору'
    expect(createTable('p0', 'P0', { cards: 'phones', muck: 'other' as 'auto' }, 0)).toEqual({ ok: false, error: BAD })
    expect(createTable('p0', 'P0', { cards: 'live', muck: 'auto' }, 0)).toEqual({ ok: false, error: 'Мак на вскрытии — только с картами на телефонах' })
    expect(createTable('p0', 'P0', { cards: 'live', muck: 'manual' }, 0)).toEqual({ ok: false, error: 'Мак на вскрытии — только с картами на телефонах' })
    expect(createTable('p0', 'P0', { cards: 'phones', muck: 'manual' }, 0).ok).toBe(true)
    let s = newTable(['p0', 'p1', 'p2'], { cards: 'phones' })
    s = play(s, [{ from: 'p0', msg: { type: 'tableSettings', muck: 'auto' } }], rt)
    expect(s.settings.muck).toBe('auto')
    expect(tryStep(s, 'p0', { type: 'tableSettings', muck: 'other' })).toBe(BAD)
    s = play(s, [{ from: 'p0', msg: { type: 'tableSettings', muck: 'manual' } }], rt)
    expect(s.settings.muck).toBe('manual')
    expect(tryStep(s, 'p1', { type: 'tableSettings', muck: null })).toBe('Это может только ведущий')
    s = play(s, [{ from: 'p0', msg: { type: 'tableSettings', muck: null } }], rt)
    expect(s.settings).not.toHaveProperty('muck')
  })

  it('запись без мака (до #279) читается: пометок нет', () => {
    const s = hand3({ cards: 'phones' }, riverBet, rt)
    const view = lastHandRecord(viewFor(s, 'p2'))!
    expect(view.players.map((p) => p.note)).toEqual([null, null, null])
    expect(view.players.every((p) => p.cards !== null)).toBe(true)
  })
})

// «Мак по выбору» (#286): проигравший, которого не обязывают показывать, решает сам — пауза MUCK_VOTE_MS после банка
const MANUAL: Partial<Settings> = { cards: 'phones', muck: 'manual' }
const answer = (from: string, show: boolean, now = 0): Step => ({ from, msg: { type: 'muck', show }, now })
const tryAt = (s: TableState, from: string, body: Record<string, unknown>, now: number) => {
  const r = handle(s, from, { v: PROTOCOL_VERSION, ...body }, now)
  return r.ok ? r.state : r.error
}
// Хедз-ап, кнопка p0, сдают с p1: у p1 тузы (открывает первым — слева от кнопки), у p0 король старший — решает
const HU_HOLE: Card[][] = [
  ['Ah', 'Ad'],
  ['Kh', 'Qh'],
]
const huChecks: Step[] = [call('p0'), check('p1'), ...Array.from({ length: 6 }, (_, k) => check(['p1', 'p0'][k % 2]))]

function headsUp(settings: Partial<Settings>, rt: boolean, steps: Step[] = huChecks, now = 1000): TableState {
  const t = newTable(['p0', 'p1'], settings)
  return play(t, [start('p0', stackedDeck(HU_HOLE, BOARD)), ...steps.map((x) => ({ ...x, now }))], rt)
}

describe.each(MODES)('мак по выбору (%s)', (_, rt) => {
  it('банк — сразу, затем пауза: решающий закрыт, его карт нет у соперника', () => {
    const s = headsUp(MANUAL, rt)
    expect(s.hand).toBeNull()
    expect(s.lastHand?.payouts).toEqual(headsUp({ cards: 'phones' }, rt).lastHand?.payouts)
    expect(s.muckVote).toEqual({ hand: 1, deadline: 1000 + MUCK_VOTE_MS, players: ['p0'], answers: {} })
    expect(s.lastHand?.record?.hidden).toEqual({ p0: ['Kh', 'Qh'] })
    expect(s.lastHand?.record?.mucked).toEqual(['p0'])
    expect(nextDeadline(s)).toBe(1000 + MUCK_VOTE_MS)
    // Тайна: пока идёт пауза, у соперника и не вошедшего — ни карт, ни руки
    for (const me of ['p1', null]) {
      const view = viewFor(s, me)
      expect(JSON.stringify(view)).not.toContain('"Kh"')
      expect(view.lastHand?.record?.hands.p0).toBeUndefined()
    }
    expect(hiddenOf(viewFor(s, 'p0').lastHand?.record)).toEqual({ p0: ['Kh', 'Qh'] })
  })

  it('«Сбросить» — пауза кончилась сразу, карты остались закрытыми', () => {
    const s = play(headsUp(MANUAL, rt), [answer('p0', false, 2000)], rt)
    expect(s.muckVote ?? null).toBeNull()
    expect(s.lastHand?.record?.mucked).toEqual(['p0'])
    expect(JSON.stringify(viewFor(s, 'p1'))).not.toContain('"Kh"')
    // Показать потом — кнопкой «Показать» (#278), как прежде
    const shown = play(s, [{ from: 'p0', msg: { type: 'show', cards: [0, 1] } }], rt)
    expect(shown.lastHand?.record?.shown.p0).toEqual(['Kh', 'Qh'])
  })

  it('«Показать» — карты всем, мака нет', () => {
    const s = play(headsUp(MANUAL, rt), [answer('p0', true, 2000)], rt)
    expect(s.muckVote ?? null).toBeNull()
    const record = s.lastHand!.record!
    expect(record.shown.p0).toEqual(['Kh', 'Qh'])
    expect(record.hidden).toEqual({})
    expect(record.mucked).toBeUndefined()
    expect(viewFor(s, 'p1').lastHand?.record?.hands.p0).toBe(record.hands.p0)
  })

  it('не ответил до конца паузы — карты открываются', () => {
    const s = headsUp(MANUAL, rt)
    expect(onTime(s, 1000 + MUCK_VOTE_MS - 1)).toBeNull()
    const t = onTime(s, 1000 + MUCK_VOTE_MS) as TableState
    expect(t.muckVote).toBeNull()
    expect(t.lastHand?.record?.shown.p0).toEqual(['Kh', 'Qh'])
    expect(t.lastHand?.record?.mucked).toBeUndefined()
    expect(onTime(t, 1000 + MUCK_VOTE_MS)).toBeNull()
  })

  it('решающий вне сети — пауза не ждёт его, карты открываются', () => {
    const t = newTable(['p0', 'p1'], MANUAL)
    const steps: Step[] = [start('p0', stackedDeck(HU_HOLE, BOARD)), ...huChecks.slice(0, -1), { from: 'p0', online: false }, huChecks.at(-1)!]
    const s = play(t, steps, rt)
    expect(s.muckVote ?? null).toBeNull()
    expect(s.lastHand?.record?.shown.p0).toEqual(['Kh', 'Qh'])
  })

  it('ответить дважды, чужому, не решающему и без паузы — отказ', () => {
    const s = headsUp(MANUAL, rt)
    expect(tryAt(s, 'p1', { type: 'muck', show: false }, 2000)).toBe('Показать или сбросить решает тот, кто проиграл на вскрытии')
    expect(tryAt(s, 'p0', { type: 'muck', show: 'да' }, 2000)).toBe('Неизвестное сообщение — обновите приложение')
    expect(tryAt(s, 'p0', { type: 'show', cards: [0] }, 2000)).toBe('Сначала ответьте: показать или сбросить')
    const done = play(s, [answer('p0', false, 2000)], rt)
    expect(tryAt(done, 'p0', { type: 'muck', show: true }, 2000)).toBe('Выбора «показать или сбросить» сейчас нет')
    expect(tryAt(headsUp({ cards: 'phones' }, rt), 'p0', { type: 'muck', show: true }, 2000)).toBe('Выбора «показать или сбросить» сейчас нет')
  })

  it('трое, двое решают — одна пауза на обоих; ответил один — ждёт второго; ответили оба — кончилась сразу', () => {
    let s = hand3(MANUAL, riverBet, rt)
    expect(s.muckVote).toMatchObject({ players: ['p0', 'p1'], answers: {} })
    expect(s.lastHand?.record?.shown).toEqual({ p2: ['2c', '7d'] })
    s = play(s, [answer('p1', true)], rt)
    expect(s.muckVote).toMatchObject({ players: ['p0', 'p1'], answers: { p1: true } })
    expect(s.lastHand?.record?.shown.p1).toEqual(['Kh', 'Qh'])
    // Ответ одного не открывает карты другого
    expect(JSON.stringify(viewFor(s, 'p2'))).not.toContain('"Ad"')
    expect(tryStep(s, 'p1', { type: 'muck', show: false })).toBe('Вы уже ответили')
    s = play(s, [answer('p0', false)], rt)
    expect(s.muckVote ?? null).toBeNull()
    expect(s.lastHand?.record?.mucked).toEqual(['p0'])
    expect(s.lastHand?.record?.hidden).toEqual({ p0: ['Ah', 'Ad'] })
  })

  it('олл-ин без торговли — все открыты, паузы нет', () => {
    const t = newTable(['p0', 'p1'], MANUAL)
    const s = play(t, [start('p0', stackedDeck(HU_HOLE, BOARD)), allin('p0'), call('p1')], rt)
    expect(s.muckVote ?? null).toBeNull()
    expect(Object.keys(s.lastHand!.record!.shown).sort()).toEqual(['p0', 'p1'])
  })

  it('«Мак сам» и без поля — как после #279: паузы нет', () => {
    const auto = headsUp(MUCK, rt)
    expect(auto.muckVote ?? null).toBeNull()
    expect(auto.lastHand?.record?.mucked).toEqual(['p0'])
    const open = headsUp({ cards: 'phones' }, rt)
    expect(open.muckVote ?? null).toBeNull()
    expect(open).not.toHaveProperty('muckVote')
    expect(open.lastHand?.record?.mucked).toBeUndefined()
  })

  it('раздача «сама» — после конца паузы; ведущий во время паузы раздачу не начинает', () => {
    const s = headsUp({ ...MANUAL, autoStart: 'fast' }, rt)
    expect(s.nextHandAt ?? null).toBeNull()
    expect(handle(s, 'p0', { v: PROTOCOL_VERSION, type: 'start' }, 2000, stackedDeck(HU_HOLE, BOARD))).toEqual({ ok: false, error: MUCK_WAIT })
    // Смена раздачи «сама» во время паузы её не взводит
    const set = play(s, [{ from: 'p0', msg: { type: 'tableSettings', autoStart: 'slow' }, now: 2000 }], rt)
    expect(set.nextHandAt ?? null).toBeNull()
    const done = play(s, [answer('p0', false, 3000)], rt)
    expect(done.nextHandAt).toBe(3000 + AUTO_START_MS.fast)
    const late = onTime(s, 1000 + MUCK_VOTE_MS) as TableState
    expect(late.nextHandAt).toBe(1000 + MUCK_VOTE_MS + AUTO_START_MS.fast)
  })

  it('запас времени на выбор не тратится', () => {
    const s = headsUp({ ...MANUAL, turnSeconds: 30, timeBank: 30 }, rt)
    const t = onTime(s, 1000 + MUCK_VOTE_MS) as TableState
    expect(t.timeBank).toEqual(s.timeBank)
    expect(t.turn ?? null).toBeNull()
  })
})
