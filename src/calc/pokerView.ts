// Экран стола: что показать каждому по состоянию стола. Правил не держит — только читает
// стол (src/poker/) и решает, какие кнопки показать и с какими суммами; отказ всё равно
// скажет сервер. Время — параметром now, как у стола
import type { Card } from '../poker/cards'
import { publicCards } from '../poker/game'
import type { HandLogEntry, Stage } from '../poker/hand'
import { HUD_FEW_HANDS } from '../poker/hud'
import { buildPots } from '../poker/pots'
import { blindsNow, HOST_TAKEOVER_MS, waitingRebuy, type TableState } from '../poker/table'
import {
  buildLevels,
  clockAt,
  defaultPrizes,
  prizeAmounts,
  prizePool,
  rebuyLeft,
  rebuyOpen,
  standings,
  type Level,
} from '../poker/tournament'
import { formatNumber, formatTenths } from './format'

export type SeatView = {
  // Карты у места (карты на телефонах): в раздаче — рубашки (null), открытые всем — лицом,
  // свои — тоже рубашкой: их видно, пока держишь палец (myCards); между раздачами — открытые
  // на вскрытии и показанные. Нет карт — null
  cards: (Card | null)[] | null
  handName: string | null // между раздачами — что было у дошедшего до вскрытия
  best: Card[] | null // между раздачами у победителя банка на вскрытии — лучшая пятёрка (#96); иначе null
  id: string
  seat: number // номер места за столом, 0…maxSeats−1
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
  turnLeft: number | null // чей ход и таймер идёт — сколько секунд осталось
  place: number | null // турнир: место выбывшего, а когда окончен — у всех; иначе null
  hud: HudView | null // HUD вечера (#79): раздач ещё не было или HUD чужой при «только свою» — null
}

// HUD вечера (#79): проценты — целые; null — не было случая (ATS, CB). AF — «1,5», «∞» (коллов нет,
// а рейзы были) или «—» (ни того, ни другого)
export type HudView = {
  hands: number
  few: boolean // меньше HUD_FEW_HANDS раздач — «мало раздач»
  vpip: number
  pfr: number
  af: string
  ats: number | null
  cb: number | null
}

// Турнир (#78): уровень, отсчёт до следующего, фонд и призы, ребай
export type TournamentView = {
  started: boolean // «Начать турнир» нажат
  ended: boolean // остался один с фишками и ребай закрыт, или ведущий закончил турнир
  level: number // номер уровня, с 1
  blinds: Level // блайнды и анте уровня
  next: Level | null // следующего уровня; последний — null
  nextLeft: number | null // мс до следующего уровня (не начат — весь уровень); последний — null
  stopped: boolean // часы стоят: «Перерыв»
  buyIn: number // ₽
  pool: number // призовой фонд, ₽: все бай-ины
  prizes: { place: number; pct: number; amount: number }[] // до начала — по нынешнему числу игроков
  prizesOwn: boolean // ведущий задал свои проценты
  rebuyLevels: number // ребай до конца этого уровня; 0 — без ребая
  rebuyOpen: boolean
  canRebuy: boolean // мне — «Ребай»: я выбыл, а ребай открыт
  waiting: boolean // «Ждём ребай» (#94): с фишками один, ребай открыт — раздачи нет
  waitLeft: number | null // ждём ребай — мс до его закрытия по часам; не закроется сам — null
  canEnd: boolean // мне, ведущему: «Закончить турнир» — пока ждём ребай
  results: { place: number; id: string; name: string; out: boolean; prize: number }[] // места по порядку
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
  maxSeats: number // «Мест за столом»: точки у стола — на все места
  freeSeats: number[] // между раздачами — свободные места по номерам, на них можно пересесть (#98); в раздаче — пусто
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
  phoneCards: boolean // карты на телефонах: банки раздаются сами
  board: Card[] // общие карты; между раздачами — прошлой раздачи
  // Между раздачами после вскрытия — карты стола из пятёрок победителей: их подсветить, остальные приглушить; иначе null
  boardWin: Card[] | null
  myCards: Card[] | null // мои закрытые и открытые карты в раздаче — для «Подглядеть»
  canShow: { cards: Card[]; shown: boolean[] } | null // взял банк без вскрытия: что можно показать
  paused: boolean // «Перерыв»
  turnLeft: number | null // секунд на ход у того, чей ход; таймера нет — null
  nextHandLeft: number | null // секунд до раздачи «сама»; не начнётся сама — null
  ante: number // анте с каждого: в раздаче — её, между раздачами — следующей; 0 — нет
  tournament: TournamentView | null // кэш — null
}

