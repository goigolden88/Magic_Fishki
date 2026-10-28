// Одна раздача кэш-игры: блайнды, очередь хода, ставки (без лимита или пот-лимит, #80), улицы, банки.
// Карты живые — силу руки движок не знает: после торгов раздача ждёт, пока ведущий
// отметит победителя каждого банка (awardPots). Карты на телефонах (cards) — сдаются
// по описанию игры перед каждым кругом торгов; банки после торгов раздаёт table.ts.
// Функции меняют переданную раздачу; копию состояния делает table.ts (handle)
import type { Card } from './cards'
import { dealRound, newCards, type GameDef, type HandCards, type Limit } from './game'
import type { BetAction } from './protocol'
import { buildPots, splitPot, type Pot } from './pots'

export type Street = 'preflop' | 'flop' | 'turn' | 'river'
export type Stage = Street | 'showdown' // showdown — торги закрыты, ждём ведущего

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']

export type HandSeat = {
  id: string
  chips: number // стек в раздаче
  bet: number // вложено на этой улице
  committed: number // вложено за раздачу
  folded: boolean
  allIn: boolean
  acted: boolean // ходил на этой улице
  actedAt: number // ставка стола после его последнего хода
}

// timeout — ход сделан за игрока: время на ход вышло (#75, ставит table.ts).
// 'ante' — анте в начале раздачи (#78): bet — сколько поставил в банк, ставкой круга оно не считается
export type HandLogEntry = {
  street: Street
  playerId: string
  type: BetAction['type'] | 'ante'
  bet: number
  allIn: boolean
  timeout?: true
}

export type Hand = {
  number: number
  stage: Stage
  seats: HandSeat[] // по местам за столом
  button: number // индекс в seats
  sb: number
  bb: number
  ante?: number // анте с каждого (#78); у раздач до него поля нет — без анте
  toAct: number // индекс в seats; −1 — торги закрыты
  currentBet: number // ставка стола на этой улице
  minRaise: number // размер последнего полного повышения
  fullBet: number // ставка стола после последней полной ставки или повышения: выше неё — торги открыты снова
  pots: Pot[] // после торгов — банки на раздачу ведущим
  returned: { playerId: string; amount: number } | null // непокрытая ставка, вернувшаяся игроку
  log: HandLogEntry[]
  cards?: HandCards // карты на телефонах; нет — живые карты (и у раздач до этапа 2)
  limit?: Limit // предел ставки (#80); у раздач до него поля нет — без лимита
}

export type StartSeat = { id: string; chips: number }

// seats — играющие в порядке мест, button — индекс кнопки в них; deal — карты на телефонах:
// описание игры и перемешанная колода; ante — анте с каждого до блайндов (0 — нет); limit — предел ставки
export function startHand(
  number: number,
  seats: StartSeat[],
  button: number,
  sb: number,
  bb: number,
  deal?: { game: GameDef; deck: Card[] },
  ante = 0,
  limit: Limit = 'nolimit',
): Hand {
  const hand: Hand = {
    number,
    stage: 'preflop',
    seats: seats.map((s) => ({
      id: s.id,
      chips: s.chips,
      bet: 0,
      committed: 0,
      folded: false,
      allIn: false,
      acted: false,
      actedAt: 0,
    })),
    button,
    sb,
    bb,
    toAct: -1,
    currentBet: bb,
    minRaise: bb,
    fullBet: bb,
    pots: [],
    returned: null,
    log: [],
  }
  if (limit !== 'nolimit') hand.limit = limit
  if (ante > 0) {
    hand.ante = ante
    // Анте — только в банк: вложено за раздачу, но не ставка круга (иначе засчитается в колл
    // большого блайнда). Не хватает — олл-ин на остаток, как с блайндами
    for (const s of hand.seats) {
      const amount = Math.min(ante, s.chips)
      s.chips -= amount
      s.committed += amount
      if (s.chips === 0) s.allIn = true
      hand.log.push({ street: 'preflop', playerId: s.id, type: 'ante', bet: amount, allIn: s.allIn })
    }
  }
  if (deal) {
    hand.cards = newCards(deal.game, deal.deck, seats.map((s) => s.id))
    dealRound(hand.cards, dealOrder(hand))
  }
  const n = seats.length
  // Хедз-ап: кнопка ставит малый блайнд и ходит первой до флопа
  const sbIndex = n === 2 ? button : (button + 1) % n
  const bbIndex = (sbIndex + 1) % n
  put(hand.seats[sbIndex], Math.min(sb, hand.seats[sbIndex].chips))
  put(hand.seats[bbIndex], Math.min(bb, hand.seats[bbIndex].chips))
  proceed(hand, (bbIndex + 1) % n)
  return hand
}

