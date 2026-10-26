// Итог стола покера онлайн → обычная игра в историю (Р-14, Р-20). Пишет телефон ведущего:
// закуп при посадке — «Закуп», одобренный докуп — «Докуп», стек в конце или при уходе — «Выход».
// Правка стека записей не даёт — если фишки не сошлись, игра показывает расхождение, как ручная
import type { Entry, Game, Player } from '../model'
import type { TableState } from '../poker/table'
import { buyIns, prizeAmounts, prizePool, standings } from '../poker/tournament'
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

// Курс турнира: бай-ин и призы — в рублях, в игру они пишутся фишками по рублю
export const TOURNAMENT_RATE = 1

// Итог турнира (#78, Р-28) → обычная игра той же моделью: каждый бай-ин — «Закуп» (вход — при
// «Начать турнир») или «Докуп» (ребай), приз — «Выход»; у каждого итог = приз − все его бай-ины.
// Призы делят весь фонд — игра в ноль. Пишет телефон ведущего, когда турнир окончен
export function gameFromTournament(table: TableState, input: Omit<TableGameInput, 'rate'>, makeId: () => string): Game {
  const id = makeId()
  const t = table.settings.tournament
  const clock = table.tournament
  const info = new Map<string, { name: string; regularId: string | null }>()
  for (const e of table.chipLog) {
    if (e.kind === 'leave') info.set(e.playerId, { name: e.name ?? LEFT_NAME, regularId: e.regularId ?? null })
  }
  for (const p of table.players) info.set(p.id, { name: p.name, regularId: p.regularId })

  // Участники — кто играл с начала, по местам за столом
  const byTableId = new Map<string, Player>()
  const players: Player[] = (clock?.entrants ?? []).map((tableId) => {
    const { name, regularId } = info.get(tableId) ?? { name: LEFT_NAME, regularId: null }
    const player: Player = regularId ? { id: makeId(), name, regularId } : { id: makeId(), name }
    byTableId.set(tableId, player)
    return player
  })

  const entries: Entry[] = []
  function add(tableId: string, kind: Entry['kind'], chips: number, at: string) {
    const player = byTableId.get(tableId)
    if (player && chips > 0) entries.push({ id: makeId(), playerId: player.id, kind, chips, at })
  }
  if (t && clock) {
    const startedAt = new Date(clock.startedAt).toISOString()
    for (const tableId of clock.entrants) add(tableId, 'buyin', t.buyIn, startedAt)
    for (const e of table.chipLog) if (e.kind === 'rebuy') add(e.playerId, 'rebuy', t.buyIn, new Date(e.at).toISOString())
    const prizes = prizeAmounts(prizePool(table, t), clock.prizes)
    standings(table).forEach((s, i) => add(s.playerId, 'cashout', prizes[i] ?? 0, input.now))
  }

  const closed = balance(playerTotals(players, entries, TOURNAMENT_RATE)).ok
  return {
    id,
    name: input.name,
    date: input.date,
    rate: TOURNAMENT_RATE,
    players,
    entries,
    ...(closed ? { closed } : {}),
    updatedAt: input.now,
  }
}

// Итог турнира на экране: место, имя, бай-инов, приз и итог в рублях (приз − бай-ины)
export function tournamentResults(table: TableState): { place: number; name: string; buyIns: number; prize: number; net: number }[] {
  const t = table.settings.tournament
  const clock = table.tournament
  if (!t || !clock) return []
  const names = new Map<string, string>()
  for (const e of table.chipLog) if (e.kind === 'leave') names.set(e.playerId, e.name ?? LEFT_NAME)
  for (const p of table.players) names.set(p.id, p.name)
  const prizes = prizeAmounts(prizePool(table, t), clock.prizes)
  return standings(table).map((s, i) => {
    const n = buyIns(table, s.playerId)
    const prize = prizes[i] ?? 0
    return { place: s.place, name: names.get(s.playerId) ?? LEFT_NAME, buyIns: n, prize, net: prize - n * t.buyIn }
  })
}
