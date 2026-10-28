import { describe, expect, it } from 'vitest'
import { PING_MS, PROTOCOL_VERSION, VERSION_ERROR } from '../../src/poker/protocol'
import { AUTO_START_MS, HOST_TAKEOVER_MS, type Settings, type TableState } from '../../src/poker/table'
import {
  alarm,
  CHECK_MS,
  close,
  CLOSE_ENDED,
  CLOSE_NO_ROOM,
  CLOSE_REPLACED,
  CLOSE_SILENT,
  CLOSE_VERSION,
  IDLE_MS,
  initRoom,
  message,
  NO_ROOM,
  open,
  SILENT_MS,
  type RoomRecord,
} from './room'
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

// Присланное после списка входа (его комната шлёт сразу при подключении)
const afterLobby = (peer: FakePeer) => peer.sent.filter((m) => m.type !== 'lobby')

// Комната с ведущим «Ведущий» (вошёл по токену) и игроком «Гость»
async function twoPlayers(settings: Partial<Settings> = {}) {
  const r = fakeRoom()
  const created = await initRoom(r.env, 'ABCDEF', 'Ведущий', settings, 0)
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
    expect(afterLobby(back)[0]).toEqual({ v: PROTOCOL_VERSION, type: 'welcome', playerId: guestId, token: guestToken })
    const me = tableOf(back).players.find((p) => p.id === guestId)
    expect(me).toMatchObject({ seat: 1, chips: 1234, online: true })
    expect(tableOf(back).players.length).toBe(2)
  })

  it('чужой токен — вход новым игроком, а не на чужое место', async () => {
    const { r, hostId } = await twoPlayers()
    const thief = await connect(r)
    await send(r, thief, { type: 'join', playerId: hostId, token: 'не тот', name: 'Чужой' })
    const welcome = afterLobby(thief)[0] as { type: string; playerId: string }
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
    expect(afterLobby(peer)).toEqual([{ v: PROTOCOL_VERSION, type: 'error', error: 'Нужно имя' }])
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
    expect(afterLobby(old)).toEqual([{ v: PROTOCOL_VERSION, type: 'error', error: VERSION_ERROR }])
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
    const { r, host, guest } = await twoPlayers()
    await send(r, host, { type: 'start' }, 1000)
    // Оба на связи всё это время — признаки жизни шли
    host.ping(IDLE_MS)
    guest.ping(IDLE_MS)
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
    expect((afterLobby(back)[0] as { playerId: string }).playerId).not.toBe(guestId)
  })
})

// Комната с картами на телефонах: ведущий и двое гостей
async function cardsRoom(settings: Partial<Settings> = {}) {
  const r = fakeRoom()
  const created = await initRoom(r.env, 'ABCDEF', 'Ведущий', { cards: 'phones', ...settings }, 0)
  if (!created.ok) throw new Error(created.error)
  const host = await connect(r)
  await send(r, host, { type: 'join', playerId: created.playerId, token: created.token })
  const guests: { peer: FakePeer; id: string; token: string }[] = []
  for (const name of ['Гость', 'Третий']) {
    const peer = await connect(r)
    await send(r, peer, { type: 'join', name })
    const w = peer.sent.find((m) => m.type === 'welcome') as { playerId: string; token: string }
    guests.push({ peer, id: w.playerId, token: w.token })
  }
  return { r, host, hostId: created.playerId, guests }
}

// Карты, которых этот игрок видеть не должен: колода и чужие закрытые — по столу в хранилище
function secretsFor(room: RoomRecord | undefined, me: string): string[] {
  const cards = room?.table.hand?.cards
  if (!cards) return []
  const others = Object.entries(cards.hole).filter(([id]) => id !== me).flatMap(([, c]) => c)
  return [...cards.deck, ...others].filter((c): c is string => c !== null)
}

const leaked = (peer: FakePeer, secrets: string[]) => {
  const text = JSON.stringify(peer.sent)
  return secrets.filter((c) => text.includes(`"${c}"`))
}

