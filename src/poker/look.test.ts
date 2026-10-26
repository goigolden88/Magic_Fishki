import { describe, expect, it } from 'vitest'
import { hostDo, parseLocalTable, startLocalTable } from '../calc/localTable'
import { lookClass, lookOf } from '../calc/pokerLook'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { handle, viewFor, type TableState } from './table'
import { call, newTable, play, start } from './testing'

const send = (state: TableState, from: string, body: ClientBody, now = 0) => handle(state, from, { v: PROTOCOL_VERSION, ...body }, now)

describe('вид стола (#77)', () => {
  it('выбор ведущего доходит в вид стола у всех; меняется и во время раздачи', () => {
    let s = play(newTable(['h', 'g']), [start('h'), call('h')], true)
    const r = send(s, 'h', { type: 'look', felt: 'burgundy', cardBack: 'geo' })
    expect(r.ok).toBe(true)
    s = r.ok ? r.state : s
    expect(s.hand).not.toBeNull() // раздача идёт дальше
    expect(lookOf(viewFor(s, 'g').settings)).toEqual({ felt: 'burgundy', cardBack: 'geo' })
    expect(lookClass(viewFor(s, null).settings)).toBe('table-look felt-burgundy back-geo')
  })

  it('нет поля — не меняется', () => {
    let s = newTable(['h', 'g'], { felt: 'blue', cardBack: 'green' })
    const r = send(s, 'h', { type: 'look', felt: 'graphite' })
    s = r.ok ? r.state : s
    expect(lookOf(s.settings)).toEqual({ felt: 'graphite', cardBack: 'green' })
  })

  it('не ведущему — отказ', () => {
    const s = newTable(['h', 'g'])
    expect(send(s, 'g', { type: 'look', felt: 'blue' })).toEqual({ ok: false, error: 'Это может только ведущий' })
  })

  it('неизвестное значение — отказ, и при создании стола', () => {
    const s = newTable(['h', 'g'])
    expect(send(s, 'h', { type: 'look', felt: 'pink' as 'blue' })).toEqual({
      ok: false,
      error: 'Сукно — зелёное, синее, бордовое или графит',
    })
    expect(send(s, 'h', { type: 'look', cardBack: null as unknown as 'geo' }).ok).toBe(false)
    expect(() => newTable(['h'], { cardBack: 'toString' as 'geo' })).toThrow('Рубашка карт')
  })

  it('стол без полей вида (до #77) — зелёное и классика; правила работают', () => {
    const old = newTable(['h', 'g'])
    delete old.settings.felt
    delete old.settings.cardBack
    expect(lookOf(old.settings)).toEqual({ felt: 'green', cardBack: 'classic' })
    expect(lookClass(old.settings)).toBe('table-look felt-green back-classic')
    const s = play(old, [start('h'), call('h')], true)
    expect(s.hand?.number).toBe(1)
  })

  it('стол на одном телефоне: сукно при начале и тем же сообщением; сохранённый до #77 открывается', () => {
    let n = 0
    const r = startLocalTable(
      [
        { name: 'Аня', regularId: null },
        { name: 'Боря', regularId: null },
      ],
      { sb: 5, bb: 10, startingStack: 1000, felt: 'blue' },
      0,
      () => `id${n++}`,
    )
    if (!r.ok) throw new Error(r.error)
    expect(lookOf(r.local.table.settings).felt).toBe('blue')
    const changed = hostDo(r.local.table, { type: 'look', felt: 'graphite' }, 0)
    expect(changed.ok && changed.state.settings.felt).toBe('graphite')

    const old = structuredClone(r.local)
    delete old.table.settings.felt
    delete old.table.settings.cardBack
    const parsed = parseLocalTable(JSON.stringify(old))
    expect(parsed && lookOf(parsed.table.settings)).toEqual({ felt: 'green', cardBack: 'classic' })
  })
})
