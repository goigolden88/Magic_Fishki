// Комната: один стол, его игроки и их соединения. Тонкая обёртка над правилами
// src/poker/: сама правил покера не держит. Памяти между сообщениями нет — объект
// засыпает, поэтому стол читается из хранилища на каждом сообщении и пишется после.
// Хранилище, соединения, часы и «освободить место в реестре» — снаружи (index.ts, тесты)
import {
  CLOSE_ENDED,
  CLOSE_NO_ROOM,
  CLOSE_REPLACED,
  CLOSE_SILENT,
  CLOSE_VERSION,
  FINISHED,
  NO_ROOM,
  PING,
  PONG,
  PROTOCOL_VERSION,
  SILENT_MS,
  VERSION_ERROR,
  type RosterEntry,
  type ServerMessage,
} from '../../src/poker/protocol'
import { createTable, handle, setOnline, type Settings, type TableState } from '../../src/poker/table'
import { canRejoin, issueToken } from '../../src/poker/tokens'

// Отказ «комнаты нет» и коды закрытия соединения — общие с экраном, в протоколе
export { CLOSE_ENDED, CLOSE_NO_ROOM, CLOSE_REPLACED, CLOSE_SILENT, CLOSE_VERSION, NO_ROOM, SILENT_MS }

// Комната без ходов дольше этого — стирается
export const IDLE_MS = 24 * 60 * 60 * 1000

// Пока за столом кто-то в сети — будильник раз в CHECK_MS ищет замолчавших. Худший случай
// от пропажи телефона до «вне сети»: PING_MS + SILENT_MS + CHECK_MS — меньше минуты (#64)
export const CHECK_MS = 20_000

export type RoomRecord = {
  code: string
  table: TableState
  tokens: Record<string, string> // игрок → токен возврата
  roster?: RosterEntry[] // постоянные, отмеченные ведущим; у комнат протокола 1 поля нет
  lastMoveAt: number
}

// Часть хранилища объекта, которая нужна комнате (DurableObjectStorage)
export type RoomStorage = {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  deleteAll(): Promise<void>
  getAlarm(): Promise<number | null>
  setAlarm(time: number): Promise<void>
  deleteAlarm(): Promise<void>
}

// Соединение. Отметка «кто это» переживает сон объекта (serializeAttachment)
export type Peer = {
  send(text: string): void
  close(code: number, reason: string): void
  playerId(): string | null
  setPlayerId(id: string, now: number): void
  lastSeen(): number // последний признак жизни: PING или вход
}

export type RoomEnv = {
  storage: RoomStorage
  peers: () => Peer[] // все открытые соединения комнаты
  release: (code: string) => Promise<void> // освободить место в реестре комнат
}

const KEY = 'room'

export async function initRoom(
  env: RoomEnv,
  code: string,
  name: unknown,
  settings: Partial<Settings>,
  now: number,
  roster: RosterEntry[] = [],
  regularId: string | null = null,
): Promise<{ ok: true; playerId: string; token: string } | { ok: false; error: string }> {
  if (await env.storage.get<RoomRecord>(KEY)) return { ok: false, error: 'Комната с таким кодом уже есть' }
  const playerId = newPlayerId()
  // Ведущий из постоянных — под именем из списка, как и остальные
  const regular = roster.find((r) => r.id === regularId)
  const hostName = regular ? regular.name : typeof name === 'string' ? name : ''
  const created = createTable(playerId, hostName, settings, now, regular ? regular.id : null)
  if (!created.ok) return created
  const token = issueToken()
  // Ведущий ещё не подключился — вне сети, пока не войдёт
  const table = setOnline(created.state, playerId, false, now)
  await env.storage.put<RoomRecord>(KEY, { code, table, tokens: { [playerId]: token }, roster, lastMoveAt: now })
  await env.storage.setAlarm(now + IDLE_MS)
  return { ok: true, playerId, token }
}

export async function isAlive(env: RoomEnv): Promise<boolean> {
  return (await env.storage.get<RoomRecord>(KEY)) !== undefined
}

// Новое соединение: комната есть — список, из кого выбрать себя; нет — сказать и закрыть
export async function open(env: RoomEnv, peer: Peer): Promise<void> {
  const room = await env.storage.get<RoomRecord>(KEY)
  if (room) return sendLobby(peer, room)
  send(peer, { type: 'error', error: NO_ROOM })
  peer.close(CLOSE_NO_ROOM, 'no room')
}