describe('карты на телефонах', () => {
  it('каждому телефону — свои карты; чужих закрытых и колоды в присланном нет', async () => {
    const { r, host, hostId, guests } = await cardsRoom()
    await send(r, host, { type: 'start' })
    const room = await stored(r)
    expect(room?.table.hand?.cards?.deck).toHaveLength(52 - 6)
    for (const { peer, id } of [{ peer: host, id: hostId }, ...guests]) {
      expect(leaked(peer, secretsFor(room, id))).toEqual([])
      const mine = tableOf(peer).hand?.cards?.hole[id]
      expect(mine).toEqual(room?.table.hand?.cards?.hole[id])
      expect(mine?.every((c) => typeof c === 'string')).toBe(true)
      expect(tableOf(peer).hand?.cards?.deck).toEqual([])
    }
  })

  it('омаха (#80): каждому четыре карты, чужих нет; раздача — с пот-лимитом', async () => {
    const { r, host, hostId, guests } = await cardsRoom({ game: 'omaha' })
    await send(r, host, { type: 'start' })
    const room = await stored(r)
    expect(room?.table.hand?.cards?.game.id).toBe('omaha')
    expect(room?.table.hand?.limit).toBe('pot')
    expect(room?.table.hand?.cards?.deck).toHaveLength(52 - 12)
    for (const { peer, id } of [{ peer: host, id: hostId }, ...guests]) {
      expect(leaked(peer, secretsFor(room, id))).toEqual([])
      expect(tableOf(peer).hand?.cards?.hole[id]).toHaveLength(4)
    }
  })

  it('колода — новая каждую раздачу, тасует комната', async () => {
    const { r, host } = await cardsRoom()
    await send(r, host, { type: 'start' })
    const first = (await stored(r))?.table.hand?.cards?.hole
    await send(r, host, { type: 'finish' })
    const again = await cardsRoom()
    await send(again.r, again.host, { type: 'start' })
    // 6 карт из 52 — совпасть случайно почти невозможно
    expect((await stored(again.r))?.table.hand?.cards?.hole).not.toEqual(first)
  })

  it('вышел посреди раздачи и вернулся по токену — его карты на месте', async () => {
    const { r, host, guests } = await cardsRoom()
    await send(r, host, { type: 'start' })
    const [g] = guests
    const mine = (await stored(r))?.table.hand?.cards?.hole[g.id]
    g.peer.close(1006, '')
    await close(r.env, g.peer, 5)
    const back = await connect(r)
    await send(r, back, { type: 'join', playerId: g.id, token: g.token })
    expect(tableOf(back).hand?.cards?.hole[g.id]).toEqual(mine)
    expect(leaked(back, secretsFor(await stored(r), g.id))).toEqual([])
  })

  it('«Пересадить» на новое устройство — карты там же', async () => {
    const { r, host, guests } = await cardsRoom()
    await send(r, host, { type: 'start' })
    const [g] = guests
    await send(r, host, { type: 'reseat', playerId: g.id })
    const reseated = host.sent.find((m) => m.type === 'reseated') as { token: string }
    const phone = await connect(r)
    await send(r, phone, { type: 'join', playerId: g.id, token: reseated.token })
    expect(tableOf(phone).hand?.cards?.hole[g.id]).toEqual((await stored(r))?.table.hand?.cards?.hole[g.id])
  })

  it('сон между сообщениями: раздача с картами доигрывается из хранилища, банк — сам', async () => {
    const { r, host, guests } = await cardsRoom()
    await send(r, host, { type: 'start' })
    // На троих первой ходит кнопка — ведущий
    for (const peer of [host, guests[0].peer]) {
      r.storage.data.set('room', JSON.stringify(await stored(r))) // как после пробуждения
      await send(r, peer, { type: 'act', action: { type: 'allin' } })
    }
    r.storage.data.set('room', JSON.stringify(await stored(r)))
    await send(r, guests[1].peer, { type: 'act', action: { type: 'fold' } })
    const room = await stored(r)
    expect(room?.table.hand).toBeNull()
    expect(room?.table.lastHand?.record?.board).toHaveLength(5)
    expect(Object.keys(room?.table.lastHand?.record?.shown ?? {})).toHaveLength(2)
    expect(room?.table.players.reduce((sum, p) => sum + p.chips, 0)).toBe(3000)
    expect(tableOf(guests[1].peer).lastHand?.record?.board).toEqual(room?.table.lastHand?.record?.board)
  })

  it('конец комнаты посреди раздачи — в итоговом столе тоже только свои карты', async () => {
    const { r, host, hostId, guests } = await cardsRoom()
    await send(r, host, { type: 'start' })
    const room = await stored(r)
    await send(r, host, { type: 'finish' })
    const ended = guests[0].peer.last() as { type: string; table: TableState }
    expect(ended.type).toBe('ended')
    expect(ended.table.hand?.cards?.hole[hostId]).toEqual([null, null])
    expect(leaked(guests[0].peer, secretsFor(room, guests[0].id))).toEqual([])
  })

  it('комната без настройки карт — живые, как раньше: колоды у раздачи нет', async () => {
    const { r, host } = await twoPlayers()
    await send(r, host, { type: 'start' })
    expect((await stored(r))?.table.hand?.cards).toBeUndefined()
  })
})

