import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, VERSION_ERROR } from '../../src/poker/protocol'
import type { TableState } from '../../src/poker/table'
import { alarm, close, CLOSE_ENDED, CLOSE_NO_ROOM, CLOSE_VERSION, IDLE_MS, initRoom, message, NO_ROOM, open, type RoomRecord } from './room'
import { FakePeer, fakeRoom } from './testing'

const send = (r: ReturnType<typeof fakeRoom>, peer: FakePeer, body: Record<string, unknown>, now = 0) =>
  message(r.env, peer, JSON.stringify({ v: PROTOCOL_VERSION, ...body }), now)

const connect = async (r: ReturnType<typeof fakeRoom>) => {
  const peer = new FakePeer()
  r.peers.push(peer)
  await open(r.env, peer)
  return peer
}

const tableOf = (peer: FakePeer) => {
  const states = peer.sent.filter((m) => m.type === 'state')
  return states.at(-1)?.table as TableState
}

const stored = (r: ReturnType<typeof fakeRoom>) => r.storage.get<RoomRecord>('room')

// Комната с ведущим «Ведущий» (вошёл по токену) и игроком «Гость»
async function twoPlayers() {
  const r = fakeRoom()
  const created = await initRoom(r.env, 'ABCDEF', 'Ведущий', {}, 0)
  if (!created.ok) throw new Error(created.error)
  const host = await connect(r)
  await send(r, host, { type: 'join', playerId: created.playerId, token: created.token })
  const guest = await connect(r)
  await send(r, guest, { type: 'join', name: 'Гость' })
  const welcome = guest.sent.find((m) => m.type === 'welcome') as { playerId: string; token: string }
  return { r, host, guest, hostId: created.playerId, hostToken: created.token, guestId: welcome.playerId, guestToken: welcome.token }
}