const STAGE_LABELS: Record<Stage, string> = {
  preflop: 'Префлоп',
  flop: 'Флоп',
  turn: 'Тёрн',
  river: 'Ривер',
  showdown: 'Торги закрыты',
}

// now — время сервера (телефон поправляет свои часы по присланному с столом, useRoom)
export function tableView(table: TableState, meId: string, now: number): TableView {
  const hand = table.hand
  const turn = table.turn
  const turnLeft = hand && turn && hand.toAct !== -1 ? secondsLeft(turn.deadline, now) : null
  const names = new Map(table.players.map((p) => [p.id, p.name]))
  const nameOf = (id: string) => names.get(id) ?? 'Ушёл'
  const host = table.players.find((p) => p.id === table.hostId)
  const positions = hand ? positionLabels(hand.seats.length) : []
  const cards = hand?.cards
  const record = hand ? undefined : table.lastHand?.record // прошлая раздача — пока новой нет
  const fives = hand ? new Map<string, Card[]>() : winningFives(table)
  const tournament = tournamentView(table, meId, now)
  // Место у места за столом: у выбывших, а когда турнир окончен — у всех
  const places = new Map((tournament?.results ?? []).filter((r) => r.out || tournament?.ended).map((r) => [r.id, r.place]))

  const seats: SeatView[] = [...table.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const index = hand ? hand.seats.findIndex((s) => s.id === p.id) : -1
      const s = hand && index !== -1 ? hand.seats[index] : null
      return {
        cards: cards ? (s && !s.folded ? publicCards(cards, p.id) : null) : (record?.shown[p.id] ?? null),
        handName: record?.hands[p.id] ?? null,
        best: fives.get(p.id) ?? null,
        id: p.id,
        seat: p.seat,
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
        turnLeft: hand !== null && index !== -1 && index === hand.toAct ? turnLeft : null,
        place: places.get(p.id) ?? null,
        hud: table.settings.publicHud || p.id === meId ? hudView(table, p.id) : null,
      }
    })
  const me = seats.find((s) => s.isMe) ?? null
  const isHost = meId === table.hostId
  const myHole = cards?.hole[meId]
  const hidden = record?.hidden?.playerId === meId ? record.hidden : null
  const maxSeats = table.settings.maxSeats
  const taken = new Set(table.players.map((p) => p.seat))

  return {
    seats,
    me,
    maxSeats,
    freeSeats: hand ? [] : Array.from({ length: maxSeats }, (_, k) => k).filter((k) => !taken.has(k)),
    isHost,
    hostName: host?.name ?? '',
    stage: hand?.stage ?? null,
    stageLabel: hand ? STAGE_LABELS[hand.stage] : table.paused ? 'Перерыв' : 'Между раздачами',
    handNumber: hand?.number ?? table.handCount,
    pot: hand ? hand.seats.reduce((sum, s) => sum + s.committed, 0) : 0,
    pots: hand ? potsView(table, nameOf) : [],
    toActName: hand && hand.toAct !== -1 ? nameOf(hand.seats[hand.toAct].id) : null,
    actions: actionsView(table, meId),
    canStart:
      isHost &&
      !hand &&
      !tournament?.ended &&
      table.players.filter((p) => p.chips > 0 && !p.sittingOut).length >= 2,
    canTakeHost:
      !isHost && host !== undefined && !host.online && now - (host.offlineSince ?? now) > HOST_TAKEOVER_MS,
    rebuyRequests: table.rebuyRequests.map((r) => ({ ...r, name: nameOf(r.playerId) })),
    myRebuy: table.rebuyRequests.find((r) => r.playerId === meId)?.amount ?? null,
    phoneCards: table.settings.cards === 'phones',
    board: cards?.board ?? record?.board ?? [],
    boardWin: record && fives.size > 0 ? record.board.filter((c) => [...fives.values()].some((five) => five.includes(c))) : null,
    myCards: myHole && myHole.length > 0 && myHole.every((c) => c !== null) ? (myHole as Card[]) : null,
    canShow: hidden && record ? { cards: hidden.cards, shown: hidden.cards.map((_, i) => Boolean(record.shown[meId]?.[i])) } : null,
    paused: table.paused === true,
    turnLeft,
    nextHandLeft: !hand && typeof table.nextHandAt === 'number' ? secondsLeft(table.nextHandAt, now) : null,
    ante: hand ? (hand.ante ?? 0) : (tournament?.blinds.ante ?? table.settings.ante ?? 0),
    tournament,
  }
}

