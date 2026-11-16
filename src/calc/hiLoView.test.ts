// Хай/лоу своей игры на экране (#227): рука с лоу, делёж банков в итоге и истории, выгрузка, редактор
import { describe, expect, it } from 'vitest'
import type { Card } from '../poker/cards'
import { finishedHand } from '../poker/history'
import type { OwnGame } from '../poker/ownGame'
import type { Settings, TableState } from '../poker/table'
import { allin, call, check, newTable, play, stackedDeck, start, type Step } from '../poker/testing'
import type { SavedHand } from './evenings'
import { handText } from './handText'
import { splitText, withLow } from './hiLoView'
import { ownGameLine, ownGameOf, OWN_GAME_NEW, withDeck, withHiLo } from './ownGameForm'
import { historyHandView, lastHandRecord, tableView } from './pokerView'

const O8: OwnGame = { id: 'own-o8', name: 'Омаха хай/лоу', hole: 4, fromHand: 2, deck: 52, order: 'standard', board: [3, 1, 1], limit: 'nolimit', hiLo: true }
const H8: OwnGame = { ...O8, id: 'own-h8', name: 'Холдем хай/лоу', hole: 2, fromHand: 'any' }

const own = (game: OwnGame, extra: Partial<Settings> = {}): Partial<Settings> => ({ cards: 'phones', games: [game], game: game.id, ...extra })

// Хедз-ап: кнопка p0, сдают с p1; олл-ин префлоп и колл. Возвращает стол до и после — для записи истории
function headsUp(game: OwnGame, p1: Card[], p0: Card[], board: Card[], extra: Partial<Settings> = {}, more: Step[] = []) {
  const before = play(newTable(['p0', 'p1'], own(game, extra)), [start('p0', stackedDeck([p1, p0], board))], false)
  const after = play(before, [allin('p0'), call('p1'), ...more], false)
  return { before, after }
}

const savedOf = (before: TableState, after: TableState): SavedHand => {
  const hand = finishedHand(before, after)!
  return { evening: 'e', code: null, startedAt: 0, number: hand.number, hand }
}

// Пример 1 задачи: у P1 (Ани) и старшая, и лоу; у P0 лоу нет
const EXAMPLE_1 = () => headsUp(O8, ['3h', '4c', 'Kd', 'Ks'], ['Ah', '2c', 'Qd', 'Jc'], ['As', '2d', '7c', 'Kh', 'Qs'])
// Холдем: хай — P0 (тройка королей), лоу — P1 (7-4-3-2-A)
const SPLIT = () => headsUp(H8, ['Ac', '2c'], ['Kh', 'Ks'], ['Kd', '7h', '3s', '4d', '8c'])

describe('строки хай/лоу', () => {
  it('рука с лоу; лоу нет — только старшая', () => {
    expect(withLow('Флеш, старший туз', 'Лоу 7-5-3-2-A')).toBe('Флеш, старший туз · лоу 7-5-3-2-A')
    expect(withLow('Флеш, старший туз', undefined)).toBe('Флеш, старший туз')
    expect(withLow(null, 'Лоу 7-5-3-2-A')).toBeNull()
  })

  it('делёж банка: хай и лоу у разных, лоу нет, оба у одного', () => {
    const names: Record<string, string> = { a: 'Аня', b: 'Боря' }
    const hands = { a: 'Тройка, короли', b: 'Пара, тузы' }
    const lows = { b: 'Лоу 8-6-4-3-A' }
    const nameOf = (id: string) => names[id]
    expect(splitText({ hi: ['a'], lo: ['b'] }, hands, lows, nameOf)).toBe('Хай — Аня (Тройка, короли), лоу — Боря (Лоу 8-6-4-3-A)')
    expect(splitText({ hi: ['a'], lo: [] }, hands, lows, nameOf)).toBe('Лоу нет — весь банк хаю')
    expect(splitText({ hi: ['a'], lo: ['a'] }, hands, { a: 'Лоу 7-4-3-2-A' }, nameOf)).toBe('Аня — весь банк: хай и лоу')
  })
})