// Ход игрока. Ошибка — строка с причиной (раздача тогда не тронута), иначе null
export function act(hand: Hand, playerId: string, action: BetAction): string | null {
  if (hand.stage === 'showdown') return 'Торги закрыты — ведущий отмечает победителя'
  const index = hand.seats.findIndex((s) => s.id === playerId)
  if (index === -1) return 'Вы не играете в этой раздаче'
  if (index !== hand.toAct) return 'Сейчас не ваш ход'
  const seat = hand.seats[index]
  const toCall = hand.currentBet - seat.bet
  switch (action.type) {
    case 'fold':
      seat.folded = true
      break
    case 'check':
      if (toCall > 0) return `Нельзя чек: нужно уравнять ${toCall}`
      break
    case 'call':
      if (toCall <= 0) return 'Уравнивать нечего — можно чек'
      put(seat, Math.min(toCall, seat.chips))
      break
    case 'raise': {
      const error = raise(hand, seat, action.to)
      if (error) return error
      break
    }
    case 'allin': {
      const to = seat.bet + seat.chips
      if (to <= hand.currentBet) put(seat, seat.chips) // олл-ин в пределах уравнивания
      else {
        const error = raise(hand, seat, to)
        if (error) return error
      }
      break
    }
    default:
      return 'Неизвестный ход — обновите приложение'
  }
  seat.acted = true
  seat.actedAt = hand.currentBet
  hand.log.push({ street: hand.stage, playerId, type: action.type, bet: seat.bet, allIn: seat.allIn })
  proceed(hand, (index + 1) % hand.seats.length)
  return null
}

// Победители каждого банка — от ведущего. Делит банки, нечётная фишка — первому по кругу
// от кнопки. Ошибка — строка, иначе выплаты по игрокам (уже в стеках раздачи)
export function awardPots(hand: Hand, winners: string[][]): string | Record<string, number> {
  if (hand.stage !== 'showdown') return 'Торги ещё идут'
  if (winners.length !== hand.pots.length) return `Нужен победитель каждого банка: банков ${hand.pots.length}`
  const payouts: Record<string, number> = {}
  for (let k = 0; k < hand.pots.length; k++) {
    const pot = hand.pots[k]
    const ids = winners[k]
    if (ids.length === 0) return `Банк ${k + 1}: отметьте победителя`
    if (new Set(ids).size !== ids.length) return `Банк ${k + 1}: игрок отмечен дважды`
    if (ids.some((id) => !pot.eligible.includes(id))) return `Банк ${k + 1}: отмечен игрок, который за него не борется`
    for (const [id, amount] of Object.entries(splitPot(pot.amount, fromButton(hand, ids)))) {
      payouts[id] = (payouts[id] ?? 0) + amount
    }
  }
  for (const seat of hand.seats) seat.chips += payouts[seat.id] ?? 0
  return payouts
}

function put(seat: HandSeat, amount: number): void {
  seat.chips -= amount
  seat.bet += amount
  seat.committed += amount
  if (seat.chips === 0) seat.allIn = true
}

function raise(hand: Hand, seat: HandSeat, to: number): string | null {
  if (!Number.isInteger(to)) return 'Ставка — целое число фишек'
  const max = seat.bet + seat.chips
  if (to > max) return `Не хватает фишек: можно поставить до ${max}`
  if (to <= hand.currentBet) return `Ставка должна быть больше ${hand.currentBet}`
  // Неполный олл-ин-рейз не переоткрывает торги тем, кто уже ходил
  if (seat.acted && seat.actedAt >= hand.fullBet) return 'Неполный олл-ин не открывает торги: можно уравнять или сбросить'
  if (to - hand.currentBet < hand.minRaise && to < max) return `Минимум — до ${hand.currentBet + hand.minRaise}`
  const cap = potLimit(hand, seat)
  if (cap !== null && to > cap) return `Не больше банка: ${cap}`
  put(seat, to - seat.bet)
  // Полное повышение — и когда неполные олл-ины вместе набрали полный
  if (to - hand.fullBet >= hand.minRaise) {
    hand.minRaise = Math.max(hand.minRaise, to - hand.currentBet)
    hand.fullBet = to
  }
  hand.currentBet = to
  return null
}