// Турнир на экране: до «Начать турнир» — первый уровень целиком, призы по нынешнему числу игроков.
// now — время сервера: отсчёт до уровня не зависит от часов телефона
export function tournamentView(table: TableState, meId: string, now: number): TournamentView | null {
  const t = table.settings.tournament
  if (table.settings.format !== 'tournament' || !t) return null
  const clock = table.tournament ?? null
  const levels = buildLevels(t, table.settings.sb, table.settings.bb)
  const at = clock ? clockAt(t, clock, clock.endedAt ?? now) : { index: 0, msLeft: t.levelMinutes * 60_000 }
  const pcts = clock ? clock.prizes : (t.prizes ?? defaultPrizes(table.players.length))
  const pool = prizePool(table, t)
  const amounts = prizeAmounts(pool, pcts)
  const names = new Map<string, string>()
  for (const e of table.chipLog) if (e.kind === 'leave') names.set(e.playerId, e.name ?? 'Ушёл')
  for (const p of table.players) names.set(p.id, p.name)
  const open = clock !== null && rebuyOpen(t, clock, now)
  const ended = typeof clock?.endedAt === 'number'
  const waiting = waitingRebuy(table, now)
  return {
    started: clock !== null,
    ended,
    level: at.index + 1,
    blinds: clock ? blindsNow(table, clock.endedAt ?? now) : levels[0],
    next: at.msLeft === null ? null : levels[at.index + 1],
    nextLeft: ended ? null : at.msLeft,
    stopped: typeof clock?.pausedAt === 'number' && !ended,
    buyIn: t.buyIn,
    pool,
    prizes: pcts.map((pct, i) => ({ place: i + 1, pct, amount: amounts[i] })),
    prizesOwn: t.prizes !== null,
    rebuyLevels: t.rebuyLevels,
    rebuyOpen: open,
    canRebuy: open && (clock?.out.some((b) => b.playerId === meId) ?? false) && table.players.some((p) => p.id === meId),
    waiting,
    waitLeft: waiting && clock ? rebuyLeft(t, clock, now) : null,
    canEnd: waiting && meId === table.hostId,
    results: clock
      ? standings(table).map((s, i) => ({
          place: s.place,
          id: s.playerId,
          name: names.get(s.playerId) ?? 'Ушёл',
          out: s.out,
          prize: ended ? (amounts[i] ?? 0) : 0,
        }))
      : [],
  }
}

// HUD игрока за вечер — числа для экрана; раздач не было — null. Кому его видно, решает вызывающий:
// tableView — по настройке стола, стол на одном телефоне — всем
export function hudView(table: TableState, playerId: string): HudView | null {
  const c = table.hud?.[playerId]
  if (!c || c.hands === 0) return null
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)
  return {
    hands: c.hands,
    few: c.hands < HUD_FEW_HANDS,
    vpip: pct(c.vpip, c.hands) ?? 0,
    pfr: pct(c.pfr, c.hands) ?? 0,
    af: c.calls > 0 ? formatTenths(c.raises / c.calls) : c.raises > 0 ? '∞' : '—',
    ats: pct(c.steals, c.stealChances),
    cb: pct(c.cbs, c.cbChances),
  }
}