const ROSTER = [
  { id: 'r-anna', name: 'Анна' },
  { id: 'r-boris', name: 'Борис' },
  { id: 'r-vera', name: 'Вера' },
]

// Комната с отмеченными постоянными; ведущий — Анна
async function withRoster() {
  const r = fakeRoom()
  const created = await initRoom(r.env, 'ABCDEF', 'кто угодно', {}, 0, ROSTER, 'r-anna')
  if (!created.ok) throw new Error(created.error)
  const host = await connect(r)
  await send(r, host, { type: 'join', playerId: created.playerId, token: created.token })
  return { r, host, hostId: created.playerId }
}

describe('вход по списку постоянных', () => {
  it('при подключении — список отмеченных и кто из них уже за столом', async () => {
    const { r, host } = await withRoster()
    expect(tableOf(host).players).toMatchObject([{ name: 'Анна', regularId: 'r-anna' }])
    const peer = await connect(r)
    expect(peer.sent).toEqual([{ v: PROTOCOL_VERSION, type: 'lobby', roster: ROSTER, seated: ['r-anna'] }])
    expect((await stored(r))?.roster).toEqual(ROSTER)
  })

  it('выбрал себя — садится под именем из списка, связь с постоянным на месте', async () => {
    const { r, host } = await withRoster()
    const boris = await connect(r)
    await send(r, boris, { type: 'join', regularId: 'r-boris', name: 'Боря' })
    expect(afterLobby(boris)[0]).toMatchObject({ type: 'welcome' })
    expect(tableOf(host).players.map((p) => [p.name, p.regularId])).toEqual([
      ['Анна', 'r-anna'],
      ['Борис', 'r-boris'],
    ])
    // Гость — своё имя, без связи
    const guest = await connect(r)
    await send(r, guest, { type: 'join', name: 'Гость Гена' })
    expect(tableOf(host).players.at(-1)).toMatchObject({ name: 'Гость Гена', regularId: null })
    expect((await connect(r)).sent[0]).toMatchObject({ type: 'lobby', seated: ['r-anna', 'r-boris'] })
  })

  it('место уже занято или игрока нет в списке — отказ и свежий список', async () => {
    const { r } = await withRoster()
    const first = await connect(r)
    await send(r, first, { type: 'join', regularId: 'r-vera' })
    const second = await connect(r)
    await send(r, second, { type: 'join', regularId: 'r-vera' })
    expect(second.sent.slice(1)).toEqual([
      { v: PROTOCOL_VERSION, type: 'error', error: 'Этот игрок уже за столом' },
      { v: PROTOCOL_VERSION, type: 'lobby', roster: ROSTER, seated: ['r-anna', 'r-vera'] },
    ])
    expect(second.playerId()).toBeNull()
    const stranger = await connect(r)
    await send(r, stranger, { type: 'join', regularId: 'r-нет', name: 'Чужой' })
    expect(afterLobby(stranger)).toEqual([{ v: PROTOCOL_VERSION, type: 'error', error: 'Такого игрока нет в списке комнаты' }])
  })
})

