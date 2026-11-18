import { describe, expect, it } from 'vitest'
import { tableView } from '../calc/pokerView'
import type { Card } from './cards'
import { boardRunout, dealRound, HOLDEM_GAME, newCards } from './game'
import { finishedHand, keepHand } from './history'
import { viewFor, type Settings, type TableState } from './table'
import { award, call, check, fold, MODES, newTable, play, raise, stackedDeck, start, type Step } from './testing'

// «Докрутить борд» (#297, Р-112): раздача кончилась пасом до ривера — карты стола, что вышли бы, в итоге раздачи
const PHONES: Partial<Settings> = { cards: 'phones' }

// Хедз-ап: кнопка p0 (малый, ходит первой до флопа), после флопа первым — p1. Стол ляжет BOARD по улицам
const BOARD: Card[] = ['2c', '3d', '7h', '9s', 'Jd']
const DECK = stackedDeck([['As', 'Ah'], ['Ks', 'Kh']], BOARD)

const table = () => newTable(['p0', 'p1'], PHONES)
const preflopFold: Step[] = [start('p0', DECK), fold('p0')]
const flopFold: Step[] = [start('p0', DECK), call('p0'), check('p1'), raise('p1', 100), fold('p0')]
const turnFold: Step[] = [start('p0', DECK), call('p0'), check('p1'), check('p1'), check('p0'), raise('p1', 100), fold('p0')]
const riverFold: Step[] = [...turnFold.slice(0, -2), check('p1'), check('p0'), raise('p1', 100), fold('p0')]

describe('boardRunout — какие карты стола вышли бы', () => {
  const dealt = (rounds: number) => {
    const cards = newCards(HOLDEM_GAME, DECK, ['p1', 'p0'])
    for (let k = 0; k < rounds; k++) dealRound(cards, ['p1', 'p0'])
    return cards
  }

  it('флоп не вышел — пять, тёрн не вышел — две, ривер не вышел — одна, стол полный — ничего', () => {
    expect(boardRunout(dealt(1), ['p1'])).toEqual(BOARD)
    expect(boardRunout(dealt(2), ['p1'])).toEqual(BOARD.slice(3))
    expect(boardRunout(dealt(3), ['p1'])).toEqual(BOARD.slice(4))
    expect(boardRunout(dealt(4), ['p1'])).toEqual([])
  })

  it('сама раздача не меняется: колода и стол те же', () => {
    const cards = dealt(2)
    const before = structuredClone(cards)
    boardRunout(cards, ['p1'])
    expect(cards).toEqual(before)
  })
})

describe.each(MODES)('«Докрутить борд» за столом (%s)', (_, rt) => {
  it('пас до флопа — в итоге раздачи все пять карт стола', () => {
    const s = play(table(), preflopFold, rt)
    expect(s.hand).toBeNull()
    expect(s.lastHand?.record?.board).toEqual([])
    expect(s.lastHand?.runout).toEqual(BOARD)
  })

  it('пас на флопе — тёрн и ривер; на тёрне — ривер; на ривере — ничего', () => {
    expect(play(table(), flopFold, rt).lastHand?.runout).toEqual(BOARD.slice(3))
    expect(play(table(), turnFold, rt).lastHand?.runout).toEqual(BOARD.slice(4))
    const river = play(table(), riverFold, rt)
    expect(river.lastHand?.record?.board).toEqual(BOARD)
    expect(river.lastHand?.runout).toBeUndefined()
  })

  it('дошло до вскрытия — докрутки нет', () => {
    const steps: Step[] = [start('p0', DECK), call('p0'), check('p1')]
    for (let k = 0; k < 3; k++) steps.push(check('p1'), check('p0'))
    const s = play(table(), steps, rt)
    expect(Object.keys(s.lastHand?.record?.hands ?? {})).toHaveLength(2)
    expect(s.lastHand?.runout).toBeUndefined()
  })

  it('живые карты — докрутки нет', () => {
    const s = play(newTable(['p0', 'p1']), [start('p0'), fold('p0'), award('p0', [['p1']])], rt)
    expect(s.lastHand).not.toBeNull()
    expect(s.lastHand?.runout).toBeUndefined()
  })

  it('запись раздачи и история докрутки не содержат', () => {
    const before = table()
    const after = play(before, preflopFold, rt)
    const record = JSON.stringify(after.lastHand?.record)
    for (const c of BOARD) expect(record).not.toContain(`"${c}"`)
    const hand = finishedHand(play(before, [start('p0', DECK)], rt), after)
    expect(hand).not.toBeNull()
    expect(hand && 'runout' in hand).toBe(false)
    expect(JSON.stringify(keepHand([], hand))).not.toContain('runout')
  })

  it('новая раздача: докрутки прошлой нет, в ходе раздачи вид телефона карт колоды не содержит', () => {
    const done = play(table(), preflopFold, rt)
    const next = play(done, [start('p0', stackedDeck([['Qs', 'Qh'], ['Js', 'Jh']], ['4c', '5d', '6h', '8s', 'Td']))], rt)
    expect(next.hand).not.toBeNull()
    expect(next.lastHand?.runout).toBeUndefined()
    // Снятие докрутки — не правка записи: в историю ничего не уходит
    expect(finishedHand(done, next)).toBeNull()
    for (const id of ['p0', 'p1']) {
      const view = viewFor(next, id)
      expect(view.hand?.cards?.deck).toEqual([])
      const own = new Set<unknown>(next.hand?.cards?.hole[id] ?? [])
      // Прошлая раздача — своей колодой: в её записи лишь то, что было и до #297; докрутки нет
      expect(view.lastHand?.runout).toBeUndefined()
      const text = JSON.stringify(view.hand)
      for (const c of next.hand?.cards?.deck ?? []) if (!own.has(c)) expect(text).not.toContain(`"${c}"`)
    }
  })

  it('после конца раздачи — докрутка у всех телефонов в итоге раздачи', () => {
    const s: TableState = play(table(), preflopFold, rt)
    for (const id of ['p0', 'p1', null]) expect(viewFor(s, id).lastHand?.runout).toEqual(BOARD)
  })

  it('экран: «Докрутить» — только между раздачами после паса до ривера', () => {
    const done = play(table(), flopFold, rt)
    expect(tableView(viewFor(done, 'p0'), 'p0', 0).runout).toEqual(BOARD.slice(3))
    expect(tableView(viewFor(done, 'p0'), 'p0', 0).board).toEqual(BOARD.slice(0, 3))
    const next = play(done, [start('p0', DECK)], rt)
    expect(tableView(viewFor(next, 'p0'), 'p0', 0).runout).toBeNull()
    expect(tableView(play(table(), riverFold, rt), 'p0', 0).runout).toBeNull()
  })
})
