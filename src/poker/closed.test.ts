import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { CLOSED_ERROR, createTable, handle, type TableState } from './table'
import { call, MODES, newTable, play, start } from './testing'
import { DEFAULT_TOURNAMENT } from './tournament'

const send = (state: TableState, from: string, body: ClientBody, now = 0) => handle(state, from, { v: PROTOCOL_VERSION, ...body }, now)
const close = (closed: boolean) => ({ from: 'h', msg: { type: 'closeTable', closed } as ClientBody })

describe.each(MODES)('«Стол закрыт» (#313) — %s', (_, rt) => {
  it('закрытый стол — новый не садится, причина «Стол закрыт ведущим»; открыли — садится', () => {
    const s = play(newTable(['h', 'g']), [close(true)], rt)
    expect(s.settings.closed).toBe(true)
    expect(send(s, 'x', { type: 'sit', name: 'X' })).toEqual({ ok: false, error: CLOSED_ERROR })
    expect(CLOSED_ERROR).toBe('Стол закрыт ведущим')
    const open = play(s, [close(false)], rt)
    expect('closed' in open.settings).toBe(false) // открыт — поля нет, как у старых столов
    const r = send(open, 'x', { type: 'sit', name: 'X' })
    expect(r.ok && r.state.players.map((p) => p.id)).toEqual(['h', 'g', 'x'])
  })

  it('сидящие играют как раньше; закрыть и открыть можно и во время раздачи', () => {
    let s = play(newTable(['h', 'g']), [start('h'), close(true)], rt)
    expect(s.hand).not.toBeNull()
    expect(s.settings.closed).toBe(true)
    s = play(s, [call('h'), close(false)], rt)
    expect(s.settings.closed).toBeUndefined()
  })

  it('меняет только ведущий; кривое значение — отказ', () => {
    const s = newTable(['h', 'g'])
    expect(send(s, 'g', { type: 'closeTable', closed: true })).toEqual({ ok: false, error: 'Это может только ведущий' })
    expect(send(s, 'x', { type: 'closeTable', closed: true })).toEqual({ ok: false, error: 'Вас нет за столом' })
    expect(send(s, 'h', { type: 'closeTable', closed: 'да' as unknown as boolean }).ok).toBe(false)
  })

  it('убранный ведущим на закрытом столе новым не вернётся', () => {
    const s = play(newTable(['h', 'g']), [{ from: 'h', msg: { type: 'remove', playerId: 'g' } }, close(true)], rt)
    expect(send(s, 'g', { type: 'sit', name: 'G' })).toEqual({ ok: false, error: CLOSED_ERROR })
  })

  it('турнир: закрытый стол закрывает и позднюю регистрацию', () => {
    const cup = { format: 'tournament' as const, tournament: { ...DEFAULT_TOURNAMENT, levelMinutes: 10, lateRegLevels: 2 } }
    const running = play(newTable(['h', 'g'], cup), [start('h')], rt)
    expect(send(running, 'x', { type: 'sit', name: 'X' }, 60_000).ok).toBe(true)
    const closed = play(running, [close(true)], rt)
    expect(send(closed, 'x', { type: 'sit', name: 'X' }, 60_000)).toEqual({ ok: false, error: CLOSED_ERROR })
  })

  it('старый стол без поля — открыт; новый стол всегда открыт, ведущий садится', () => {
    const old = newTable(['h'])
    delete old.settings.closed
    expect(send(old, 'x', { type: 'sit', name: 'X' }).ok).toBe(true)
    const r = createTable('h', 'H', { closed: true }, 0)
    expect(r.ok && r.state.settings.closed).toBeUndefined()
    expect(r.ok && r.state.players.map((p) => p.id)).toEqual(['h'])
  })
})