// Пот-лимит (#80): до какой ставки улицы игрок может поднять — «пот»: колл, а сверху весь банк
// (с побочными и ставками на столе) вместе с этим коллом. Минимальный рейз — всегда можно.
// Без лимита — null
export function potLimit(hand: Hand, seat: HandSeat): number | null {
  if (hand.limit !== 'pot') return null
  const toCall = Math.max(0, hand.currentBet - seat.bet)
  const pot = hand.seats.reduce((sum, s) => sum + s.committed, 0)
  return Math.max(hand.currentBet + pot + toCall, hand.currentBet + hand.minRaise)
}

function canAct(seat: HandSeat): boolean {
  return !seat.folded && !seat.allIn
}

function needsAction(hand: Hand, seat: HandSeat): boolean {
  return canAct(seat) && (!seat.acted || seat.bet < hand.currentBet)
}

function roundOver(hand: Hand): boolean {
  const actors = hand.seats.filter(canAct)
  if (actors.length === 0) return true
  if (actors.length === 1) {
    // Один с фишками: ходить ему незачем, если он покрыл всех олл-инов
    const others = Math.max(0, ...hand.seats.filter((s) => !s.folded && s !== actors[0]).map((s) => s.bet))
    if (actors[0].bet >= others) return true
  }
  return !hand.seats.some((s) => needsAction(hand, s))
}

// После хода: следующий, кому ходить (от индекса from по кругу), или конец улицы
function proceed(hand: Hand, from: number): void {
  if (hand.seats.filter((s) => !s.folded).length === 1) return closeBetting(hand)
  if (roundOver(hand)) return nextStreet(hand)
  const n = hand.seats.length
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n
    if (needsAction(hand, hand.seats[i])) {
      hand.toAct = i
      return
    }
  }
}

function nextStreet(hand: Hand): void {
  // Круги торгов — по описанию игры у раздачи; живые карты — четыре улицы холдема
  const streets = hand.cards ? hand.cards.game.rounds.map((r) => r.street) : STREETS
  const next = streets.indexOf(hand.stage as Street) + 1
  // Последний круг закрыт или ставить больше некому (остальные олл-ин) — живые карты дилер
  // досдаст вживую, на телефонах — досдаёт table.ts
  if (next >= streets.length || hand.seats.filter(canAct).length < 2) return closeBetting(hand)
  hand.stage = streets[next]
  if (hand.cards) dealRound(hand.cards, dealOrder(hand))
  for (const s of hand.seats) {
    s.bet = 0
    s.acted = false
    s.actedAt = 0
  }
  hand.currentBet = 0
  hand.minRaise = hand.bb
  hand.fullBet = 0
  proceed(hand, (hand.button + 1) % hand.seats.length)
}

function closeBetting(hand: Hand): void {
  // Непокрытая часть самой большой ставки возвращается её хозяину
  const sorted = [...hand.seats].sort((a, b) => b.committed - a.committed)
  const [top, second] = sorted
  const uncovered = top.committed - (second?.committed ?? 0)
  if (uncovered > 0 && !top.folded) {
    top.chips += uncovered
    top.committed -= uncovered
    hand.returned = { playerId: top.id, amount: uncovered }
  }
  hand.pots = buildPots(hand.seats)
  hand.stage = 'showdown'
  hand.toAct = -1
}

// Кому сдавать: не сбросившие, по кругу от первого после кнопки
export function dealOrder(hand: Hand): string[] {
  return fromButton(hand, hand.seats.filter((s) => !s.folded).map((s) => s.id))
}

// Игроки по кругу, начиная с первого после кнопки
function fromButton(hand: Hand, ids: string[]): string[] {
  const n = hand.seats.length
  const out: string[] = []
  for (let k = 1; k <= n; k++) {
    const id = hand.seats[(hand.button + k) % n].id
    if (ids.includes(id)) out.push(id)
  }
  return out
}
