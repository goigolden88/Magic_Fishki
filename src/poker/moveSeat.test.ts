import { describe, expect, it } from 'vitest'
import { localTableView, startLocalTable, hostDo } from '../calc/localTable'
import { tableView } from '../calc/pokerView'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { handle, type TableState } from './table'
import { award, fold, MODES, newTable, play, start, type Step } from './testing'
import { DEFAULT_TOURNAMENT } from './tournament'

const send = (s: TableState, from: string, body: ClientBody) => handle(s, from, { v: PROTOCOL_VERSION, ...body }, 0)
const move = (from: string, seat: number, playerId?: string): Step => ({
  from,
  msg: { type: 'moveSeat', seat, ...(playerId ? { playerId } : {}) },
})
const seats = (s: TableState) => Object.fromEntries(s.players.map((p) => [p.id, p.seat]))
// Раздача втроём до конца: первым ходит кнопка — пас, за ней малый — пас, банк большому
const playHand = (s: TableState, roundtrip: boolean) => {
  const hand = play(s, [start('p0')], roundtrip).hand!
  const [first, second, big] = [hand.seats[hand.button], hand.seats[(hand.button + 1) % 3], hand.seats[(hand.button + 2) % 3]]
  return play(s, [start('p0'), fold(first.id), fold(second.id), award('p0', [[big.id]])], roundtrip)
}

// Пересадка (#98): между раздачами на свободное место — сам или ведущим за другого
describe.each(MODES)('пересадка — %s', (_, roundtrip) => {
  it('игрок пересаживается на свободное место; фишки и закуп — те же', () => {
    const s = play(newTable(['p0', 'p1', 'p2']), [move('p1', 6)], roundtrip)
    expect(seats(s)).toEqual({ p0: 0, p1: 6, p2: 2 })
    const p1 = s.players.find((p) => p.id === 'p1')
    expect([p1?.chips, p1?.buyIn]).toEqual([1000, 1000])
    expect(s.chipLog.filter((e) => e.kind !== 'buyin')).toEqual([])
  })

  it('на занятое место — нельзя; двое на одно — сел первый, второму — «занято»', () => {
    const s = newTable(['p0', 'p1', 'p2'])
    expect(send(s, 'p1', { type: 'moveSeat', seat: 2 })).toEqual({ ok: false, error: 'Место уже занято — выберите другое' })
    const first = play(s, [move('p1', 5)], roundtrip)
    expect(send(first, 'p2', { type: 'moveSeat', seat: 5 })).toEqual({ ok: false, error: 'Место уже занято — выберите другое' })
    expect(seats(first)).toEqual({ p0: 0, p1: 5, p2: 2 })
  })

  it('своё место, вне стола и не число — отказ', () => {
    const s = newTable(['p0', 'p1'], { maxSeats: 6 })
    expect(send(s, 'p1', { type: 'moveSeat', seat: 1 })).toEqual({ ok: false, error: 'Уже на этом месте' })
    for (const seat of [6, -1, 1.5, '3' as unknown as number]) {
      expect(send(s, 'p1', { type: 'moveSeat', seat })).toEqual({ ok: false, error: 'Места за столом — с 1 по 6' })
    }
  })

  it('во время раздачи — нельзя; после неё и в «Перерыв» — можно', () => {
    const s = play(newTable(['p0', 'p1', 'p2']), [start('p0')], roundtrip)
    expect(send(s, 'p1', { type: 'moveSeat', seat: 7 })).toEqual({ ok: false, error: 'Пересесть можно между раздачами' })
    expect(send(s, 'p0', { type: 'moveSeat', seat: 7, playerId: 'p1' }).ok).toBe(false)
    const after = play(playHand(newTable(['p0', 'p1', 'p2']), roundtrip), [move('p1', 7)], roundtrip)
    expect(after.players.find((p) => p.id === 'p1')?.seat).toBe(7)
    const paused = play(newTable(['p0', 'p1']), [{ from: 'p0', msg: { type: 'pause', paused: true } }, move('p1', 4)], roundtrip)
    expect(paused.players.find((p) => p.id === 'p1')?.seat).toBe(4)
  })

  it('ведущий пересаживает другого; игрок другого — нет', () => {
    const s = newTable(['p0', 'p1', 'p2'])
    expect(send(s, 'p1', { type: 'moveSeat', seat: 4, playerId: 'p2' })).toEqual({ ok: false, error: 'Это может только ведущий' })
    const moved = play(s, [move('p0', 4, 'p2')], roundtrip)
    expect(seats(moved)).toEqual({ p0: 0, p1: 1, p2: 4 })
    expect(send(s, 'p0', { type: 'moveSeat', seat: 4, playerId: 'p9' })).toEqual({ ok: false, error: 'Такого игрока нет за столом' })
  })

  it('кнопка и блайнды следующей раздачи — по новому порядку мест, от прошлой кнопки', () => {
    // Раздача 1: кнопка — место 0 (p0). p1 уходит с места 1 на 4: следующая кнопка — место 2 (p2)
    const one = playHand(newTable(['p0', 'p1', 'p2']), roundtrip)
    expect(one.buttonSeat).toBe(0)
    const two = play(one, [move('p1', 4), start('p0')], roundtrip)
    const hand = two.hand!
    expect(hand.seats.map((x) => x.id)).toEqual(['p0', 'p2', 'p1'])
    expect(two.buttonSeat).toBe(2)
    expect(hand.seats[hand.button].id).toBe('p2')
    // Малый и большой — следующие по местам за кнопкой: p1 (место 4), затем p0
    expect(hand.seats.find((x) => x.id === 'p1')?.committed).toBe(5)
    expect(hand.seats.find((x) => x.id === 'p0')?.committed).toBe(10)
  })

  it('пересел на место кнопки — следующая кнопка всё равно идёт к следующему по номеру', () => {
    // Кнопка была на месте 0 (p0); p0 пересел на 3, p2 — на 0: кнопка — к месту 1 (p1)
    const one = playHand(newTable(['p0', 'p1', 'p2']), roundtrip)
    const two = play(one, [move('p0', 3), move('p2', 0), start('p0')], roundtrip)
    expect(two.buttonSeat).toBe(1)
    expect(two.hand?.seats[two.hand.button].id).toBe('p1')
  })

  it('турнир — так же, между раздачами', () => {
    const cup = { format: 'tournament' as const, tournament: { ...DEFAULT_TOURNAMENT, buyIn: 500 } }
    const s = play(newTable(['p0', 'p1', 'p2'], cup), [start('p0')], roundtrip)
    expect(s.tournament).not.toBeNull()
    expect(send(s, 'p2', { type: 'moveSeat', seat: 8 }).ok).toBe(false)
    const hand = s.hand!
    const ids = [0, 1, 2].map((k) => hand.seats[(hand.button + k) % 3].id)
    const done = play(s, [fold(ids[0]), fold(ids[1]), award('p0', [[ids[2]]]), move('p2', 8)], roundtrip)
    expect(done.players.find((p) => p.id === 'p2')?.seat).toBe(8)
  })
})

