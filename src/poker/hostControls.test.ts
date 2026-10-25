import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from './protocol'
import { handle, HOST_TAKEOVER_MS, type TableState } from './table'
import { allin, award, call, check, fold, MODES, newTable, play, raise, start, type Step } from './testing'

const skip = (host: string): Step => ({ from: host, msg: { type: 'skip' } })
const tryRemove = (s: TableState, playerId: string) => handle(s, s.hostId, { type: 'remove', playerId, v: PROTOCOL_VERSION }, 0)

// Итог вечера по журналу фишек: закуплено (закупы, докупы, правки) — на столе и унесено уходом
function evening(s: TableState) {
  let bought = 0
  let left = 0
  for (const e of s.chipLog) {
    if (e.kind === 'buyin') bought += e.amount
    if (e.kind === 'rebuy' || e.kind === 'set') bought += e.to - e.from
    if (e.kind === 'leave') left += e.chips
  }
  return { bought, onTable: s.players.reduce((sum, p) => sum + p.chips, 0), left }
}
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

  it('игрок ещё в раздаче — убрать нельзя, стол не меняется', () => {
    const s = play(newTable(['p0', 'p1', 'p2']), [start('p0'), raise('p0', 30)], roundtrip)
    expect(tryRemove(s, 'p2')).toEqual({ ok: false, error: 'Игрок в раздаче — уберите после неё' })
  })

  it('игрок пошёл ва-банк, торги идут — убрать нельзя', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], {}, { p0: 100 }), [start('p0'), allin('p0')], roundtrip)
    expect(s.hand?.stage).toBe('preflop')
    expect(s.hand?.seats.find((x) => x.id === 'p0')?.allIn).toBe(true)
    // p0 — ведущий: передаём ведение, чтобы убирал p1
    const passed = play(s, [{ from: 'p0', msg: { type: 'passHost', to: 'p1' } }], roundtrip)
    expect(handle(passed, 'p1', { type: 'remove', playerId: 'p0', v: PROTOCOL_VERSION }, 0)).toEqual({
      ok: false,
      error: 'Игрок в раздаче — уберите после неё',
    })
  })

  it('ведущий убирает сбросившего посреди раздачи — уход с остатком в журнале, итог сходится', () => {
    // p0 — кнопка, p1 — малый, p2 — большой; p0 ставит 30, p1 уравнивает и после флопа сбрасывает
    const s = play(
      newTable(['p0', 'p1', 'p2']),
      [
        start('p0'),
        raise('p0', 30),
        call('p1'),
        fold('p2'),
        { from: 'p1', msg: { type: 'rebuy', amount: 200 } },
        { from: 'p0', msg: { type: 'rebuyAnswer', playerId: 'p1', approve: true } },
        check('p1'),
        raise('p0', 50),
        fold('p1'),
        { from: 'p0', msg: { type: 'remove', playerId: 'p1' }, now: 9 },
      ],
      roundtrip,
    )
    expect(s.players.map((p) => p.id)).toEqual(['p0', 'p2'])
    expect(s.chipLog.slice(-2)).toEqual([
      { kind: 'rebuy', playerId: 'p1', by: 'p0', from: 970, to: 1170, at: 9 },
      { kind: 'leave', playerId: 'p1', by: 'p0', chips: 1170, at: 9, name: 'P1', regularId: null },
    ])
    expect(s.approvedRebuys).toEqual([])
    const done = play(s, [award('p0', [['p0']])], roundtrip)
    expect(evening(done)).toEqual({ bought: 3200, onTable: 2030, left: 1170 })
  })

  it('ведущий убирает игрока между раздачами — уход со стеком', () => {
    const s = play(
      newTable(['p0', 'p1', 'p2'], {}, { p2: 640 }),
      [{ from: 'p0', msg: { type: 'remove', playerId: 'p2' }, now: 3 }],
      roundtrip,
    )
    expect(s.players.map((p) => p.id)).toEqual(['p0', 'p1'])
    expect(s.chipLog.at(-1)).toEqual({ kind: 'leave', playerId: 'p2', by: 'p0', chips: 640, at: 3, name: 'P2', regularId: null })
  })

  it('уход постоянного — в журнале его имя и id постоянного', () => {
    const s = play(
      newTable(['p0']),
      [
        { from: 'p1', msg: { type: 'sit', name: 'Дима', regularId: 'r-dima' } },
        { from: 'p0', msg: { type: 'remove', playerId: 'p1' }, now: 5 },
      ],
      roundtrip,
    )
    expect(s.chipLog.at(-1)).toEqual({
      kind: 'leave',
      playerId: 'p1',
      by: 'p0',
      chips: 1000,
      at: 5,
      name: 'Дима',
      regularId: 'r-dima',
    })
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
