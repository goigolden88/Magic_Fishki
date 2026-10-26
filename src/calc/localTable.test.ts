import { describe, expect, it } from 'vitest'
import type { TableState } from '../poker/table'
import {
  actFor,
  hostDo,
  LOCAL_MAX_SEATS,
  localStartError,
  localTableView,
  parseLocalTable,
  pendingRebuy,
  rebuyNow,
  removePlayer,
  seatPlayer,
  startLocalTable,
  toActId,
  type LocalPlayer,
  type LocalTable,
} from './localTable'
import { gameFromTable } from './pokerGame'

const counter = () => {
  let n = 0
  return () => `id${++n}`
}

const PLAYERS: LocalPlayer[] = [
  { name: 'Аня', regularId: 'r-anya' },
  { name: 'Боря', regularId: 'r-borya' },
  { name: 'Гость Вова', regularId: null },
]

function start(players = PLAYERS): LocalTable {
  const r = startLocalTable(players, { sb: 5, bb: 10, startingStack: 1000 }, 0, counter())
  if (!r.ok) throw new Error(r.error)
  return r.local
}

function ok(r: { ok: true; state: TableState } | { ok: false; error: string }): TableState {
  if (!r.ok) throw new Error(r.error)
  return r.state
}

const nameOf = (t: TableState, id: string | null) => t.players.find((p) => p.id === id)?.name ?? null

