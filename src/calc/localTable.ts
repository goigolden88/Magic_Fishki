// Стол на одном телефоне (Р-21): правила src/poker/ работают прямо в приложении, ведущий —
// сам телефон и ходит за каждого. Сервера нет: экран держит стол и зовёт handle, как сервер
// комнат, а от чьего имени слать сообщение — решается здесь. Время — параметром now
import { PROTOCOL_VERSION, type BetAction, type ClientBody } from '../poker/protocol'
import { createTable, handle, type Result, type Settings, type TableState } from '../poker/table'
import { actionsView, tableView, type TableView } from './pokerView'

// Мест у стола — предел правил (settingsError): за столом все, кого отметили, и место новым
export const LOCAL_MAX_SEATS = 10

export type LocalTable = {
  id: string // свой id стола: по нему итог пишется игрой один раз
  table: TableState
  gameId: string | null // итог уже записан этой игрой — вторую не писать
}

export type LocalPlayer = { name: string; regularId: string | null }

export type LocalStart = { ok: true; local: LocalTable } | { ok: false; error: string }

// «Начать» — когда за столом от двух до LOCAL_MAX_SEATS
export function localStartError(count: number): string | null {
  if (count < 2) return 'Нужно хотя бы двое'
  if (count > LOCAL_MAX_SEATS) return `За столом — не больше ${LOCAL_MAX_SEATS}`
  return null
}

// Новый стол: игроки садятся по порядку, ведущим по правилам — первый (его ведение — сам телефон)
export function startLocalTable(
  players: LocalPlayer[],
  settings: Pick<Settings, 'sb' | 'bb' | 'startingStack'>,
  now: number,
  makeId: () => string,
): LocalStart {
  const error = localStartError(players.length)
  if (error) return { ok: false, error }
  const ids = players.map(() => makeId())
  let r = createTable(ids[0], players[0].name, { ...settings, maxSeats: LOCAL_MAX_SEATS }, now, players[0].regularId)
  for (let i = 1; r.ok && i < players.length; i++) r = seatPlayer(r.state, ids[i], players[i], now)
  return r.ok ? { ok: true, local: { id: makeId(), table: r.state, gameId: null } } : r
}

function send(table: TableState, from: string, body: ClientBody, now: number): Result {
  return handle(table, from, { v: PROTOCOL_VERSION, ...body }, now)
}

// Чей ход: id игрока; торги закрыты или раздачи нет — null
export function toActId(table: TableState): string | null {
  const hand = table.hand
  return hand && hand.stage !== 'showdown' && hand.toAct !== -1 ? hand.seats[hand.toAct].id : null
}

// Ход за того, чья очередь
export function actFor(table: TableState, action: BetAction, now: number): Result {
  const id = toActId(table)
  return id ? send(table, id, { type: 'act', action }, now) : { ok: false, error: 'Сейчас ничей ход' }
}

// Команда ведущего: раздача, банки, стек, пропуск раздач
export function hostDo(table: TableState, body: ClientBody, now: number): Result {
  return send(table, table.hostId, body, now)
}

// Докуп сразу, без запроса: просьба от игрока и «да» ведущего; во время раздачи — в стек после неё
export function rebuyNow(table: TableState, playerId: string, amount: number, now: number): Result {
  const asked = send(table, playerId, { type: 'rebuy', amount }, now)
  if (!asked.ok) return asked
  return hostDo(asked.state, { type: 'rebuyAnswer', playerId, approve: true }, now)
}

// Докуп, одобренный во время раздачи: ляжет в стек после неё
export function pendingRebuy(table: TableState, playerId: string): number {
  return table.approvedRebuys.filter((r) => r.playerId === playerId).reduce((sum, r) => sum + r.amount, 0)
}

// Посадить нового игрока; id — новый
export function seatPlayer(table: TableState, id: string, player: LocalPlayer, now: number): Result {
  return send(table, id, { type: 'sit', name: player.name, ...(player.regularId ? { regularId: player.regularId } : {}) }, now)
}

// Убрать со стола. Ведущего по правилам не убрать — сначала ведение следующему по месту;
// не вышло убрать — стол как был
export function removePlayer(table: TableState, playerId: string, now: number): Result {
  let state = table
  if (playerId === table.hostId) {
    const next = [...table.players].sort((a, b) => a.seat - b.seat).find((p) => p.id !== playerId)
    if (!next) return { ok: false, error: 'Последнего игрока не убрать — закончите игру или удалите стол' }
    const passed = hostDo(table, { type: 'passHost', to: next.id }, now)
    if (!passed.ok) return passed
    state = passed.state
  }
  return hostDo(state, { type: 'remove', playerId }, now)
}

// Вид стола для телефона ведущего: кнопки ведущего всегда, кнопки хода — того, чей ход;
// «меня» за столом нет — места по порядку, без «вы»
export function localTableView(table: TableState, now: number): TableView {
  const v = tableView(table, table.hostId, now)
  const id = toActId(table)
  return {
    ...v,
    seats: v.seats.map((s) => ({ ...s, isMe: false })),
    me: null,
    actions: id ? actionsView(table, id) : null,
    canTakeHost: false,
    myRebuy: null,
  }
}

// Стол из памяти устройства; не похоже на стол — null
export function parseLocalTable(text: string): LocalTable | null {
  let x: unknown
  try {
    x = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(x) || typeof x.id !== 'string' || !isTable(x.table)) return null
  const gameId = typeof x.gameId === 'string' ? x.gameId : null
  return { id: x.id, table: x.table, gameId }
}

function isTable(t: unknown): t is TableState {
  return (
    isRecord(t) &&
    typeof t.hostId === 'string' &&
    isRecord(t.settings) &&
    Array.isArray(t.players) &&
    typeof t.handCount === 'number' &&
    Array.isArray(t.rebuyRequests) &&
    Array.isArray(t.approvedRebuys) &&
    Array.isArray(t.chipLog)
  )
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
