import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { handle, type TableState } from './table'
import { award, call, check, MODES, newTable, play, start, type Step } from './testing'

const player = (s: TableState, id: string) => s.players.find((p) => p.id === id)!
const send = (from: string, msg: ClientBody, now = 0): Step => ({ from, msg, now })
const tryMsg = (s: TableState, from: string, msg: ClientBody) => handle(s, from, { ...msg, v: PROTOCOL_VERSION }, 0)

// Сценарий rebuy прототипа: пределы, «да» и «нет» ведущего, журнал фишек, правка стека.
// Турнирных ребаев нет — этап 1 только кэш
describe.each(MODES)('докупы и правка стека — %s', (_, roundtrip) => {
  it('пределы докупа за раз: выключены, до 100 больших блайндов, без предела', () => {
    const off = newTable(['p0', 'p1'], { rebuyMaxBB: 0 })
    expect(tryMsg(off, 'p1', { type: 'rebuy', amount: 100 })).toEqual({ ok: false, error: 'Докупы за этим столом выключены' })

    const limited = newTable(['p0', 'p1'], { rebuyMaxBB: 100 })
    expect(tryMsg(limited, 'p1', { type: 'rebuy', amount: 1001 })).toEqual({ ok: false, error: 'Докуп — не больше 1000' })
    const asked = play(limited, [send('p1', { type: 'rebuy', amount: 1000 })], roundtrip)
    expect(asked.rebuyRequests).toEqual([{ playerId: 'p1', amount: 1000 }])
    expect(tryMsg(asked, 'p1', { type: 'rebuy', amount: 500 })).toEqual({
      ok: false,
      error: 'Запрос уже отправлен — ждёт ведущего',
    })

    const free = newTable(['p0', 'p1'])
    expect(tryMsg(free, 'p1', { type: 'rebuy', amount: 50_000 }).ok).toBe(true)
  })

  it('между раздачами: «да» ведущего — стек сразу растёт, в журнале кто, было, стало', () => {
    const s = play(
      newTable(['p0', 'p1']),
      [send('p1', { type: 'rebuy', amount: 500 }), send('p0', { type: 'rebuyAnswer', playerId: 'p1', approve: true }, 7)],
      roundtrip,
    )
    expect(s.rebuyRequests).toEqual([])
    expect(player(s, 'p1').chips).toBe(1500)
    expect(player(s, 'p1').buyIn).toBe(1500)
    expect(s.chipLog.at(-1)).toEqual({ kind: 'rebuy', playerId: 'p1', by: 'p0', from: 1000, to: 1500, at: 7 })
  })

  it('«нет» ведущего — стек прежний, отказ в журнале', () => {
    const s = play(
      newTable(['p0', 'p1']),
      [send('p1', { type: 'rebuy', amount: 300 }), send('p0', { type: 'rebuyAnswer', playerId: 'p1', approve: false })],
      roundtrip,
    )
    expect(player(s, 'p1').chips).toBe(1000)
    expect(player(s, 'p1').buyIn).toBe(1000)
    expect(s.chipLog.at(-1)).toEqual({ kind: 'rebuyDeclined', playerId: 'p1', by: 'p0', amount: 300, at: 0 })
  })

  it('без «да» ведущего стек не растёт', () => {
    const s = play(newTable(['p0', 'p1']), [send('p1', { type: 'rebuy', amount: 500 })], roundtrip)
    expect(player(s, 'p1').chips).toBe(1000)
  })

  it('«да» во время раздачи — стек растёт только после неё', () => {
    let s = play(
      newTable(['p0', 'p1']),
      [
        start('p0'),
        send('p1', { type: 'rebuy', amount: 500 }),
        send('p0', { type: 'rebuyAnswer', playerId: 'p1', approve: true }),
        call('p0'),
        check('p1'),
      ],
      roundtrip,
    )
    expect(s.hand?.seats.find((x) => x.id === 'p1')?.chips).toBe(990) // в раздаче — прежний стек
    expect(player(s, 'p1').chips).toBe(1000)
    expect(s.approvedRebuys).toEqual([{ playerId: 'p1', amount: 500, by: 'p0' }])
    s = play(
      s,
      [check('p1'), check('p0'), check('p1'), check('p0'), check('p1'), check('p0'), award('p0', [['p0']], 9)],
      roundtrip,
    )
    expect(player(s, 'p1').chips).toBe(990 + 500)
    expect(s.approvedRebuys).toEqual([])
    expect(s.chipLog.at(-1)).toEqual({ kind: 'rebuy', playerId: 'p1', by: 'p0', from: 990, to: 1490, at: 9 })
  })

  it('правка стека ведущим — в журнале кто, было, стало; во время раздачи — отказ', () => {
    const s = play(newTable(['p0', 'p1']), [send('p0', { type: 'setStack', playerId: 'p1', chips: 2500 }, 5)], roundtrip)
    expect(player(s, 'p1').chips).toBe(2500)
    expect(s.chipLog.at(-1)).toEqual({ kind: 'set', playerId: 'p1', by: 'p0', from: 1000, to: 2500, at: 5 })

    const inHand = play(s, [start('p0')], roundtrip)
    expect(tryMsg(inHand, 'p0', { type: 'setStack', playerId: 'p1', chips: 100 })).toEqual({
      ok: false,
      error: 'Стек правится между раздачами',
    })
    expect(tryMsg(s, 'p1', { type: 'setStack', playerId: 'p1', chips: 9000 })).toEqual({
      ok: false,
      error: 'Это может только ведущий',
    })
  })
})