describe('свободные места на экране', () => {
  it('между раздачами — все свободные по номерам; в раздаче — нет', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], { maxSeats: 6 }), [move('p1', 4)], false)
    const v = tableView(s, 'p1', 0)
    expect(v.maxSeats).toBe(6)
    expect(v.freeSeats).toEqual([1, 3, 5])
    expect(v.seats.map((x) => [x.id, x.seat])).toEqual([
      ['p0', 0],
      ['p2', 2],
      ['p1', 4],
    ])
    const inHand = play(s, [start('p0')], false)
    expect(tableView(inHand, 'p1', 0).freeSeats).toEqual([])
  })

  it('на одном телефоне ведущий пересаживает игрока', () => {
    let n = 0
    const r = startLocalTable(
      [
        { name: 'Аня', regularId: null },
        { name: 'Боря', regularId: null },
      ],
      { sb: 5, bb: 10, startingStack: 1000, felt: 'green' },
      0,
      () => `id${n++}`,
    )
    if (!r.ok) throw new Error(r.error)
    const table = r.local.table
    const bob = table.players[1].id
    const moved = hostDo(table, { type: 'moveSeat', seat: 7, playerId: bob }, 0)
    if (!moved.ok) throw new Error(moved.error)
    expect(moved.state.players.find((p) => p.id === bob)?.seat).toBe(7)
    expect(localTableView(moved.state, 0).freeSeats).not.toContain(7)
  })
})
