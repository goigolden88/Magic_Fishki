import { describe, expect, it } from 'vitest'
import { deckFor, HOLDEM_GAME } from '../poker/game'
import { MIX_VOTE_MS } from '../poker/mix'
import type { ClientBody } from '../poker/protocol'
import { fold, newTable, play, start, type Step } from '../poker/testing'
import { mixView } from './pokerMix'

const msg = (from: string, body: ClientBody, now = 0): Step => ({ from, msg: body, now })

// Четверо, «Микс»; первая раздача: кнопка p0 (ведущий), все сбросили до большого p2
const afterHand = (mix = true) =>
  play(
    newTable(['p0', 'p1', 'p2', 'p3'], { cards: 'phones', mix }),
    [start('p0', deckFor(HOLDEM_GAME)), fold('p3'), fold('p0'), fold('p1')],
    false,
  )

describe('mixView', () => {
  it('батону — выбор другой игры, остальным — кто может сменить', () => {
    const s = afterHand()
    expect(mixView(s, 'p0', 0)).toEqual({
      kind: 'propose',
      choices: [
        ['omaha', 'Омаха'],
        ['shortdeck', 'Шорт-дек'],
      ],
    })
    expect(mixView(s, 'p1', 0)).toEqual({ kind: 'idle', line: 'Игру может сменить батон — P0' })
  })

  it('голосование: «Батон предлагает омаху», отсчёт, счёт; ведущему — «Без смены»', () => {
    const s = play(afterHand(), [msg('p0', { type: 'mixPropose', game: 'omaha' }, 1000), msg('p1', { type: 'mixVote', yes: false }, 2000)], false)
    expect(mixView(s, 'p2', 4000)).toEqual({
      kind: 'vote',
      line: 'P0 (батон) предлагает омаху',
      left: 12,
      canVote: true,
      answer: null,
      canCancel: false,
      tally: 'За 1 · Против 1 · не ответили 2',
    })
    expect(mixView(s, 'p1', 4000)).toMatchObject({ answer: false, canVote: true })
    expect(mixView(s, 'p0', 1000 + MIX_VOTE_MS + 500)).toMatchObject({ line: 'Вы предложили омаху', left: 0, canVote: false, canCancel: true })
  })

  it('итог: смена или «Остаёмся»; в раздаче и без «Микса» — ничего', () => {
    const base = play(afterHand(), [msg('p0', { type: 'mixPropose', game: 'omaha' })], false)
    const yes = play(base, ['p1', 'p2', 'p3'].map((id) => msg(id, { type: 'mixVote', yes: true })), false)
    expect(mixView(yes, 'p1', 0)).toEqual({ kind: 'result', line: 'Следующая раздача — омаха' })
    const no = play(base, ['p1', 'p2', 'p3'].map((id) => msg(id, { type: 'mixVote', yes: false })), false)
    expect(mixView(no, 'p0', 0)).toEqual({ kind: 'result', line: 'Остаёмся в холдем — против 3 из 4' })
    const cancelled = play(base, [msg('p0', { type: 'mixCancel' })], false)
    expect(mixView(cancelled, 'p2', 0)).toEqual({ kind: 'result', line: 'Остаёмся в холдем — ведущий оставил игру' })
    expect(mixView(play(yes, [start('p0', deckFor(HOLDEM_GAME))], false), 'p0', 0)).toBeNull()
    expect(mixView(afterHand(false), 'p0', 0)).toBeNull()
  })
})