export async function message(env: RoomEnv, peer: Peer, raw: string, now: number): Promise<void> {
  // Признаку жизни отвечает платформа (index.ts); дошёл сюда — ответить самим, а не «обновите»
  if (raw === PING) {
    try {
      peer.send(PONG)
    } catch {
      // уже закрыто
    }
    return
  }
  const msg = parse(raw)
  if (!msg || msg.v !== PROTOCOL_VERSION) {
    send(peer, { type: 'error', error: VERSION_ERROR })
    peer.close(CLOSE_VERSION, 'update the app')
    return
  }
  const room = await env.storage.get<RoomRecord>(KEY)
  if (!room) {
    send(peer, { type: 'error', error: NO_ROOM })
    peer.close(CLOSE_NO_ROOM, 'no room')
    return
  }
  const me = peer.playerId()
  if (msg.type === 'join') {
    if (me) return send(peer, { type: 'error', error: 'Вы уже за столом' })
    return join(env, room, peer, msg, now)
  }
  if (!me) return send(peer, { type: 'error', error: 'Сначала войдите в комнату' })
  if (msg.type === 'finish') {
    if (me !== room.table.hostId) return send(peer, { type: 'error', error: 'Это может только ведущий' })
    return end(env, room, FINISHED)
  }
  if (msg.type === 'reseat') return reseat(env, room, peer, me, msg.playerId, now)
  const r = handle(room.table, me, msg, now)
  if (!r.ok) return send(peer, { type: 'error', error: r.error })
  room.table = r.state
  room.lastMoveAt = now
  // Убранный со стола не вернётся по токену: войдёт новым
  for (const id of Object.keys(room.tokens)) {
    if (!r.state.players.some((p) => p.id === id)) delete room.tokens[id]
  }
  await save(env, room)
}

// Соединение закрылось: у игрока не осталось других — он вне сети
export async function close(env: RoomEnv, peer: Peer, now: number): Promise<void> {
  const me = peer.playerId()
  if (!me) return
  if (env.peers().some((p) => p !== peer && p.playerId() === me)) return
  const room = await env.storage.get<RoomRecord>(KEY)
  if (!room) return
  room.table = setOnline(room.table, me, false, now)
  await save(env, room)
}

// Будильник: сутки без ходов — стереть; иначе найти пропавших молча и завести снова.
// Будильник может сработать повторно — тогда комнаты уже нет, и делать нечего
export async function alarm(env: RoomEnv, now: number): Promise<void> {
  const room = await env.storage.get<RoomRecord>(KEY)
  if (!room) return
  if (now - room.lastMoveAt >= IDLE_MS) return end(env, room, 'Сутки без ходов — комната закрыта')
  const online = () => room.table.players.filter((p) => p.online).length
  const before = online()
  // Телефон сел или пропала сеть — соединение не закрылось, но признаков жизни нет.
  // Вне сети — с последнего признака, а не с момента проверки
  for (const p of env.peers()) {
    const id = p.playerId()
    const seen = p.lastSeen()
    if (!id || now - seen <= SILENT_MS) continue
    p.close(CLOSE_SILENT, 'silent')
    if (!env.peers().some((q) => q.playerId() === id)) room.table = setOnline(room.table, id, false, seen)
  }
  // В сети по столу, а соединения нет (сервер перезапускался и закрытия не видел)
  for (const pl of room.table.players) {
    if (pl.online && !env.peers().some((q) => q.playerId() === pl.id)) room.table = setOnline(room.table, pl.id, false, now)
  }
  if (online() !== before) await save(env, room)
  await env.storage.setAlarm(nextAlarm(room, now))
}

// Кто-то в сети — проверка через CHECK_MS; никого — только сутки после последнего хода
function nextAlarm(room: RoomRecord, now: number): number {
  const idle = room.lastMoveAt + IDLE_MS
  return room.table.players.some((p) => p.online) ? Math.min(idle, now + CHECK_MS) : idle
}

