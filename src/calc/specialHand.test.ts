import { describe, expect, it } from 'vitest'
import { HOLDEM_GAME, OMAHA_GAME, SHORT_DECK_GAME, type GameDef } from '../poker/game'
import type { HandRecord, HandResult } from '../poker/table'
import { preflopSpecial, riverSpecial } from './specialHand'

// Раздача кончилась: shown — открытые всем, hands — дошедшие до вскрытия, hidden — закрытые, winners — банк
function ended(opts: {
  game?: GameDef
  board: string[]
  shown?: Record<string, string[]>
  hands?: string[]
  hidden?: Record<string, string[]>
  winners: string[]
}): HandResult {
  const record: HandRecord = {
    game: opts.game ?? HOLDEM_GAME,
    sb: 5,
    bb: 10,
    seats: [
      { id: 'me', name: 'Я', chips: 1000 },
      { id: 'b', name: 'Боря', chips: 1000 },
    ],
    button: 0,
    board: opts.board,
    log: [],
    shown: opts.shown ?? {},
    hands: Object.fromEntries((opts.hands ?? []).map((id) => [id, 'рука'])),
    hidden: opts.hidden ?? null,
  }
  return { number: 3, pots: [{ amount: 100, winners: opts.winners }], payouts: {}, record }
}

describe('особые руки (#295): префлоп', () => {
  it('AA, KK, AKs, AKo — да', () => {
    expect(preflopSpecial(HOLDEM_GAME, ['Ah', 'Ad'])).toBe('Карманные тузы')
    expect(preflopSpecial(HOLDEM_GAME, ['Kc', 'Ks'])).toBe('Карманные короли')
    expect(preflopSpecial(HOLDEM_GAME, ['Ks', 'As'])).toBe('Туз-король одной масти')
    expect(preflopSpecial(HOLDEM_GAME, ['Ah', 'Kd'])).toBe('Туз-король')
  })

  it('QQ, AQ, закрытые карты — нет', () => {
    expect(preflopSpecial(HOLDEM_GAME, ['Qh', 'Qd'])).toBeNull()
    expect(preflopSpecial(HOLDEM_GAME, ['Ah', 'Qd'])).toBeNull()
    expect(preflopSpecial(HOLDEM_GAME, ['Ah', null])).toBeNull()
    expect(preflopSpecial(HOLDEM_GAME, null)).toBeNull()
  })

  it('только холдем: омаха, шорт-дек, своя игра — нет', () => {
    expect(preflopSpecial(OMAHA_GAME, ['Ah', 'Ad', '2c', '3c'])).toBeNull()
    expect(preflopSpecial(SHORT_DECK_GAME, ['Ah', 'Ad'])).toBeNull()
    expect(preflopSpecial({ ...HOLDEM_GAME, id: 'own-1' }, ['Ah', 'Ad'])).toBeNull()
  })
})

describe('особые руки (#295): ривер', () => {
  const BOARD = ['Th', 'Jh', 'Qh', '2c', '3d']

  it('роял-флеш на вскрытии — видят все', () => {
    const r = ended({ board: BOARD, shown: { me: ['2s', '4s'], b: ['Ah', 'Kh'] }, hands: ['me', 'b'], winners: ['b'] })
    expect(riverSpecial(r, 'me')).toEqual({ kind: 'river', playerId: 'b', label: 'Роял-флеш', own: false })
    expect(riverSpecial(r, '')).toEqual({ kind: 'river', playerId: 'b', label: 'Роял-флеш', own: false })
  })

  it('стрит-флеш на вскрытии; у двоих — сильнейший', () => {
    const r = ended({ board: BOARD, shown: { me: ['9h', '8h'], b: ['Kh', '9d'] }, hands: ['me', 'b'], winners: ['me'] })
    expect(riverSpecial(r, 'b')).toEqual({ kind: 'river', playerId: 'me', label: 'Стрит-флеш до дамы', own: false })
    const two = ended({ board: ['9h', 'Th', 'Jh', '2c', '3d'], shown: { me: ['7h', '8h'], b: ['Qh', 'Kh'] }, hands: ['me', 'b'], winners: ['b'] })
    expect(riverSpecial(two, 'me')?.label).toBe('Стрит-флеш до короля')
  })

  it('взял без вскрытия — только у себя', () => {
    const r = ended({ board: BOARD, hidden: { me: ['Ah', 'Kh'] }, winners: ['me'] })
    expect(riverSpecial(r, 'me')).toEqual({ kind: 'river', playerId: 'me', label: 'Роял-флеш', own: true })
    expect(riverSpecial(r, 'b')).toBeNull()
  })

  it('чужие закрытые карты не используются', () => {
    const r = ended({ board: BOARD, hidden: { b: ['Ah', 'Kh'] }, winners: ['b'] })
    expect(riverSpecial(r, 'me')).toBeNull()
    // Сбросил стрит-флеш — праздника нет
    const folded = ended({ board: BOARD, hidden: { me: ['Ah', 'Kh'] }, winners: ['b'] })
    expect(riverSpecial(folded, 'me')).toBeNull()
  })

  it('флеш и стрит — нет; до ривера — нет', () => {
    const flush = ended({ board: BOARD, shown: { b: ['2h', '5h'] }, hands: ['b'], winners: ['b'] })
    expect(riverSpecial(flush, 'me')).toBeNull()
    const turn = ended({ board: ['Th', 'Jh', 'Qh', '2c'], hidden: { me: ['Ah', 'Kh'] }, winners: ['me'] })
    expect(riverSpecial(turn, 'me')).toBeNull()
  })

  it('омаха — да (ровно две из руки), шорт-дек — нет', () => {
    const omaha = ended({ game: OMAHA_GAME, board: BOARD, shown: { b: ['Ah', 'Kh', '2s', '4s'] }, hands: ['b'], winners: ['b'] })
    expect(riverSpecial(omaha, 'me')?.label).toBe('Роял-флеш')
    // В омахе одной своей карты мало: Ah и три червы стола — не стрит-флеш
    const one = ended({ game: OMAHA_GAME, board: ['Th', 'Jh', 'Qh', 'Kh', '3d'], shown: { b: ['Ah', '2s', '4s', '5c'] }, hands: ['b'], winners: ['b'] })
    expect(riverSpecial(one, 'me')).toBeNull()
    const short = ended({ game: SHORT_DECK_GAME, board: BOARD, shown: { b: ['Ah', 'Kh'] }, hands: ['b'], winners: ['b'] })
    expect(riverSpecial(short, 'me')).toBeNull()
  })

  it('без записи или с испорченной — нет', () => {
    expect(riverSpecial({ number: 1, pots: [], payouts: {} }, 'me')).toBeNull()
    expect(riverSpecial(null, 'me')).toBeNull()
    const bad = ended({ board: BOARD, shown: { b: ['Zz', 'Kh'] }, hands: ['b'], winners: ['b'] })
    expect(riverSpecial(bad, 'me')).toBeNull()
  })
})
