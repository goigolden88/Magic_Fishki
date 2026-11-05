import { describe, expect, it } from 'vitest'
import { buildDeck, HOLDEM, OMAHA } from '../poker/cards'
import { dealFromDeck } from './casinoDeal'
import { allShown, cardsShown, revealResume, secondsLeft, turning } from './casinoReveal'
import { parseSavedCasinoRound, restoredReveal, savedCasinoRound } from './savedCasino'

const PLAYERS = ['a', 'b', 'c']
const deal = dealFromDeck('holdem', ['a', 'b', 'c'], 3, buildDeck(HOLDEM))
const saved = savedCasinoRound('g1', deal, 10_000, 1)
const text = JSON.stringify(saved)

describe('parseSavedCasinoRound', () => {
  it('читает сохранённый раунд своей игры как был', () => {
    expect(parseSavedCasinoRound(text, 'g1', PLAYERS)).toEqual(saved)
  })

  it('омаха — по 4 карты', () => {
    const o = savedCasinoRound('g1', dealFromDeck('omaha', ['a', 'b'], 2, buildDeck(OMAHA)), 500, 0)
    expect(parseSavedCasinoRound(JSON.stringify(o), 'g1', PLAYERS)).toEqual(o)
  })

  it('чужая игра — null', () => {
    expect(parseSavedCasinoRound(text, 'g2', PLAYERS)).toBeNull()
  })

  it('участника нет в игре — null', () => {
    expect(parseSavedCasinoRound(text, 'g1', ['a', 'b'])).toBeNull()
  })

  it('битое и пустое — null', () => {
    for (const t of ['', '{', 'null', '[]', '42', '{"v":1}', text.slice(0, -5)]) {
      expect(parseSavedCasinoRound(t, 'g1', PLAYERS)).toBeNull()
    }
  })

  it('не та версия, ставка или число открытых — null', () => {
    const bad = [
      { ...saved, v: 2 },
      { ...saved, stake: 0 },
      { ...saved, stake: 1.5 },
      { ...saved, stake: '100' },
      { ...saved, opened: -1 },
      { ...saved, opened: 4 },
      { ...saved, opened: 0.5 },
    ]
    for (const b of bad) expect(parseSavedCasinoRound(JSON.stringify(b), 'g1', PLAYERS)).toBeNull()
  })

  it('карты не сходятся с раздачей — null', () => {
    const d = saved.deal
    const bad = [
      { ...d, kind: 'stud' },
      { ...d, ids: ['a'], hands: { a: d.hands.a } },
      { ...d, ids: ['a', 'a', 'b'] },
      { ...d, hands: { ...d.hands, a: [d.hands.a[0]] } },
      { ...d, hands: { ...d.hands, a: [d.hands.a[0], 'Zz'] } },
      { ...d, hands: { ...d.hands, a: [d.hands.b[0], d.hands.a[1]] } }, // карта дважды
      { ...d, boards: [] },
      { ...d, boards: [d.boards[0].slice(1)] },
      { ...d, hands: { a: d.hands.a, b: d.hands.b } },
    ]
    for (const b of bad) expect(parseSavedCasinoRound(JSON.stringify({ ...saved, deal: b }), 'g1', PLAYERS)).toBeNull()
  })
})

describe('restoredReveal', () => {
  it('открытые столы — целиком, без переворота; столы сами — на паузе', () => {
    const r = restoredReveal(3, 1, 5000, 1500, 100_000)
    expect(turning(r, 100_000)).toBe(false)
    expect(cardsShown(r, 100_000)).toBe(5)
    expect(r).toMatchObject({ opened: 1, paused: true, due: null, held: null })
    expect(secondsLeft(revealResume(r, 100_000), 100_000)).toBe(5)
  })

  it('кнопкой — без паузы; все открыты — итог сразу', () => {
    expect(restoredReveal(3, 1, null, 1500, 0).paused).toBe(false)
    const all = restoredReveal(2, 2, 5000, 1500, 0)
    expect(all.paused).toBe(false)
    expect(allShown(all, 0)).toBe(true)
  })

  it('ничего не открыто — первый стол лицом вниз', () => {
    const r = restoredReveal(2, 0, 3000, 0, 0)
    expect(cardsShown(r, 0)).toBe(0)
    expect(r.paused).toBe(true)
  })
})