async function join(
  env: RoomEnv,
  room: RoomRecord,
  peer: Peer,
  msg: Record<string, unknown>,
  now: number,
): Promise<void> {
  const playerId = typeof msg.playerId === 'string' ? msg.playerId : ''
  const token = typeof msg.token === 'string' ? msg.token : ''
  let id = playerId
  if (canRejoin(room.tokens, room.table, playerId, token).ok) {
    // Одно соединение на игрока: старое закрываем
    for (const p of env.peers()) {
      if (p !== peer && p.playerId() === id) p.close(CLOSE_REPLACED, 'joined elsewhere')
    }
    room.table = setOnline(room.table, id, true, now)
  } else {
    // Нет токена или он чужой — новым игроком, а не на чужое место.
    // Отказ — причина и свежий список: пока выбирал, место могли занять
    id = newPlayerId()
    const sit = sitMessage(room, msg)
    const r = 'error' in sit ? sit : handle(room.table, id, { v: PROTOCOL_VERSION, type: 'sit', ...sit }, now)
    if (!r.ok) {
      send(peer, { type: 'error', error: r.error })
      return sendLobby(peer, room)
    }
    room.table = r.state
    room.tokens[id] = issueToken()
  }
  room.lastMoveAt = now
  peer.setPlayerId(id, now)
  send(peer, { type: 'welcome', playerId: id, token: room.tokens[id] })
  await save(env, room)
  // Игрок в сети — проверки живости идут; ближе назначенный будильник не отодвигаем
  const at = await env.storage.getAlarm()
  const next = nextAlarm(room, now)
  if (at === null || at > next) await env.storage.setAlarm(next)
}

// Посадка: под постоянным — имя из списка комнаты; гостем — своё
function sitMessage(
  room: RoomRecord,
  msg: Record<string, unknown>,
): { name: unknown; regularId?: string } | { ok: false; error: string } {
  if (typeof msg.regularId !== 'string') return { name: msg.name }
  const regular = (room.roster ?? []).find((r) => r.id === msg.regularId)
  if (!regular) return { ok: false, error: 'Такого игрока нет в списке комнаты' }
  return { name: regular.name, regularId: regular.id }
}

// Пересадить: новый токен игрока — ведущему, для ссылки на другое устройство.
// Старый токен больше не пускает, соединения игрока закрываются
async function reseat(env: RoomEnv, room: RoomRecord, peer: Peer, me: string, playerId: unknown, now: number): Promise<void> {
  if (me !== room.table.hostId) return send(peer, { type: 'error', error: 'Это может только ведущий' })
  if (typeof playerId !== 'string' || !room.table.players.some((p) => p.id === playerId)) {
    return send(peer, { type: 'error', error: 'Такого игрока нет за столом' })
  }
  if (playerId === me) return send(peer, { type: 'error', error: 'Себя не пересадить — сначала передайте ведение' })
  const token = issueToken()
  room.tokens[playerId] = token
  for (const p of env.peers()) {
    if (p.playerId() === playerId) p.close(CLOSE_REPLACED, 'reseated')
  }
  room.table = setOnline(room.table, playerId, false, now)
  send(peer, { type: 'reseated', playerId, token })
  await save(env, room)
}

function sendLobby(peer: Peer, room: RoomRecord): void {
  const seated = room.table.players.flatMap((p) => (p.regularId ? [p.regularId] : []))
  send(peer, { type: 'lobby', roster: room.roster ?? [], seated })
}

async function end(env: RoomEnv, room: RoomRecord, reason: string): Promise<void> {
  await env.storage.deleteAlarm()
  await env.storage.deleteAll()
  for (const p of env.peers()) {
    send(p, { type: 'ended', table: room.table, reason })
    p.close(CLOSE_ENDED, 'room ended')
  }
  await env.release(room.code)
}

// Сохранить и разослать стол всем, кто вошёл
async function save(env: RoomEnv, room: RoomRecord): Promise<void> {
  await env.storage.put<RoomRecord>(KEY, room)
  for (const p of env.peers()) {
    if (p.playerId()) send(p, { type: 'state', table: room.table })
  }
}

type Body = ServerMessage extends infer M ? (M extends { v: number } ? Omit<M, 'v'> : never) : never

function send(peer: Peer, body: Body): void {
  try {
    peer.send(JSON.stringify({ v: PROTOCOL_VERSION, ...body }))
  } catch {
    // Соединение уже закрыто — игрок получит стол, когда вернётся
  }
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const x: unknown = JSON.parse(raw)
    return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function newPlayerId(): string {
  return issueToken().slice(0, 12)
}
