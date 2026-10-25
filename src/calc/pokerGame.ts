// Итог стола покера онлайн → обычная игра в историю (Р-14, Р-20). Пишет телефон ведущего:
// закуп при посадке — «Закуп», одобренный докуп — «Докуп», стек в конце или при уходе — «Выход».
// Правка стека записей не даёт — если фишки не сошлись, игра показывает расхождение, как ручная
import type { Entry, Game, Player } from '../model'
import type { TableState } from '../poker/table'
import { balance, playerTotals } from './totals'

export type TableGameInput = {
  name: string
  date: string // YYYY-MM-DD
  rate: number // курс из настроек ведущего (Р-02)
  now: string // ISO 8601: время выходов тех, кто за столом, и updatedAt
}

// Ушедший до #60 — в журнале без имени
export const LEFT_NAME = 'Ушёл со стола'

export function gameFromTable(table: TableState, input: TableGameInput, makeId: () => string): Game {
  const id = makeId()
  // Кто это за столом: сидящие — из стола, ушедшие — из записи ухода
  const info = new Map<string, { name: string; regularId: string | null }>()
  for (const e of table.chipLog) {
    if (e.kind === 'leave') info.set(e.playerId, { name: e.name ?? LEFT_NAME, regularId: e.regularId ?? null })
  }
  for (const p of table.players) info.set(p.id, { name: p.name, regularId: p.regularId })

  // Участник игры — по порядку посадки; постоянный, севший снова, — тот же участник
  const players: Player[] = []
  const byTableId = new Map<string, Player>()
  const byRegular = new Map<string, Player>()
  function playerOf(tableId: string): Player {
    const known = byTableId.get(tableId)
    if (known) return known
    const { name, regularId } = info.get(tableId) ?? { name: LEFT_NAME, regularId: null }
    let player = regularId ? byRegular.get(regularId) : undefined
    if (!player) {
      player = regularId ? { id: makeId(), name, regularId } : { id: makeId(), name }
      players.push(player)
      if (regularId) byRegular.set(regularId, player)
    }
    byTableId.set(tableId, player)
    return player
  }

  const entries: Entry[] = []
  function add(tableId: string, kind: Entry['kind'], chips: number, at: string) {
    const player = playerOf(tableId)
    if (chips > 0) entries.push({ id: makeId(), playerId: player.id, kind, chips, at })
  }

  // Раздача не доиграна — она отменяется: у сидящих стек до неё (players[].chips),
  // ушедшим из неё возвращается поставленное
  const hand = table.hand
  const inHand = new Map((hand?.seats ?? []).map((s) => [s.id, s.committed]))
  const seated = new Set(table.players.map((p) => p.id))

  for (const e of table.chipLog) {
    const at = new Date(e.at).toISOString()
    if (e.kind === 'buyin') add(e.playerId, 'buyin', e.amount, at)
    else if (e.kind === 'rebuy') add(e.playerId, 'rebuy', e.to - e.from, at)
    else if (e.kind === 'leave') {
      const refund = seated.has(e.playerId) ? 0 : (inHand.get(e.playerId) ?? 0)
      add(e.playerId, 'cashout', e.chips + refund, at)
    }
  }
  // Докуп, одобренный во время раздачи, ещё не в стеке — он тоже игрока
  for (const r of table.approvedRebuys) add(r.playerId, 'rebuy', r.amount, input.now)
  for (const p of [...table.players].sort((a, b) => a.seat - b.seat)) {
    const pending = table.approvedRebuys.filter((r) => r.playerId === p.id).reduce((sum, r) => sum + r.amount, 0)
    add(p.id, 'cashout', p.chips + pending, input.now)
  }

  // Сошлось — игра закрыта и сразу в статистике; не сошлось — открыта, чтобы поправить
  const closed = balance(playerTotals(players, entries, input.rate)).ok
  return {
    id,
    name: input.name,
    date: input.date,
    rate: input.rate,
    players,
    entries,
    ...(closed ? { closed } : {}),
    updatedAt: input.now,
  }
}
