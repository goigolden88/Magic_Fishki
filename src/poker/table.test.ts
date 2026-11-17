// Мак на вскрытии (#279): порядок вскрытия, кто открывает и кто сбрасывает без показа, что видит каждый телефон
import { describe, expect, it } from 'vitest'
import { lastHandRecord } from '../calc/pokerView'
import type { Card } from './cards'
import { handFor } from './history'
import type { OwnGame } from './ownGame'
import { PROTOCOL_VERSION } from './protocol'
import { createTable, handle, viewFor, type Settings, type TableState } from './table'
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

  it('настройка: только «Мак сам» и только с картами на телефонах; ведущий меняет между раздачами', () => {
    expect(createTable('p0', 'P0', { cards: 'phones', muck: 'manual' as 'auto' }, 0)).toEqual({ ok: false, error: 'Вскрытие — все открывают или мак сам' })
    expect(createTable('p0', 'P0', { cards: 'live', muck: 'auto' }, 0)).toEqual({ ok: false, error: 'Мак на вскрытии — только с картами на телефонах' })
    let s = newTable(['p0', 'p1', 'p2'], { cards: 'phones' })
    s = play(s, [{ from: 'p0', msg: { type: 'tableSettings', muck: 'auto' } }], rt)
    expect(s.settings.muck).toBe('auto')
    expect(tryStep(s, 'p0', { type: 'tableSettings', muck: 'manual' })).toBe('Вскрытие — все открывают или мак сам')
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
