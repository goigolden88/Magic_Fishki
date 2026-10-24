// Стол кэш-игры: места, ведущий, раздачи, докупы, правки стека, уход, журнал фишек.
// handle — чистая функция: сообщение игрока → новое состояние или отказ с причиной
// (тогда состояние не меняется). Состояние — обычный JSON: сервер сохраняет его между
// сообщениями и поднимает снова. Время — параметром now (мс), не из часов
import { act, awardPots, startHand, type Hand } from './hand'
import { PROTOCOL_VERSION, VERSION_ERROR, type BetAction, type ClientBody } from './protocol'

export type Settings = {
  sb: number
  bb: number
  startingStack: number // закуп при посадке
  maxSeats: number
  rebuyMaxBB: number | null // докуп за раз — не больше стольких больших блайндов; 0 — без докупов, null — без предела
}

export const DEFAULT_SETTINGS: Settings = { sb: 5, bb: 10, startingStack: 1000, maxSeats: 9, rebuyMaxBB: null }

// Ведущий вне сети дольше этого — остальные могут взять ведение
export const HOST_TAKEOVER_MS = 60_000

export type TablePlayer = {
  id: string
  name: string
  seat: number // номер места, 0…maxSeats−1
  chips: number // стек между раздачами
  buyIn: number // закуплено всего: закуп и докупы
  sittingOut: boolean // пропускает раздачи
  online: boolean
  offlineSince: number | null
}

export type ChipLogEntry =
  | { kind: 'buyin'; playerId: string; amount: number; at: number }
  | { kind: 'rebuy'; playerId: string; by: string; from: number; to: number; at: number }
  | { kind: 'rebuyDeclined'; playerId: string; by: string; amount: number; at: number }
  | { kind: 'set'; playerId: string; by: string; from: number; to: number; at: number }
  | { kind: 'leave'; playerId: string; by: string; chips: number; at: number } // ушёл со стола с остатком

export type HandResult = {
  number: number
  pots: { amount: number; winners: string[] }[]
  payouts: Record<string, number>
}

export type TableState = {
  hostId: string
  settings: Settings
  players: TablePlayer[]
  buttonSeat: number | null // место кнопки в прошлой раздаче
  handCount: number
  hand: Hand | null // null — между раздачами
  lastHand: HandResult | null
  rebuyRequests: { playerId: string; amount: number }[] // ждут ответа ведущего
  approvedRebuys: { playerId: string; amount: number; by: string }[] // «да» во время раздачи — в стек после неё
  chipLog: ChipLogEntry[]
}

export type Result = { ok: true; state: TableState } | { ok: false; error: string }

export function createTable(hostId: string, hostName: string, settings: Partial<Settings>, now: number): Result {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  const error = settingsError(s)
  if (error) return { ok: false, error }
  const state: TableState = {
    hostId,
    settings: s,
    players: [],
    buttonSeat: null,
    handCount: 0,
    hand: null,
    lastHand: null,
    rebuyRequests: [],
    approvedRebuys: [],
    chipLog: [],
  }
  const sitError = sit(state, hostId, hostName, now)
  return sitError ? { ok: false, error: sitError } : { ok: true, state }
}

export function handle(state: TableState, from: string, message: unknown, now: number): Result {
  if (!isRecord(message) || message.v !== PROTOCOL_VERSION) return { ok: false, error: VERSION_ERROR }
  const next = structuredClone(state)
  const error = apply(next, from, message as ClientBody, now)
  return error ? { ok: false, error } : { ok: true, state: next }
}

// Соединение игрока открылось или закрылось (зовёт сервер)
export function setOnline(state: TableState, playerId: string, online: boolean, now: number): TableState {
  const next = structuredClone(state)
  const p = next.players.find((x) => x.id === playerId)
  if (!p || p.online === online) return next
  p.online = online
  p.offlineSince = online ? null : now
  return next
}

