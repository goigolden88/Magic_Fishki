import { describe, expect, it } from 'vitest'
import type { Card } from '../poker/cards'
import { MUCK_VOTE_MS, viewFor, type TableState } from '../poker/table'
import { call, check, newTable, play, stackedDeck, start, type Step } from '../poker/testing'
import { MUCK_DECIDING_NOTE, muckView } from './pokerMuck'
import { lastHandRecord, tableView } from './pokerView'

// Хедз-ап, кнопка p0: у p1 тузы — открывает первым, у p0 король старший — решает
const DECK = stackedDeck(
  [
    ['Ah', 'Ad'],
    ['Kh', 'Qh'],
  ],
  ['2s', '7h', '9d', 'Jc', '3c'] as Card[],
)
const checks: Step[] = [call('p0'), check('p1'), ...Array.from({ length: 6 }, (_, k) => check(['p1', 'p0'][k % 2]))]

function paused(): TableState {
  return play(newTable(['p0', 'p1'], { cards: 'phones', muck: 'manual' }), [start('p0', DECK), ...checks], false)
}

describe('«Мак по выбору» на экране (#286)', () => {
  it('решающему — «Показать карты?» со своими картами и отсчётом; сопернику — кто решает', () => {
    const s = paused()
    expect(muckView(viewFor(s, 'p0'), 'p0', 2000)).toEqual({
      line: 'Показать карты?',
      left: MUCK_VOTE_MS / 1000 - 2,
      canChoose: true,
      cards: ['Kh', 'Qh'],
      waiting: ['P0'],
    })
    expect(muckView(viewFor(s, 'p1'), 'p1', 0)).toMatchObject({ line: 'P0 решает: показать или сбросить…', canChoose: false, cards: null })
  })

  it('пока решает — без «Показать» после раздачи, ведущий не начинает; в прошлой раздаче — «решает»', () => {
    const s = paused()
    const mine = tableView(viewFor(s, 'p0'), 'p0', 0)
    expect(mine.canShow).toBeNull()
    expect(mine.canStart).toBe(false)
    const other = lastHandRecord(viewFor(s, 'p1'))!.players.find((p) => p.name === 'P0')!
    expect(other).toMatchObject({ cards: null, note: MUCK_DECIDING_NOTE })
  })

  it('ответил «Сбросить» — паузы нет, как у «Мак сам»: «сбросил без показа», «Показать» снова есть', () => {
    const s = play(paused(), [{ from: 'p0', msg: { type: 'muck', show: false } }], false)
    expect(muckView(viewFor(s, 'p1'), 'p1', 0)).toBeNull()
    expect(lastHandRecord(viewFor(s, 'p1'))!.players.find((p) => p.name === 'P0')?.note).toBe('сбросил без показа')
    expect(tableView(viewFor(s, 'p0'), 'p0', 0).canShow?.cards).toEqual(['Kh', 'Qh'])
    expect(tableView(viewFor(s, 'p0'), 'p0', 0).canStart).toBe(true)
  })
})