// Отсчёт «мм:сс» с округлением секунд вверх; час и больше — минуты всё равно числом: «75:00»
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Знак «ваш ход»: метка моего хода (раздача и номер хода в ней); не мой ход — null.
// Экран подаёт звук и вибрацию, когда метка сменилась на новую — один раз на ход
export function myTurnMark(table: TableState, meId: string): string | null {
  const hand = table.hand
  if (!hand || hand.stage === 'showdown' || hand.toAct === -1 || hand.seats[hand.toAct].id !== meId) return null
  return `${hand.number}-${hand.log.length}`
}

// Целых секунд до срока, с округлением вверх: «1» до последнего мгновения; прошёл — 0
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
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

// Кнопки хода игрока meId; стол на одном телефоне берёт их за того, чей ход (localTable.ts)
export function actionsView(table: TableState, meId: string): ActionsView | null {
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

// Карта на экране: ранг и масть значком; черви и бубны — красные
export function cardFace(card: Card): { rank: string; suit: string; red: boolean } {
  const suits: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
  return { rank: card[0] === 'T' ? '10' : card[0], suit: suits[card[1]] ?? '?', red: card[1] === 'h' || card[1] === 'd' }
}

// Победители банков прошлой раздачи, дошедшие до вскрытия, — их лучшие пятёрки (#96).
// Банк без вскрытия, запись до #96 или раздачи с картами не было — пусто
export function winningFives(table: TableState): Map<string, Card[]> {
  const last = table.lastHand
  const best = last?.record?.best
  const out = new Map<string, Card[]>()
  if (!last || !best) return out
  for (const pot of last.pots) for (const id of pot.winners) if (best[id]) out.set(id, best[id])
  return out
}

export type LastHandView = {
  number: number
  board: Card[]
  // Сданные, по местам; best — у победителя банка на вскрытии лучшая пятёрка, иначе null
  players: { name: string; cards: (Card | null)[] | null; hand: string | null; best: Card[] | null; won: number }[]
  rounds: { label: string; moves: string[] }[] // ходы по кругам торгов
}

// Прошлая раздача с картами на телефонах — вся запись: места, карты, ходы, кто что взял.
// Пока идёт новая раздача или карт не было — null
export function lastHandRecord(table: TableState): LastHandView | null {
  const last = table.lastHand
  const record = last?.record
  if (!last || !record || table.hand) return null
  const names = new Map(record.seats.map((s) => [s.id, s.name]))
  const fives = winningFives(table)
  const rounds: LastHandView['rounds'] = []
  for (const e of record.log) {
    const label = STAGE_LABELS[e.street]
    if (rounds.at(-1)?.label !== label) rounds.push({ label, moves: [] })
    rounds[rounds.length - 1].moves.push(`${names.get(e.playerId) ?? 'Ушёл'}: ${moveText(e)}`)
  }
  return {
    number: last.number,
    board: record.board,
    players: record.seats.map((s) => ({
      name: s.name,
      cards: record.shown[s.id] ?? null,
      hand: record.hands[s.id] ?? null,
      best: fives.get(s.id) ?? null,
      won: last.payouts[s.id] ?? 0,
    })),
    rounds,
  }
}

// Ход словами; сумма — до какой ставки на этой улице; за игрока по таймеру — «время вышло»
function moveText(e: HandLogEntry): string {
  const text = betText(e)
  return e.timeout ? `${text}, время вышло` : text
}

function betText(e: HandLogEntry): string {
  const to = formatNumber(e.bet)
  switch (e.type) {
    case 'ante':
      return e.allIn ? `анте ${to}, олл-ин` : `анте ${to}`
    case 'fold':
      return 'пас'
    case 'check':
      return 'чек'
    case 'call':
      return e.allIn ? `колл до ${to}, олл-ин` : `колл до ${to}`
    case 'raise':
      return e.allIn ? `рейз до ${to}, олл-ин` : `рейз до ${to}`
    case 'allin':
      return `олл-ин до ${to}`
  }
}

// Конец игры: стек, закуп и разница у каждого, кто остался за столом
export function finalStacks(table: TableState): { name: string; chips: number; buyIn: number; diff: number }[] {
  return [...table.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({ name: p.name, chips: p.chips, buyIn: p.buyIn, diff: p.chips - p.buyIn }))
}
