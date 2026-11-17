import { describe, expect, it } from 'vitest'
import { formatNumber } from './format'
import { emptyRange, fullRange, parseRange } from './rangeText'
import {
  ALL_COMBOS,
  pickCard,
  rangeSize,
  rangeSizeText,
  runsText,
  shareText,
  streetBoards,
  takenCards,
  TRAINER_DECK,
  trainerInput,
  weightLabel,
  winTieText,
  type TrainerSide,
} from './trainerView'

const weights = (text: string) => {
  const parsed = parseRange(text)
  if (!('weights' in parsed)) throw new Error(parsed.error)
  return parsed.weights
}
const hand = (...cards: string[]): TrainerSide => ({ mode: 'hand', cards, range: emptyRange() })
const range = (text: string): TrainerSide => ({ mode: 'range', cards: [], range: weights(text) })

describe('тренажёр: вид экрана', () => {
  it('колода выбора — 52 разные карты, ряд на масть, от туза', () => {
    expect(TRAINER_DECK).toHaveLength(4)
    expect(TRAINER_DECK[0][0]).toBe('As')
    expect(TRAINER_DECK[0][12]).toBe('2s')
    expect(new Set(TRAINER_DECK.flat()).size).toBe(52)
  })

  it('размер диапазона: пары — 6 сочетаний, одномастные — 4, разномастные — 12, веса — долей', () => {
    expect(rangeSize(fullRange()).combos).toBe(ALL_COMBOS)
    expect(rangeSize(fullRange()).percent).toBe(100)
    expect(rangeSize(emptyRange()).combos).toBe(0)
    expect(rangeSize(weights('AA, AKs, AKo')).combos).toBe(22)
    expect(rangeSize(weights('AA:0.25')).combos).toBe(1.5)
    expect(rangeSizeText(weights('77+, A9s+, AJo+'))).toBe('7,8 % рук · 104 сочетания')
    expect(rangeSizeText(fullRange())).toBe(`100 % рук · ${formatNumber(1326)} сочетаний`)
    expect(rangeSizeText(weights('AKs:0.25'))).toBe('0,1 % рук · 1 сочетание')
    expect(rangeSizeText(weights('AA:0.25'))).toBe('0,1 % рук · 1,5 сочетания')
    expect(rangeSizeText(emptyRange())).toBe('0 % рук · 0 сочетаний')
  })

  it('подписи весов, долей, победы и ничьей', () => {
    expect(weightLabel(1)).toBe('100 %')
    expect(weightLabel(0.25)).toBe('25 %')
    expect(weightLabel(0)).toBe('0 %')
    expect(shareText(0.6234)).toBe('62,3 %')
    expect(shareText(1)).toBe('100,0 %')
    expect(winTieText(0.601, 0.044)).toBe('победа 60,1 % · ничья 4,4 %')
  })

  it('занятые карты — руки других сторон и борд; диапазон карт не занимает', () => {
    const sides = [hand('As', 'Kd'), range('QQ+'), hand('2c', '3c')]
    const board = ['Th', 'Jh', '9s']
    expect([...takenCards(sides, board, 0)].sort()).toEqual(['2c', '3c', '9s', 'Jh', 'Th'])
    expect([...takenCards(sides, board, 'board')].sort()).toEqual(['2c', '3c', 'As', 'Kd'])
  })

  it('касание карты: снимает выбранную, добавляет, в полном ряду меняет последнюю', () => {
    expect(pickCard(['As'], 'As', 2)).toEqual([])
    expect(pickCard(['As'], 'Kd', 2)).toEqual(['As', 'Kd'])
    expect(pickCard(['As', 'Kd'], 'Qh', 2)).toEqual(['As', 'Qh'])
  })

  it('вход счёта: неполное — причина словами, полное — стороны', () => {
    expect(trainerInput([hand('As'), range('QQ+')], [])).toEqual({ reason: 'Сторона 1: выберите ещё 1 карту' })
    expect(trainerInput([hand(), range('QQ+')], [])).toEqual({ reason: 'Сторона 1: выберите ещё 2 карты' })
    expect(trainerInput([hand('As', 'Kd'), range('')], [])).toEqual({ reason: 'Сторона 2: пустой диапазон' })
    expect(trainerInput([hand('As', 'Kd'), range('QQ+')], ['2c'])).toEqual({ reason: 'Флоп — три карты: на борд ещё 2 карты' })
    const ok = trainerInput([hand('As', 'Kd'), range('QQ+')], ['2c', '3c', '4c'])
    expect(ok).toEqual({ sides: [{ cards: ['As', 'Kd'] }, { range: weights('QQ+') }] })
  })

  it('строка над итогом: выборка — «≈», перебор — «точно», на ривере — без досдачи', () => {
    const result = (exact: boolean, runs: number) => ({ ok: true as const, exact, runs, sides: [] })
    expect(runsText(result(false, 20_000), 3)).toBe(`≈, ${formatNumber(20_000)} досдач`)
    expect(runsText(result(true, 990), 3)).toBe('точно, 990 досдач')
    expect(runsText(result(true, 44), 4)).toBe('точно, 44 досдачи')
    expect(runsText(result(true, 1), 5)).toBe('точно, без досдачи')
  })

  it('улицы раздачи из истории (#273): до каких дошёл борд, борд к каждой', () => {
    const full = ['2s', '7h', '9d', 'Jc', '3s']
    expect(streetBoards([])).toEqual([{ street: 'preflop', label: 'Префлоп', board: [] }])
    expect(streetBoards(full.slice(0, 3))).toEqual([
      { street: 'preflop', label: 'Префлоп', board: [] },
      { street: 'flop', label: 'Флоп', board: ['2s', '7h', '9d'] },
    ])
    expect(streetBoards(full.slice(0, 4)).map((s) => [s.label, s.board.length])).toEqual([
      ['Префлоп', 0],
      ['Флоп', 3],
      ['Тёрн', 4],
    ])
    expect(streetBoards(full)).toEqual([
      { street: 'preflop', label: 'Префлоп', board: [] },
      { street: 'flop', label: 'Флоп', board: ['2s', '7h', '9d'] },
      { street: 'turn', label: 'Тёрн', board: ['2s', '7h', '9d', 'Jc'] },
      { street: 'river', label: 'Ривер', board: full },
    ])
  })
})