describe('стол хай/лоу на экране', () => {
  it('своя рука в раздаче — старшая и лоу', () => {
    // Префлоп: P0 колл, P1 чек — флоп As 2d 7c
    const s = play(EXAMPLE_1().before, [call('p0'), check('p1')], false)
    expect(s.hand?.stage).toBe('flop')
    expect(tableView(s, 'p1', 0).myHand).toBe('Пара, короли · лоу 7-4-3-2-A')
    // У P0 лоу нет — только старшая
    expect(tableView(s, 'p0', 0).myHand).toBe('Две пары, тузы и двойки')
  })

  it('итог раздачи: у мест — старшая и лоу, у банка — делёж; шансов на ва-банке нет', () => {
    const { after } = EXAMPLE_1()
    const v = lastHandRecord(after)!
    expect(v.players.map((p) => p.hand)).toEqual(['Две пары, тузы и дамы', 'Тройка, короли · лоу 7-4-3-2-A'])
    expect(v.split).toEqual(['P1 — весь банк: хай и лоу'])
    expect(v.odds).toBeNull()
    expect(tableView(after, 'p0', 0).seats.map((x) => x.handName)).toEqual(['Две пары, тузы и дамы', 'Тройка, короли · лоу 7-4-3-2-A'])

    const split = lastHandRecord(SPLIT().after)!
    expect(split.split).toEqual(['Хай — P0 (Тройка, короли), лоу — P1 (Лоу 7-4-3-2-A)'])
    // Подсветка: у взявшего хай — его пятёрка, у взявшего только лоу — пятёрка лоу
    expect(split.players.map((p) => p.best)).toEqual([
      ['Kh', 'Ks', 'Kd', '8c', '7h'],
      ['7h', '4d', '3s', '2c', 'Ac'],
    ])
  })

  it('побочный банк — у каждого банка свой делёж', () => {
    const deck = stackedDeck([['Ac', '4c'], ['Kh', 'Ks'], ['5h', '6d']], ['Kd', 'Qc', '7h', '2s', '3d'])
    const t = newTable(['p0', 'p1', 'p2'], own(H8), { p1: 300 })
    const s = play(t, [start('p0', deck), allin('p0'), allin('p1'), call('p2')], false)
    expect(lastHandRecord(s)!.split).toEqual([
      'Основной банк: Хай — P2 (Тройка, короли), лоу — P1 (Лоу 7-4-3-2-A)',
      'Побочный банк: Хай — P2 (Тройка, короли), лоу — P0 (Лоу 7-6-5-3-2)',
    ])
  })

  it('прогон дважды — у каждого борда свой делёж', () => {
    const choose = (from: string): Step => ({ from, msg: { type: 'runChoice', times: 2 } })
    const board: Card[] = ['Kd', '7h', '3s', '4d', '8c', 'Ad', 'Jc', '9s', '5d', 'Th']
    const { after } = headsUp(H8, ['Ac', '2c'], ['Kh', 'Ks'], board, { maxRuns: 2 }, [choose('p0'), choose('p1')])
    const v = lastHandRecord(after)!
    expect(v.split).toBeUndefined()
    expect(v.runs?.map((r) => r.winners)).toEqual(['Хай — P0 (Тройка, короли), лоу — P1 (Лоу 7-4-3-2-A)', 'Лоу нет — весь банк хаю'])
  })

  it('история: у банка — делёж, в шапке — «хай/лоу»; выгрузка — Omaha Hi/Lo и Hold’em Hi/Lo', () => {
    const omaha = EXAMPLE_1()
    const h = historyHandView(savedOf(omaha.before, omaha.after))
    expect(h.head).toContain(', хай/лоу')
    expect(h.pots).toEqual([{ label: 'Банк', amount: 2000, winners: ['P1'], split: 'P1 — весь банк: хай и лоу' }])
    expect(h.odds).toBeNull()
    const text = handText(savedOf(omaha.before, omaha.after))
    expect(text.split('\n')[0]).toMatch(/: Omaha Hi\/Lo No Limit \(5\/10\)/)
    expect(text).toContain('P1: shows [3h 4c Kd Ks] (Тройка, короли · лоу 7-4-3-2-A)')

    const holdem = SPLIT()
    expect(handText(savedOf(holdem.before, holdem.after)).split('\n')[0]).toMatch(/: Hold'em Hi\/Lo No Limit/)
    expect(historyHandView(savedOf(holdem.before, holdem.after)).pots[0].split).toBe('Хай — P0 (Тройка, короли), лоу — P1 (Лоу 7-4-3-2-A)')
  })
})

describe('редактор своей игры: галочка «Хай/лоу»', () => {
  it('строка игры — «… · хай/лоу»; «нет» — без поля', () => {
    const form = { ...OWN_GAME_NEW, name: 'Омаха хай/лоу', hole: 4, fromHand: 2 as const, limit: 'pot' as const }
    expect(ownGameLine(withHiLo(form, true))).toBe('4 карты, ровно 2 из руки · стол 3-1-1 · пот-лимит · хай/лоу · до 10 игроков')
    expect(ownGameLine(form)).toBe('4 карты, ровно 2 из руки · стол 3-1-1 · пот-лимит · до 10 игроков')
    expect(ownGameOf(withHiLo(form, true), 'own-x').hiLo).toBe(true)
    expect('hiLo' in ownGameOf(withHiLo(withHiLo(form, true), false), 'own-x')).toBe(false)
    expect('hiLo' in ownGameOf({ ...form, hiLo: false }, 'own-x')).toBe(false)
  })

  it('колода 36 — галочку не поставить, а стоявшая снимается', () => {
    const on = withHiLo(OWN_GAME_NEW, true)
    expect(on.hiLo).toBe(true)
    const short = withDeck(on, 36)
    expect(short.hiLo).toBeUndefined()
    expect(withHiLo(short, true).hiLo).toBeUndefined()
  })
})