describe('пересадить на другое устройство', () => {
  it('ведущий получает новый токен игрока; старое устройство отключено и по старому токену не войдёт', async () => {
    const { r, host, guest, guestId, guestToken } = await twoPlayers()
    await send(r, host, { type: 'reseat', playerId: guestId }, 7)
    const reseated = host.sent.find((m) => m.type === 'reseated') as { playerId: string; token: string }
    expect(reseated.playerId).toBe(guestId)
    expect(reseated.token).not.toBe(guestToken)
    expect(guest.closed?.code).toBe(CLOSE_REPLACED)
    expect(tableOf(host).players.find((p) => p.id === guestId)).toMatchObject({ online: false, offlineSince: 7 })

    const old = await connect(r)
    await send(r, old, { type: 'join', playerId: guestId, token: guestToken })
    expect(afterLobby(old)[0]).toEqual({ v: PROTOCOL_VERSION, type: 'error', error: 'Нужно имя' })

    const phone = await connect(r)
    await send(r, phone, { type: 'join', playerId: guestId, token: reseated.token })
    expect(afterLobby(phone)[0]).toEqual({ v: PROTOCOL_VERSION, type: 'welcome', playerId: guestId, token: reseated.token })
    expect(tableOf(phone).players.find((p) => p.id === guestId)).toMatchObject({ seat: 1, online: true })
  })

  it('только ведущий, только сидящего и не себя', async () => {
    const { r, host, guest, hostId, guestId } = await twoPlayers()
    await send(r, guest, { type: 'reseat', playerId: hostId })
    expect(guest.last()).toEqual({ v: PROTOCOL_VERSION, type: 'error', error: 'Это может только ведущий' })
    await send(r, host, { type: 'reseat', playerId: 'никто' })
    expect(host.last()).toEqual({ v: PROTOCOL_VERSION, type: 'error', error: 'Такого игрока нет за столом' })
    await send(r, host, { type: 'reseat', playerId: hostId })
    expect(host.last()).toMatchObject({ type: 'error' })
    expect(guest.closed).toBeNull()
    expect((await stored(r))?.tokens[guestId]).toBeDefined()
  })
})

// Вечер по часам, шаг — секунда: кто жив, подаёт признак жизни (beats), будильник срабатывает,
// когда назначен. Идёт до `until` или конца; возвращает момент, когда `until` стало верным
async function run(
  r: ReturnType<typeof fakeRoom>,
  peers: FakePeer[],
  beats: (peer: FakePeer, t: number) => boolean,
  from: number,
  to: number,
  until: (t: number) => boolean = () => false,
): Promise<number | null> {
  for (let t = from; t <= to; t += 1000) {
    for (const p of peers) if (!p.closed && beats(p, t)) p.ping(t)
    if (r.storage.alarmAt !== null && r.storage.alarmAt <= t) await alarm(r.env, t)
    if (until(t)) return t
  }
  return null
}

const everyPing = (_: FakePeer, t: number) => t % PING_MS === 0
const playerOf = (peer: FakePeer, id: string) => tableOf(peer).players.find((p) => p.id === id)