function apply(state: TableState, from: string, msg: ClientBody, now: number): string | null {
  if (msg.type === 'sit') return sit(state, from, msg.name, now)
  const me = state.players.find((p) => p.id === from)
  if (!me) return 'Вас нет за столом'
  const isHost = from === state.hostId
  const hostOnly = 'Это может только ведущий'
  switch (msg.type) {
    case 'start':
      return isHost ? start(state) : hostOnly
    case 'act':
      if (!state.hand) return 'Раздачи сейчас нет'
      if (!isAction(msg.action)) return 'Неизвестный ход — обновите приложение'
      return act(state.hand, from, msg.action)
    case 'skip':
      return isHost ? skip(state) : hostOnly
    case 'award':
      return isHost ? award(state, msg.winners, now) : hostOnly
    case 'rebuy':
      return requestRebuy(state, me, msg.amount)
    case 'rebuyAnswer':
      return isHost ? answerRebuy(state, from, msg.playerId, msg.approve, now) : hostOnly
    case 'setStack':
      return isHost ? setStack(state, from, msg.playerId, msg.chips, now) : hostOnly
    case 'sitOut': {
      const id = msg.playerId ?? from
      if (id !== from && !isHost) return hostOnly
      const p = state.players.find((x) => x.id === id)
      if (!p) return 'Такого игрока нет за столом'
      p.sittingOut = msg.sittingOut === true
      return null
    }
    case 'remove':
      return isHost ? remove(state, from, msg.playerId, now) : hostOnly
    case 'passHost': {
      if (!isHost) return hostOnly
      if (msg.to === from) return 'Вы уже ведущий'
      if (!state.players.some((p) => p.id === msg.to)) return 'Такого игрока нет за столом'
      state.hostId = msg.to
      return null
    }
    case 'takeHost':
      return takeHost(state, from, now)
    default:
      return 'Неизвестное сообщение — обновите приложение'
  }
}

function sit(state: TableState, id: string, name: unknown, now: number): string | null {
  if (state.players.some((p) => p.id === id)) return 'Вы уже за столом'
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return 'Нужно имя'
  const taken = new Set(state.players.map((p) => p.seat))
  let seat = 0
  while (seat < state.settings.maxSeats && taken.has(seat)) seat++
  if (seat >= state.settings.maxSeats) return 'Стол заполнен'
  const chips = state.settings.startingStack
  state.players.push({ id, name: trimmed, seat, chips, buyIn: chips, sittingOut: false, online: true, offlineSince: null })
  state.chipLog.push({ kind: 'buyin', playerId: id, amount: chips, at: now })
  return null
}

function start(state: TableState): string | null {
  if (state.hand) return 'Раздача ещё идёт'
  const playing = state.players.filter((p) => p.chips > 0 && !p.sittingOut).sort((a, b) => a.seat - b.seat)
  if (playing.length < 2) return 'Нужно хотя бы двое с фишками'
  // Кнопка — следующее играющее место по кругу после прошлой
  const prev = state.buttonSeat
  const after = prev === null ? -1 : playing.findIndex((p) => p.seat > prev)
  const button = after === -1 ? 0 : after
  state.buttonSeat = playing[button].seat
  state.handCount++
  const { sb, bb } = state.settings
  state.hand = startHand(state.handCount, playing, button, sb, bb)
  return null
}

function skip(state: TableState): string | null {
  const hand = state.hand
  if (!hand || hand.toAct === -1) return 'Нет хода, который можно пропустить'
  const seat = hand.seats[hand.toAct]
  return act(hand, seat.id, { type: seat.bet < hand.currentBet ? 'fold' : 'check' })
}

function award(state: TableState, winners: unknown, now: number): string | null {
  const hand = state.hand
  if (!hand) return 'Раздачи сейчас нет'
  if (!Array.isArray(winners) || !winners.every((w) => Array.isArray(w) && w.every((id) => typeof id === 'string'))) {
    return 'Неизвестное сообщение — обновите приложение'
  }
  const payouts = awardPots(hand, winners as string[][])
  if (typeof payouts === 'string') return payouts
  for (const seat of hand.seats) {
    const p = state.players.find((x) => x.id === seat.id)
    if (p) p.chips = seat.chips
  }
  state.lastHand = {
    number: hand.number,
    pots: hand.pots.map((pot, k) => ({ amount: pot.amount, winners: winners[k] as string[] })),
    payouts,
  }
  state.hand = null
  // Докупы, одобренные во время раздачи, — в стек сейчас, между раздачами
  for (const r of state.approvedRebuys) addRebuy(state, r.playerId, r.amount, r.by, now)
  state.approvedRebuys = []
  return null
}

function requestRebuy(state: TableState, me: TablePlayer, amount: unknown): string | null {
  if (!isPositiveInt(amount)) return 'Докуп — целое число фишек больше нуля'
  const { rebuyMaxBB, bb } = state.settings
  if (rebuyMaxBB === 0) return 'Докупы за этим столом выключены'
  if (rebuyMaxBB !== null && amount > rebuyMaxBB * bb) return `Докуп — не больше ${rebuyMaxBB * bb}`
  if (state.rebuyRequests.some((r) => r.playerId === me.id)) return 'Запрос уже отправлен — ждёт ведущего'
  state.rebuyRequests.push({ playerId: me.id, amount })
  return null
}

