// Экран стола: что показать каждому по состоянию стола. Правил не держит — только читает
// стол (src/poker/) и решает, какие кнопки показать и с какими суммами; отказ всё равно
// скажет сервер. Время — параметром now, как у стола
import type { Stage } from '../poker/hand'
import { buildPots } from '../poker/pots'
import { HOST_TAKEOVER_MS, type TableState } from '../poker/table'

export type SeatView = {
  id: string
  name: string
  chips: number // стек сейчас: в раздаче — без поставленного
  bet: number // ставка на этой улице
  isMe: boolean
  isHost: boolean
  button: boolean
  position: string | null // подпись позиции в раздаче: «BTN», «SB», «BB», «UTG» … «CO»; не сдан — null
  toAct: boolean
  inHand: boolean // сдан в этой раздаче
  folded: boolean
  allIn: boolean
  online: boolean
  sittingOut: boolean
}

export type PotView = { label: string; amount: number; eligible: { id: string; name: string }[] }

export type RaiseView = {
  label: 'Ставка' | 'Рейз'
  min: number // до какой ставки улицы — не меньше
  max: number // и не больше (это уже олл-ин)
  quick: { label: string; to: number }[]
}

// Кнопки хода. Не мой ход — те же кнопки, но неактивны (myTurn)
export type ActionsView = {
  myTurn: boolean
  check: boolean // можно чек; иначе — колл
  call: number // сколько доставить на колл (0 — колла нет)
  raise: RaiseView | null // нельзя (не хватает на минимум или торги не открыты) — null
  allIn: number | null // олл-ин до этой ставки; null — нельзя
}

export type TableView = {
  seats: SeatView[]
  me: SeatView | null
  isHost: boolean
  hostName: string
  stage: Stage | null // null — между раздачами
  stageLabel: string
  handNumber: number
  pot: number // всё в банке, со ставками этой улицы
  pots: PotView[] // основной и побочные; во время торгов — только когда кто-то олл-ин
  toActName: string | null
  actions: ActionsView | null // null — я не в раздаче
  canStart: boolean // ведущему: можно начать раздачу
  canTakeHost: boolean // ведущий вне сети дольше минуты — можно взять ведение
  rebuyRequests: { playerId: string; name: string; amount: number }[]
  myRebuy: number | null // мой запрос на докуп ждёт ведущего
}

const STAGE_LABELS: Record<Stage, string> = {
  preflop: 'Префлоп',
  flop: 'Флоп',
  turn: 'Тёрн',
  river: 'Ривер',
  showdown: 'Торги закрыты',
}

export function tableView(table: TableState, meId: string, now: number): TableView {
  const hand = table.hand
  const names = new Map(table.players.map((p) => [p.id, p.name]))
  const nameOf = (id: string) => names.get(id) ?? 'Ушёл'
  const host = table.players.find((p) => p.id === table.hostId)
  const positions = hand ? positionLabels(hand.seats.length) : []

  const seats: SeatView[] = [...table.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const index = hand ? hand.seats.findIndex((s) => s.id === p.id) : -1
      const s = hand && index !== -1 ? hand.seats[index] : null
      return {
        id: p.id,
        name: p.name,
        chips: s ? s.chips : p.chips,
        bet: s ? s.bet : 0,
        isMe: p.id === meId,
        isHost: p.id === table.hostId,
        button: hand ? index === hand.button : table.buttonSeat === p.seat,
        position: hand && index !== -1 ? positions[(index - hand.button + positions.length) % positions.length] : null,
        toAct: hand !== null && index !== -1 && index === hand.toAct,
        inHand: s !== null,
        folded: s?.folded ?? false,
        allIn: s?.allIn ?? false,
        online: p.online,
        sittingOut: p.sittingOut,
      }
    })
  const me = seats.find((s) => s.isMe) ?? null
  const isHost = meId === table.hostId

  return {
    seats,
    me,
    isHost,
    hostName: host?.name ?? '',
    stage: hand?.stage ?? null,
    stageLabel: hand ? STAGE_LABELS[hand.stage] : 'Между раздачами',
    handNumber: hand?.number ?? table.handCount,
    pot: hand ? hand.seats.reduce((sum, s) => sum + s.committed, 0) : 0,
    pots: hand ? potsView(table, nameOf) : [],
    toActName: hand && hand.toAct !== -1 ? nameOf(hand.seats[hand.toAct].id) : null,
    actions: actionsView(table, meId),
    canStart:
      isHost && !hand && table.players.filter((p) => p.chips > 0 && !p.sittingOut).length >= 2,
    canTakeHost:
      !isHost && host !== undefined && !host.online && now - (host.offlineSince ?? now) > HOST_TAKEOVER_MS,
    rebuyRequests: table.rebuyRequests.map((r) => ({ ...r, name: nameOf(r.playerId) })),
    myRebuy: table.rebuyRequests.find((r) => r.playerId === meId)?.amount ?? null,
  }
}

