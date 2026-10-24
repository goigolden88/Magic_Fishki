import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from './protocol'
import { handle, HOST_TAKEOVER_MS, type TableState } from './table'
import { call, check, MODES, newTable, play, raise, start, type Step } from './testing'

const skip = (host: string): Step => ({ from: host, msg: { type: 'skip' } })
const takeHost = (from: string, now: number): Step => ({ from, msg: { type: 'takeHost' }, now })
const tryTake = (s: TableState, from: string, now: number) => handle(s, from, { type: 'takeHost', v: PROTOCOL_VERSION }, now)

// Сценарий hostcontrols прототипа: пропуск раздач, ход за отошедшего; ведение стола
describe.each(MODES)('управление столом — %s', (_, roundtrip) => {
  it('игрок пропускает раздачи — в раздачу не садится', () => {
    const s = play(
      newTable(['p0', 'p1', 'p2']),
      [{ from: 'p2', msg: { type: 'sitOut', sittingOut: true } }, start('p0')],
      roundtrip,
    )
    expect(s.hand?.seats.map((x) => x.id)).toEqual(['p0', 'p1'])
  })

  it('ведущий пропускает ход: есть что уравнивать — сброс, банк сопернику', () => {
    const s = play(newTable(['p0', 'p1']), [start('p0'), skip('p0')], roundtrip)
    expect(s.hand?.seats.find((x) => x.id === 'p0')?.folded).toBe(true)
    expect(s.hand?.stage).toBe('showdown')
    expect(s.hand?.pots).toEqual([{ amount: 10, eligible: ['p1'] }])
  })

  it('ведущий пропускает ход: ставки нет — чек, раздача идёт', () => {
    const s = play(newTable(['p0', 'p1']), [start('p0'), call('p0'), check('p1'), skip('p0')], roundtrip)
    expect(s.hand?.stage).toBe('flop')
    expect(s.hand?.seats.find((x) => x.id === 'p1')?.folded).toBe(false)
    expect(s.hand?.seats[s.hand.toAct].id).toBe('p0')
  })

  it('ведущий убирает игрока посреди раздачи — карты сброшены, стол не встал', () => {
    const s = play(
      newTable(['p0', 'p1', 'p2']),
      [start('p0'), raise('p0', 30), { from: 'p0', msg: { type: 'remove', playerId: 'p2' } }],
      roundtrip,
    )
    expect(s.players.map((p) => p.id)).toEqual(['p0', 'p1'])
    expect(s.hand?.seats.find((x) => x.id === 'p2')?.folded).toBe(true)
    expect(s.hand?.seats[s.hand.toAct].id).toBe('p1')
  })

  it('ведущий передаёт ведение', () => {
    const s = play(newTable(['p0', 'p1']), [{ from: 'p0', msg: { type: 'passHost', to: 'p1' } }], roundtrip)
    expect(s.hostId).toBe('p1')
  })

  it('ведущий вне сети больше минуты — «Взять ведение» срабатывает', () => {
    const s = play(
      newTable(['p0', 'p1', 'p2']),
      [{ from: 'p0', online: false, now: 1000 }, takeHost('p2', 1000 + HOST_TAKEOVER_MS + 1)],
      roundtrip,
    )
    expect(s.hostId).toBe('p2')
  })

  it('ведущий в сети или вне сети меньше минуты — «Взять ведение» не срабатывает', () => {
    const online = newTable(['p0', 'p1'])
    expect(tryTake(online, 'p1', 10 * HOST_TAKEOVER_MS)).toEqual({ ok: false, error: 'Ведущий в сети — ведение не взять' })

    const away = play(online, [{ from: 'p0', online: false, now: 1000 }], roundtrip)
    expect(tryTake(away, 'p1', 1000 + HOST_TAKEOVER_MS)).toEqual({
      ok: false,
      error: 'Ведущий вне сети меньше минуты — подождите',
    })

    const back = play(away, [{ from: 'p0', online: true, now: 1000 + 2 * HOST_TAKEOVER_MS }], roundtrip)
    expect(tryTake(back, 'p1', 1000 + 3 * HOST_TAKEOVER_MS).ok).toBe(false)
    expect(back.hostId).toBe('p0')
  })
})