function answerRebuy(state: TableState, by: string, playerId: string, approve: unknown, now: number): string | null {
  const index = state.rebuyRequests.findIndex((r) => r.playerId === playerId)
  if (index === -1) return 'Такого запроса нет'
  const [req] = state.rebuyRequests.splice(index, 1)
  if (approve !== true) {
    state.chipLog.push({ kind: 'rebuyDeclined', playerId, by, amount: req.amount, at: now })
    return null
  }
  const p = state.players.find((x) => x.id === playerId)
  if (!p) return null
  p.buyIn += req.amount
  if (state.hand) state.approvedRebuys.push({ playerId, amount: req.amount, by })
  else addRebuy(state, playerId, req.amount, by, now)
  return null
}

function addRebuy(state: TableState, playerId: string, amount: number, by: string, now: number): void {
  const p = state.players.find((x) => x.id === playerId)
  if (!p) return
  state.chipLog.push({ kind: 'rebuy', playerId, by, from: p.chips, to: p.chips + amount, at: now })
  p.chips += amount
}

function setStack(state: TableState, by: string, playerId: string, chips: unknown, now: number): string | null {
  if (state.hand) return 'Стек правится между раздачами'
  const p = state.players.find((x) => x.id === playerId)
  if (!p) return 'Такого игрока нет за столом'
  if (typeof chips !== 'number' || !Number.isInteger(chips) || chips < 0) return 'Стек — целое число фишек, не меньше нуля'
  state.chipLog.push({ kind: 'set', playerId, by, from: p.chips, to: chips, at: now })
  p.chips = chips
  return null
}

// Игрок уходит со стола с остатком фишек: запись об уходе — в журнал, чтобы итог вечера сошёлся
function remove(state: TableState, by: string, playerId: string, now: number): string | null {
  if (playerId === state.hostId) return 'Ведущего не убрать — сначала передайте ведение'
  const p = state.players.find((x) => x.id === playerId)
  if (!p) return 'Такого игрока нет за столом'
  const seat = state.hand?.seats.find((s) => s.id === playerId)
  if (seat && !seat.folded) return 'Игрок в раздаче — уберите после неё'
  // Сбросил в этой раздаче — остаток то, что не поставил; докуп, одобренный в раздаче, — тоже его
  let chips = seat ? seat.chips : p.chips
  for (const r of state.approvedRebuys.filter((x) => x.playerId === playerId)) {
    state.chipLog.push({ kind: 'rebuy', playerId, by: r.by, from: chips, to: chips + r.amount, at: now })
    chips += r.amount
  }
  state.chipLog.push({ kind: 'leave', playerId, by, chips, at: now })
  state.players = state.players.filter((x) => x.id !== playerId)
  state.rebuyRequests = state.rebuyRequests.filter((r) => r.playerId !== playerId)
  state.approvedRebuys = state.approvedRebuys.filter((r) => r.playerId !== playerId)
  return null
}

function takeHost(state: TableState, from: string, now: number): string | null {
  if (from === state.hostId) return 'Вы уже ведущий'
  const host = state.players.find((p) => p.id === state.hostId)
  if (host?.online) return 'Ведущий в сети — ведение не взять'
  if (host && now - (host.offlineSince ?? now) <= HOST_TAKEOVER_MS) return 'Ведущий вне сети меньше минуты — подождите'
  state.hostId = from
  return null
}

function settingsError(s: Settings): string | null {
  if (!isPositiveInt(s.sb) || !isPositiveInt(s.bb) || s.sb > s.bb) return 'Блайнды — целые числа, малый не больше большого'
  if (!isPositiveInt(s.startingStack)) return 'Закуп — целое число фишек больше нуля'
  if (!Number.isInteger(s.maxSeats) || s.maxSeats < 2 || s.maxSeats > 10) return 'Мест за столом — от 2 до 10'
  if (s.rebuyMaxBB !== null && (!Number.isInteger(s.rebuyMaxBB) || s.rebuyMaxBB < 0)) return 'Предел докупа — целое число, не меньше нуля'
  return null
}

function isAction(a: unknown): a is BetAction {
  if (!isRecord(a)) return false
  if (a.type === 'raise') return typeof a.to === 'number'
  return a.type === 'fold' || a.type === 'check' || a.type === 'call' || a.type === 'allin'
}

function isPositiveInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x > 0
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