describe('комната', () => {
  it('создание: ведущий за столом вне сети, будильник через сутки', async () => {
    const r = fakeRoom()
    const created = await initRoom(r.env, 'ABCDEF', 'Ведущий', { startingStack: 500 }, 1000)
    expect(created.ok).toBe(true)
    const room = await stored(r)
    expect(room?.code).toBe('ABCDEF')
    expect(room?.table.players).toMatchObject([{ name: 'Ведущий', chips: 500, online: false }])
    expect(r.storage.alarmAt).toBe(1000 + IDLE_MS)
  })

  it('кривые настройки — комнаты нет', async () => {
    const r = fakeRoom()
    expect(await initRoom(r.env, 'ABCDEF', 'Ведущий', { sb: 20, bb: 10 }, 0)).toEqual({
      ok: false,
      error: 'Блайнды — целые числа, малый не больше большого',
    })
    expect(await stored(r)).toBeUndefined()
  })

  it('двое подключились — ход одного сразу видят оба', async () => {
    const { r, host, guest, hostId, guestId } = await twoPlayers()
    expect(host.last()).toMatchObject({ v: PROTOCOL_VERSION, type: 'state' })
    expect(tableOf(host).players.map((p) => [p.id, p.online])).toEqual([
      [hostId, true],
      [guestId, true],
    ])
    await send(r, host, { type: 'start' })
    expect(tableOf(host).hand?.number).toBe(1)
    expect(tableOf(guest)).toEqual(tableOf(host))
    // Хедз-ап: кнопка — ведущий, ходит первым
    await send(r, host, { type: 'act', action: { type: 'call' } })
    expect(tableOf(guest).hand?.seats.map((s) => s.bet)).toEqual([10, 10])
  })

  it('отказ стола — только тому, кто прислал; стол не меняется', async () => {
    const { r, host, guest } = await twoPlayers()
    const before = await stored(r)
    const sentToHost = host.sent.length
    await send(r, guest, { type: 'start' })
    expect(guest.last()).toEqual({ v: PROTOCOL_VERSION, type: 'error', error: 'Это может только ведущий' })
    expect(host.sent.length).toBe(sentToHost)
    expect(await stored(r)).toEqual(before)
  })

  it('переподключение с токеном — на своё место со своим стеком', async () => {
    const { r, host, guest, guestId, guestToken } = await twoPlayers()
    await send(r, host, { type: 'setStack', playerId: guestId, chips: 1234 })
    guest.close(1006, '')
    await close(r.env, guest, 5)
    expect(tableOf(host).players.find((p) => p.id === guestId)).toMatchObject({ online: false, offlineSince: 5 })

    const back = await connect(r)
    await send(r, back, { type: 'join', playerId: guestId, token: guestToken })
    expect(back.sent[0]).toEqual({ v: PROTOCOL_VERSION, type: 'welcome', playerId: guestId, token: guestToken })
    const me = tableOf(back).players.find((p) => p.id === guestId)
    expect(me).toMatchObject({ seat: 1, chips: 1234, online: true })
    expect(tableOf(back).players.length).toBe(2)
  })

  it('чужой токен — вход новым игроком, а не на чужое место', async () => {
    const { r, hostId } = await twoPlayers()
    const thief = await connect(r)
    await send(r, thief, { type: 'join', playerId: hostId, token: 'не тот', name: 'Чужой' })
    const welcome = thief.sent[0] as { type: string; playerId: string }
    expect(welcome.type).toBe('welcome')
    expect(welcome.playerId).not.toBe(hostId)
    const table = tableOf(thief)
    expect(table.players.map((p) => p.name)).toEqual(['Ведущий', 'Гость', 'Чужой'])
    expect(table.hostId).toBe(hostId)
  })

  it('без токена и без имени — не садится', async () => {
    const { r } = await twoPlayers()
    const peer = await connect(r)
    await send(r, peer, { type: 'join' })
    expect(peer.last()).toEqual({ v: PROTOCOL_VERSION, type: 'error', error: 'Нужно имя' })
    expect(peer.playerId()).toBeNull()
  })

  it('вход с того же места на другом телефоне — старое соединение закрывается, игрок в сети', async () => {
    const { r, guest, guestId, guestToken, host } = await twoPlayers()
    const other = await connect(r)
    await send(r, other, { type: 'join', playerId: guestId, token: guestToken })
    expect(guest.closed).not.toBeNull()
    await close(r.env, guest, 9)
    expect(tableOf(host).players.find((p) => p.id === guestId)?.online).toBe(true)
  })

  it('сон между сообщениями: стол каждый раз поднимается из хранилища', async () => {
    const { r, host, guest, guestId } = await twoPlayers()
    // Память объекта пуста: всё, что есть у комнаты, — хранилище и отметки на соединениях
    await send(r, host, { type: 'start' })
    const afterStart = await stored(r)
    expect(afterStart?.table.hand?.number).toBe(1)
    r.storage.data.set('room', JSON.stringify(afterStart)) // как после пробуждения
    await send(r, host, { type: 'act', action: { type: 'raise', to: 40 } })
    await send(r, guest, { type: 'act', action: { type: 'call' } })
    const room = await stored(r)
    expect(room?.table.hand?.stage).toBe('flop')
    expect(tableOf(guest)).toEqual(room?.table)
    expect(guest.playerId()).toBe(guestId)
  })

  it('старая версия приложения — «обновите», в комнату не попадает', async () => {
    const { r } = await twoPlayers()
    const before = await stored(r)
    const old = await connect(r)
    await message(r.env, old, JSON.stringify({ v: PROTOCOL_VERSION - 1, type: 'join', name: 'Старый' }), 0)
    expect(old.sent).toEqual([{ v: PROTOCOL_VERSION, type: 'error', error: VERSION_ERROR }])
    expect(old.closed?.code).toBe(CLOSE_VERSION)
    expect(old.playerId()).toBeNull()
    expect(await stored(r)).toEqual(before)
  })

  it('кода нет — «комнаты нет», соединение закрыто', async () => {
    const r = fakeRoom()
    const peer = await connect(r)
    expect(peer.sent).toEqual([{ v: PROTOCOL_VERSION, type: 'error', error: NO_ROOM }])
    expect(peer.closed?.code).toBe(CLOSE_NO_ROOM)
  })

  it('ведущий завершает игру — комната стирается, все получают итоговый стол', async () => {
    const { r, host, guest } = await twoPlayers()
    await send(r, guest, { type: 'finish' })
    expect(guest.last()).toEqual({ v: PROTOCOL_VERSION, type: 'error', error: 'Это может только ведущий' })

    await send(r, host, { type: 'finish' })
    for (const peer of [host, guest]) {
      expect(peer.last()).toMatchObject({ type: 'ended', reason: 'Ведущий завершил игру' })
      expect(peer.closed?.code).toBe(CLOSE_ENDED)
    }
    expect(r.storage.data.size).toBe(0)
    expect(r.storage.alarmAt).toBeNull()
    expect(r.released).toEqual(['ABCDEF'])
  })

  it('сутки без ходов — комната стирается; ход был — будильник переносится', async () => {
    const { r, host } = await twoPlayers()
    await send(r, host, { type: 'start' }, 1000)
    await alarm(r.env, IDLE_MS)
    expect(r.storage.alarmAt).toBe(1000 + IDLE_MS)
    expect(await stored(r)).toBeDefined()

    await alarm(r.env, 1000 + IDLE_MS)
    expect(await stored(r)).toBeUndefined()
    expect(host.last()).toMatchObject({ type: 'ended' })
    expect(r.released).toEqual(['ABCDEF'])
    // Повтор будильника — комнаты уже нет, ничего не ломается
    await alarm(r.env, 2 * IDLE_MS)
    expect(r.released).toEqual(['ABCDEF'])
  })

  it('убрать игрока, который ещё в раздаче, нельзя — стол не меняется', async () => {
    const { r, host, guestId } = await twoPlayers()
    await send(r, host, { type: 'start' })
    const before = await stored(r)
    await send(r, host, { type: 'remove', playerId: guestId })
    expect(host.last()).toEqual({ v: PROTOCOL_VERSION, type: 'error', error: 'Игрок в раздаче — уберите после неё' })
    expect(await stored(r)).toEqual(before)
  })

  it('убранный со стола по старому токену не возвращается на место', async () => {
    const { r, host, guestId, guestToken } = await twoPlayers()
    await send(r, host, { type: 'remove', playerId: guestId })
    expect((await stored(r))?.tokens[guestId]).toBeUndefined()
    const back = await connect(r)
    await send(r, back, { type: 'join', playerId: guestId, token: guestToken, name: 'Гость' })
    expect((back.sent[0] as { playerId: string }).playerId).not.toBe(guestId)
  })
})