describe('кто вне сети и с какого момента', () => {
  it('вход заводит проверки живости; никого в сети — будильник снова на сутки', async () => {
    const { r, host, guest } = await twoPlayers()
    expect(r.storage.alarmAt).toBe(CHECK_MS)
    host.close(1006, '')
    await close(r.env, host, 1000)
    guest.close(1006, '')
    await close(r.env, guest, 1000)
    await alarm(r.env, CHECK_MS)
    expect(r.storage.alarmAt).toBe(IDLE_MS)
  })

  it('телефон ведущего пропал молча — вне сети меньше чем через минуту, «Взять ведение» — меньше чем через две', async () => {
    // Пропал в разные моменты между признаками жизни и проверками
    for (const gone of [1000, 7000, 14_000, 15_000, 29_000, 41_000]) {
      const { r, host, guest, hostId, guestId } = await twoPlayers()
      const beats = (p: FakePeer, t: number) => everyPing(p, t) && (p !== host || t < gone)
      const off = await run(r, [host, guest], beats, 0, gone + 120_000, () => playerOf(guest, hostId)?.online === false)
      expect(off).not.toBeNull()
      expect(off! - gone).toBeLessThanOrEqual(60_000)
      expect(host.closed?.code).toBe(CLOSE_SILENT)
      // Вне сети — с последнего признака жизни
      const since = playerOf(guest, hostId)!.offlineSince!
      expect(since).toBeLessThanOrEqual(gone)
      expect(since).toBeGreaterThan(gone - PING_MS - 1000)

      await send(r, guest, { type: 'takeHost' }, since + HOST_TAKEOVER_MS)
      expect(guest.last()).toEqual({ v: PROTOCOL_VERSION, type: 'error', error: 'Ведущий вне сети меньше минуты — подождите' })
      const take = since + HOST_TAKEOVER_MS + 1
      expect(take - gone).toBeLessThanOrEqual(120_000)
      await send(r, guest, { type: 'takeHost' }, take)
      expect(tableOf(guest).hostId).toBe(guestId)
    }
  })

  it('пропал обычный игрок — вне сети меньше чем через минуту, ведущий пропускает его ход', async () => {
    const { r, host, guest, guestId } = await twoPlayers()
    await send(r, host, { type: 'start' })
    await send(r, host, { type: 'act', action: { type: 'call' } })
    const gone = 5000
    const beats = (p: FakePeer, t: number) => everyPing(p, t) && (p !== guest || t < gone)
    const off = await run(r, [host, guest], beats, 0, 120_000, () => playerOf(host, guestId)?.online === false)
    expect(off! - gone).toBeLessThanOrEqual(60_000)
    const hand = tableOf(host).hand
    await send(r, host, { type: 'skip' })
    expect(host.last()).toMatchObject({ type: 'state' })
    expect(tableOf(host).hand).not.toEqual(hand)
  })

  it('вернулся — снова в сети на своём месте; ведение назад само не переходит', async () => {
    const { r, host, guest, hostId, hostToken, guestId } = await twoPlayers()
    const beats = (p: FakePeer, t: number) => everyPing(p, t) && p !== host
    await run(r, [host, guest], beats, 0, 60_000)
    expect(playerOf(guest, hostId)?.online).toBe(false)
    await send(r, guest, { type: 'takeHost' }, 200_000)
    expect(tableOf(guest).hostId).toBe(guestId)

    const back = await connect(r)
    await send(r, back, { type: 'join', playerId: hostId, token: hostToken }, 210_000)
    expect(playerOf(guest, hostId)).toMatchObject({ seat: 0, online: true, offlineSince: null })
    expect(tableOf(back).hostId).toBe(guestId)
    // Живёт дальше — проверки его не трогают
    const later = await run(r, [back, guest], everyPing, 210_000, 400_000, () => playerOf(guest, hostId)?.online === false)
    expect(later).toBeNull()
  })

  it('экран погас на 20 секунд — «вне сети» не появляется', async () => {
    const { r, host, guest, guestId } = await twoPlayers()
    // Экран тёмный с 16-й по 36-ю секунду: признаков нет; включился — признак сразу
    const beats = (p: FakePeer, t: number) => (p !== guest ? everyPing(p, t) : t === 36_000 || (everyPing(p, t) && (t < 16_000 || t > 36_000)))
    const off = await run(r, [host, guest], beats, 0, 200_000, () => playerOf(host, guestId)?.online === false)
    expect(off).toBeNull()
    expect(guest.closed).toBeNull()
  })

  it('экран погас дольше — вне сети, а после включения снова в сети', async () => {
    const { r, host, guest, guestId, guestToken } = await twoPlayers()
    const beats = (p: FakePeer, t: number) => everyPing(p, t) && (p !== guest || t < 16_000)
    await run(r, [host, guest], beats, 0, 70_000)
    expect(playerOf(host, guestId)?.online).toBe(false)
    // Проснулся: соединение закрыто сервером — экран открывает новое с тем же местом
    const back = await connect(r)
    await send(r, back, { type: 'join', playerId: guestId, token: guestToken }, 75_000)
    expect(playerOf(host, guestId)?.online).toBe(true)
  })

  it('закрытие соединения после проверки — «вне сети с» не сдвигается', async () => {
    const { r, host, guest, hostId } = await twoPlayers()
    host.ping(15_000)
    guest.ping(50_000)
    await alarm(r.env, 50_000)
    expect(playerOf(guest, hostId)).toMatchObject({ online: false, offlineSince: 15_000 })
    await close(r.env, host, 90_000)
    expect(playerOf(guest, hostId)?.offlineSince).toBe(15_000)
  })

  it('двое жмут «Взять ведение» почти разом — ведение у одного, второму понятный отказ', async () => {
    const { r, host, guest, hostId, guestId } = await twoPlayers()
    const third = await connect(r)
    await send(r, third, { type: 'join', name: 'Третий' })
    const beats = (p: FakePeer, t: number) => everyPing(p, t) && p !== host
    await run(r, [host, guest, third], beats, 0, 60_000)
    expect(playerOf(guest, hostId)?.online).toBe(false)
    await send(r, guest, { type: 'takeHost' }, 100_000)
    await send(r, third, { type: 'takeHost' }, 100_001)
    expect(tableOf(third).hostId).toBe(guestId)
    expect(third.last()).toEqual({ v: PROTOCOL_VERSION, type: 'error', error: 'Ведущий в сети — ведение не взять' })
  })

  it('сервер перезапустился: закрытий не видел — проверка ставит «вне сети», переподключились — снова в сети', async () => {
    const { r, host, guest, hostId, hostToken, guestId, guestToken } = await twoPlayers()
    // Перезапуск: соединения оборваны, а закрытия комната не получила
    host.close(1006, '')
    guest.close(1006, '')
    await alarm(r.env, CHECK_MS)
    const room = await stored(r)
    expect(room?.table.players.map((p) => p.online)).toEqual([false, false])
    expect(r.storage.alarmAt).toBe(IDLE_MS)

    const h = await connect(r)
    await send(r, h, { type: 'join', playerId: hostId, token: hostToken }, 30_000)
    const g = await connect(r)
    await send(r, g, { type: 'join', playerId: guestId, token: guestToken }, 31_000)
    expect(tableOf(g).players.map((p) => p.online)).toEqual([true, true])
    expect(r.storage.alarmAt).toBe(30_000 + CHECK_MS)
    const off = await run(r, [h, g], everyPing, 31_000, 200_000, () => tableOf(g).players.some((p) => !p.online))
    expect(off).toBeNull()
  })

  it('молчание измеряется порогом SILENT_MS: тишина ровно на пороге — ещё в сети', async () => {
    const { r, guest, hostId, host } = await twoPlayers()
    host.ping(10_000)
    guest.ping(10_000 + SILENT_MS)
    await alarm(r.env, 10_000 + SILENT_MS)
    expect(playerOf(guest, hostId)?.online).toBe(true)
    await alarm(r.env, 10_001 + SILENT_MS)
    expect(playerOf(guest, hostId)?.online).toBe(false)
  })
})