// Подписи позиций по числу сданных, от кнопки по ходу: «BTN», «SB», «BB», затем «UTG», а поздние —
// с конца: «CO» перед кнопкой, перед ним «HJ», «LJ», «MP». Блайнды — как при сдаче (hand.ts):
// хедз-ап — кнопка ставит малый
export function positionLabels(n: number): string[] {
  if (n < 2) return n === 1 ? ['BTN'] : []
  if (n === 2) return ['BTN/SB', 'BB']
  const late = ['CO', 'HJ', 'LJ', 'MP', 'UTG+1', 'UTG+2', 'UTG+3'].slice(0, Math.max(0, n - 4)).reverse()
  return ['BTN', 'SB', 'BB', ...(n > 3 ? ['UTG'] : []), ...late]
}

// После торгов — банки раздачи как есть. Во время торгов побочные видны, только когда
// кто-то олл-ин; верхний слой одного игрока — ставка, которую ещё не уравняли, не банк
function potsView(table: TableState, nameOf: (id: string) => string): PotView[] {
  const hand = table.hand
  if (!hand) return []
  let pots = hand.pots
  if (hand.stage !== 'showdown') {
    if (!hand.seats.some((s) => s.allIn && !s.folded)) return []
    pots = buildPots(hand.seats)
    if (pots.length > 1 && pots[pots.length - 1].eligible.length === 1) pots = pots.slice(0, -1)
    if (pots.length < 2) return []
  }
  return pots.map((pot, k) => ({
    label: pots.length === 1 ? 'Банк' : k === 0 ? 'Основной банк' : pots.length === 2 ? 'Побочный банк' : `Побочный банк ${k}`,
    amount: pot.amount,
    eligible: pot.eligible.map((id) => ({ id, name: nameOf(id) })),
  }))
}

function actionsView(table: TableState, meId: string): ActionsView | null {
  const hand = table.hand
  if (!hand || hand.stage === 'showdown') return null
  const index = hand.seats.findIndex((s) => s.id === meId)
  if (index === -1) return null
  const seat = hand.seats[index]
  if (seat.folded || seat.allIn) return null
  const toCall = Math.max(0, hand.currentBet - seat.bet)
  const max = seat.bet + seat.chips
  // Неполный олл-ин не открывает торги тому, кто уже ходил (hand.ts, raise)
  const reopened = !(seat.acted && seat.actedAt >= hand.fullBet)
  const min = hand.currentBet + hand.minRaise
  const canRaise = reopened && max >= min
  const pot = hand.seats.reduce((sum, s) => sum + s.committed, 0)
  return {
    myTurn: index === hand.toAct,
    check: toCall === 0,
    call: Math.min(toCall, seat.chips),
    raise: canRaise
      ? {
          label: hand.currentBet === 0 ? 'Ставка' : 'Рейз',
          min,
          max,
          quick: quickRaises(hand.currentBet, toCall, pot, min, max),
        }
      : null,
    allIn: max <= hand.currentBet || reopened ? max : null,
  }
}

// Быстрые суммы: минимум, полбанка и банк (банк — после уравнивания), в пределах min…max
function quickRaises(currentBet: number, toCall: number, pot: number, min: number, max: number) {
  const afterCall = pot + toCall
  const options = [
    { label: 'Мин', to: min },
    { label: '½ банка', to: currentBet + Math.floor(afterCall / 2) },
    { label: 'Банк', to: currentBet + afterCall },
  ]
  const out: { label: string; to: number }[] = []
  for (const o of options) {
    const to = Math.min(max, Math.max(min, o.to))
    if (to < max && !out.some((x) => x.to === to)) out.push({ label: o.label, to })
  }
  return out
}

// Победители по умолчанию: у банка один претендент — он и отмечен
export function defaultWinners(table: TableState): string[][] {
  return (table.hand?.pots ?? []).map((pot) => (pot.eligible.length === 1 ? [...pot.eligible] : []))
}

// «Раздать банки» — когда у каждого банка отмечен хоть один победитель
export function winnersReady(table: TableState, winners: string[][]): boolean {
  const pots = table.hand?.pots ?? []
  return pots.length > 0 && pots.length === winners.length && winners.every((w) => w.length > 0)
}

// Отметка победителя: нажал — отмечен, нажал ещё — снят
export function toggleWinner(winners: string[][], pot: number, id: string): string[][] {
  return winners.map((w, k) => (k !== pot ? w : w.includes(id) ? w.filter((x) => x !== id) : [...w, id]))
}

// Итог прошлой раздачи: кто сколько забрал из банков
export function lastHandWins(table: TableState): { name: string; amount: number }[] {
  const last = table.lastHand
  if (!last) return []
  const names = new Map(table.players.map((p) => [p.id, p.name]))
  return Object.entries(last.payouts)
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ name: names.get(id) ?? 'Ушёл', amount }))
}

// Конец игры: стек, закуп и разница у каждого, кто остался за столом
export function finalStacks(table: TableState): { name: string; chips: number; buyIn: number; diff: number }[] {
  return [...table.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({ name: p.name, chips: p.chips, buyIn: p.buyIn, diff: p.chips - p.buyIn }))
}