describe('стол на одном телефоне', () => {
  it('новый стол: все по порядку, ведущий — первый, мест — с запасом на новых', () => {
    const local = start()
    const t = local.table
    expect(t.players.map((p) => [p.name, p.regularId, p.seat, p.chips, p.buyIn, p.online])).toEqual([
      ['Аня', 'r-anya', 0, 1000, 1000, true],
      ['Боря', 'r-borya', 1, 1000, 1000, true],
      ['Гость Вова', null, 2, 1000, 1000, true],
    ])
    expect(t.hostId).toBe(t.players[0].id)
    expect(t.settings).toMatchObject({ sb: 5, bb: 10, startingStack: 1000, maxSeats: LOCAL_MAX_SEATS })
    expect(local.gameId).toBeNull()
    expect(local.id).not.toBe(t.hostId)
  })

  it('«Начать» — от двух до десяти игроков', () => {
    expect(localStartError(1)).toBe('Нужно хотя бы двое')
    expect(localStartError(2)).toBeNull()
    expect(localStartError(LOCAL_MAX_SEATS)).toBeNull()
    expect(localStartError(LOCAL_MAX_SEATS + 1)).toBe('За столом — не больше 10')
    const many = Array.from({ length: LOCAL_MAX_SEATS }, (_, i) => ({ name: `Игрок ${i}`, regularId: null }))
    expect(startLocalTable(many, { sb: 5, bb: 10, startingStack: 1000 }, 0, counter()).ok).toBe(true)
    expect(startLocalTable([...many, { name: 'Лишний', regularId: null }], { sb: 5, bb: 10, startingStack: 1000 }, 0, counter())).toEqual({
      ok: false,
      error: 'За столом — не больше 10',
    })
    expect(startLocalTable([PLAYERS[0], PLAYERS[0]], { sb: 5, bb: 10, startingStack: 1000 }, 0, counter())).toEqual({
      ok: false,
      error: 'Этот игрок уже за столом',
    })
  })

  it('ход — за того, чья очередь; после хода очередь — следующему', () => {
    let t = ok(hostDo(start().table, { type: 'start' }, 0))
    // Трое: кнопка — Аня, блайнды — Боря и Вова, первой до флопа ходит Аня
    expect(nameOf(t, toActId(t))).toBe('Аня')
    let v = localTableView(t, 0)
    expect(v.isHost).toBe(true)
    expect(v.me).toBeNull()
    expect(v.seats.some((s) => s.isMe)).toBe(false)
    expect(v.toActName).toBe('Аня')
    expect(v.actions).toMatchObject({ myTurn: true, check: false, call: 10 })

    t = ok(actFor(t, { type: 'call' }, 0))
    expect(nameOf(t, toActId(t))).toBe('Боря')
    v = localTableView(t, 0)
    expect(v.toActName).toBe('Боря')
    expect(v.actions).toMatchObject({ myTurn: true, check: false, call: 5 })

    t = ok(actFor(t, { type: 'raise', to: 40 }, 0))
    t = ok(actFor(t, { type: 'fold' }, 0)) // Вова
    t = ok(actFor(t, { type: 'call' }, 0)) // Аня
    expect(t.hand?.stage).toBe('flop')
    expect(nameOf(t, toActId(t))).toBe('Боря')
    // Неправильный ход — отказ, стол как был
    expect(actFor(t, { type: 'raise', to: 1 }, 0).ok).toBe(false)

    // До ривера чек — торги закрыты, ходить некому, кнопок хода нет
    for (let i = 0; i < 6; i++) t = ok(actFor(t, { type: 'check' }, 0))
    expect(t.hand?.stage).toBe('showdown')
    expect(toActId(t)).toBeNull()
    expect(localTableView(t, 0).actions).toBeNull()
    expect(actFor(t, { type: 'check' }, 0)).toEqual({ ok: false, error: 'Сейчас ничей ход' })

    const borya = t.players[1].id
    t = ok(hostDo(t, { type: 'award', winners: [[borya]] }, 0))
    expect(t.players.map((p) => p.chips)).toEqual([960, 1050, 990])
  })

  it('все в олл-ин — побочный банк, как в сети', () => {
    let t = start().table
    t = ok(hostDo(t, { type: 'setStack', playerId: t.players[0].id, chips: 100 }, 0))
    t = ok(hostDo(t, { type: 'start' }, 0))
    t = ok(actFor(t, { type: 'allin' }, 0)) // Аня 100
    t = ok(actFor(t, { type: 'raise', to: 300 }, 0)) // Боря
    t = ok(actFor(t, { type: 'call' }, 0)) // Вова
    expect(t.hand?.stage).toBe('flop')
    for (let i = 0; i < 6; i++) t = ok(actFor(t, { type: 'check' }, 0))
    expect(t.hand?.pots.map((p) => p.amount)).toEqual([300, 400])
  })

  it('докуп сразу: между раздачами — в стек, в раздаче — после неё', () => {
    let t = start().table
    const vova = t.players[2].id
    t = ok(rebuyNow(t, vova, 500, 0))
    expect(t.players[2]).toMatchObject({ chips: 1500, buyIn: 1500 })
    expect(t.rebuyRequests).toEqual([])

    t = ok(hostDo(t, { type: 'start' }, 0))
    t = ok(rebuyNow(t, vova, 1000, 0))
    expect(t.players[2]).toMatchObject({ buyIn: 2500 })
    expect(pendingRebuy(t, vova)).toBe(1000)
    t = ok(actFor(t, { type: 'fold' }, 0)) // Аня
    t = ok(actFor(t, { type: 'fold' }, 0)) // Боря — банк Вове
    t = ok(hostDo(t, { type: 'award', winners: [[vova]] }, 0))
    expect(pendingRebuy(t, vova)).toBe(0)
    expect(t.players[2]).toMatchObject({ chips: 2505, buyIn: 2500 })

    // Докупы выключены — отказ, стол как был
    const off = start().table
    off.settings.rebuyMaxBB = 0
    expect(rebuyNow(off, off.players[1].id, 500, 0)).toEqual({ ok: false, error: 'Докупы за этим столом выключены' })
  })

  it('убрать со стола: и ведущего — ведение следующему; в раздаче — после неё', () => {
    let t = start().table
    const [anya, borya] = t.players.map((p) => p.id)
    t = ok(removePlayer(t, anya, 0))
    expect(t.players.map((p) => p.name)).toEqual(['Боря', 'Гость Вова'])
    expect(t.hostId).toBe(borya)
    expect(t.chipLog.at(-1)).toMatchObject({ kind: 'leave', playerId: anya, chips: 1000, name: 'Аня' })

    t = ok(hostDo(t, { type: 'start' }, 0))
    const before = t
    expect(removePlayer(t, borya, 0)).toEqual({ ok: false, error: 'Игрок в раздаче — уберите после неё' })
    expect(t).toBe(before)

    const two = start([PLAYERS[0], PLAYERS[1]]).table
    const alone = ok(removePlayer(two, two.players[1].id, 0))
    expect(alone.players).toHaveLength(1)
    expect(removePlayer(alone, alone.players[0].id, 0).ok).toBe(false)
  })

  it('посадить нового: гость и постоянный; постоянный дважды — нет', () => {
    let t = start().table
    t = ok(seatPlayer(t, 'new1', { name: 'Галя', regularId: 'r-galya' }, 0))
    t = ok(seatPlayer(t, 'new2', { name: 'Гость Дима', regularId: null }, 0))
    expect(t.players.slice(3).map((p) => [p.name, p.regularId, p.seat, p.chips])).toEqual([
      ['Галя', 'r-galya', 3, 1000],
      ['Гость Дима', null, 4, 1000],
    ])
    expect(seatPlayer(t, 'new3', { name: 'Галя', regularId: 'r-galya' }, 0)).toEqual({ ok: false, error: 'Этот игрок уже за столом' })
  })

  it('сохранение и восстановление посреди раздачи: та же раздача, стеки и журнал; игра продолжается', () => {
    const local = start()
    let t = ok(hostDo(local.table, { type: 'start' }, 0))
    t = ok(rebuyNow(t, t.players[1].id, 500, 0))
    t = ok(actFor(t, { type: 'raise', to: 30 }, 0))
    const saved = JSON.stringify({ ...local, table: t })

    const back = parseLocalTable(saved)
    expect(back).toEqual({ ...local, table: t })
    if (!back) return
    expect(nameOf(back.table, toActId(back.table))).toBe('Боря')
    let r = back.table
    r = ok(actFor(r, { type: 'fold' }, 0))
    r = ok(actFor(r, { type: 'fold' }, 0))
    r = ok(hostDo(r, { type: 'award', winners: [[r.players[0].id]] }, 0))
    expect(r.players.map((p) => p.chips)).toEqual([1015, 1495, 990])

    // Отметка «записан» переживает перезапуск
    expect(parseLocalTable(JSON.stringify({ ...local, gameId: 'g1' }))?.gameId).toBe('g1')
  })

  it('стол на телефоне — только живые карты; сохранённый до карт (без настройки) поднимается и доигрывается', () => {
    const local = start()
    expect(local.table.settings.cards).toBe('live')
    const old = JSON.parse(JSON.stringify(local)) as LocalTable
    delete (old.table.settings as Partial<TableState['settings']>).cards
    const back = parseLocalTable(JSON.stringify(old))
    if (!back) throw new Error('стол не поднялся')
    let t = ok(hostDo(back.table, { type: 'start' }, 0))
    expect(t.hand?.cards).toBeUndefined()
    t = ok(actFor(t, { type: 'fold' }, 0))
    t = ok(actFor(t, { type: 'fold' }, 0))
    t = ok(hostDo(t, { type: 'award', winners: [[t.players[2].id]] }, 0))
    expect(t.players.map((p) => p.chips)).toEqual([1000, 995, 1005])
  })

  it('не стол — null', () => {
    expect(parseLocalTable('')).toBeNull()
    expect(parseLocalTable('не json')).toBeNull()
    expect(parseLocalTable('{"id":"x"}')).toBeNull()
    expect(parseLocalTable(JSON.stringify({ id: 1, table: start().table }))).toBeNull()
    expect(parseLocalTable(JSON.stringify({ id: 'x', table: { ...start().table, players: null } }))).toBeNull()
  })

  it('итог — игрой, как у онлайн-стола: закуп, докуп, выход, постоянные', () => {
    let t = start().table
    const [anya, borya, vova] = t.players.map((p) => p.id)
    t = ok(rebuyNow(t, vova, 500, 0))
    t = ok(hostDo(t, { type: 'start' }, 0))
    t = ok(actFor(t, { type: 'fold' }, 0))
    t = ok(actFor(t, { type: 'fold' }, 0))
    t = ok(hostDo(t, { type: 'award', winners: [[vova]] }, 0))
    t = ok(removePlayer(t, anya, 0))
    const game = gameFromTable(t, { name: 'Вечер', date: '2026-10-25', rate: 0.5, now: '2026-10-25T20:00:00.000Z' }, counter())
    expect(game.players.map((p) => [p.name, p.regularId])).toEqual([
      ['Аня', 'r-anya'],
      ['Боря', 'r-borya'],
      ['Гость Вова', undefined],
    ])
    expect(game.closed).toBe(true)
    const sum = (kind: string) => game.entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.chips, 0)
    expect([sum('buyin'), sum('rebuy'), sum('cashout')]).toEqual([3000, 500, 3500])
    expect(borya).toBe(t.hostId)
  })
})