const T = 30_000 // время на ход в тестах — 30 с
const foldBody = { type: 'act', action: { type: 'fold' } }

describe('время на ход и раздача «сама» — будильником комнаты', () => {
  it('ведущий вне сети — его ход истекает сам; у телефонов — стол и время сервера', async () => {
    const { r, host, guest, hostId } = await twoPlayers({ turnSeconds: 30 })
    await send(r, host, { type: 'start' }, 1000)
    expect(guest.last()).toMatchObject({ type: 'state', now: 1000 })
    expect(tableOf(guest).turn).toEqual({ hand: 1, move: 0, deadline: 1000 + T })
    host.close(1006, '')
    await close(r.env, host, 2000)
    guest.ping(CHECK_MS)
    await alarm(r.env, CHECK_MS)
    // Ближайшее — срок хода, раньше следующей проверки живости
    expect(r.storage.alarmAt).toBe(1000 + T)
    guest.ping(1000 + T)
    await alarm(r.env, 1000 + T)
    expect(tableOf(guest).hand?.log).toMatchObject([{ playerId: hostId, type: 'fold', timeout: true }])
    expect(guest.last()).toMatchObject({ type: 'state', now: 1000 + T })
    // Ход по таймеру — не ход людей: сутки без ходов считаются от старта
    expect((await stored(r))?.lastMoveAt).toBe(1000)
  })

  it('будильник сработал дважды — второй раз ничего не делает', async () => {
    const { r, host, guest } = await twoPlayers({ turnSeconds: 30 })
    await send(r, host, { type: 'start' }, 1000)
    await send(r, host, { type: 'act', action: { type: 'call' } }, 2000)
    for (const p of [host, guest]) p.ping(2000 + T)
    await alarm(r.env, 2000 + T)
    expect(tableOf(guest).hand?.stage).toBe('flop') // гость — чек по времени
    const before = await stored(r)
    const sent = guest.sent.length
    await alarm(r.env, 2000 + T)
    expect(guest.sent.length).toBe(sent)
    expect(await stored(r)).toEqual(before)
    // Сработал раньше срока — тоже ничего
    await alarm(r.env, 2000 + T + 1)
    expect(guest.sent.length).toBe(sent)
  })

  it('никого в сети — будильник прямо на срок хода', async () => {
    const { r, host, guest } = await twoPlayers({ turnSeconds: 30 })
    await send(r, host, { type: 'start' }, 1000)
    for (const p of [host, guest]) {
      p.close(1006, '')
      await close(r.env, p, 2000)
    }
    await alarm(r.env, CHECK_MS)
    expect(r.storage.alarmAt).toBe(1000 + T)
  })

  it('карты на телефонах: раздача «сама» сдаёт карты, каждому — только свои', async () => {
    const { r, host, hostId, guests } = await cardsRoom({ autoStart: 'fast' })
    await send(r, host, { type: 'start' }, 1000)
    // На троих первой ходит кнопка — ведущий; двое сбросили — банк третьему без вскрытия
    await send(r, host, foldBody, 2000)
    await send(r, guests[0].peer, foldBody, 3000)
    expect((await stored(r))?.table.nextHandAt).toBe(3000 + AUTO_START_MS.fast)
    expect(r.storage.alarmAt).toBe(3000 + AUTO_START_MS.fast)
    const everyone = [{ peer: host, id: hostId }, ...guests]
    const sentBefore = everyone.map(({ peer }) => peer.sent.length)
    await alarm(r.env, 3000 + AUTO_START_MS.fast)
    const room = await stored(r)
    expect(room?.table.hand?.number).toBe(2)
    expect(room?.table.hand?.cards?.deck).toHaveLength(52 - 6)
    everyone.forEach(({ peer, id }, i) => {
      expect(tableOf(peer).hand?.cards?.hole[id]?.every((c) => typeof c === 'string')).toBe(true)
      // Карты прошлой раздачи вернулись в колоду (свои в её записи взявший видит) — смотрим новую раздачу
      const text = JSON.stringify(peer.sent.slice(sentBefore[i]).map((m) => (m.table as TableState | undefined)?.hand))
      expect(secretsFor(room, id).filter((c) => text.includes(`"${c}"`))).toEqual([])
    })
  })

  it('брошенная комната: все ушли — раздачи идут, пока не пропускают, и через сутки комната стирается', async () => {
    const { r, host, guests } = await cardsRoom({ turnSeconds: 10, autoStart: 'fast' })
    await send(r, host, { type: 'start' }, 1000)
    for (const p of [host, ...guests.map((g) => g.peer)]) {
      p.close(1006, '')
      await close(r.env, p, 2000)
    }
    let last = 0
    for (let n = 0; n < 200 && r.storage.alarmAt !== null; n++) {
      last = r.storage.alarmAt
      await alarm(r.env, last)
    }
    expect(r.released).toEqual(['ABCDEF'])
    expect(last).toBe(1000 + IDLE_MS)
  })
})
