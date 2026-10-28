// Стол кэш-игры или турнира (#78, tournament.ts): места, ведущий, раздачи, докупы, правки стека,
// уход, журнал фишек.
// handle — чистая функция: сообщение игрока → новое состояние или отказ с причиной
// (тогда состояние не меняется). Состояние — обычный JSON: сервер сохраняет его между
// сообщениями и поднимает снова. Время — параметром now (мс), не из часов.
// Карты на телефонах (Р-23): колоду тасует сервер и подаёт в handle; после торгов банки
// раздаются сами по силе руки; каждому телефону — свой вид стола (viewFor)
import { bestHand, winners as bestHands, type Card } from './cards'
import { cardsNeeded, HOLDEM_GAME, isDeckOf, publicCards, runOut, type CardsMode, type GameDef } from './game'
import { act, awardPots, dealOrder, startHand, type Hand, type HandLogEntry } from './hand'
import { PROTOCOL_VERSION, VERSION_ERROR, type BetAction, type ClientBody } from './protocol'
import {
  addBusts,
  buildLevels,
  clockAt,
  defaultPrizes,
  pauseClock,
  rebuyClosesAt,
  rebuyOpen,
  resumeClock,
  tournamentError,
  type Bust,
  type Level,
  type TournamentSettings,
  type TournamentState,
} from './tournament'

export type Settings = {
  sb: number
  bb: number
  startingStack: number // закуп при посадке
  maxSeats: number
  rebuyMaxBB: number | null // докуп за раз — не больше стольких больших блайндов; 0 — без докупов, null — без предела
  cards: CardsMode // у столов до этапа 2 поля нет — живые карты
  // Время на ход, секунд (TURN_MIN_S…TURN_MAX_S); null — без таймера. У столов до #75 полей нет — выкл
  turnSeconds?: number | null
  autoStart?: AutoStart // следующая раздача сама — пауза после раздачи банков
  // Вид стола (#77) — выбор ведущего из готовых; у столов до него полей нет — зелёное и классика
  felt?: Felt
  cardBack?: CardBack
  // Турнир (#78): режим стола; у столов до него полей нет — кэш без анте.
  // В турнире sb и bb — стартовые блайнды, startingStack — стартовый стек, ante не действует
  format?: TableFormat
  ante?: number // анте кэша с каждого, фишек; 0 — нет
  tournament?: TournamentSettings // структура турнира; есть, когда format — 'tournament'
}

export type TableFormat = 'cash' | 'tournament'

export type AutoStart = 'off' | 'fast' | 'medium' | 'slow'

export const FELTS = ['green', 'blue', 'burgundy', 'graphite'] as const
export type Felt = (typeof FELTS)[number]

export const CARD_BACKS = ['classic', 'blue', 'green', 'geo'] as const
export type CardBack = (typeof CARD_BACKS)[number]

// Пауза перед раздачей «сама», мс
export const AUTO_START_MS: Record<Exclude<AutoStart, 'off'>, number> = { fast: 3000, medium: 6000, slow: 10_000 }

export const TURN_MIN_S = 10
export const TURN_MAX_S = 300

// Два истечения хода подряд — игрок пропускает раздачи
export const TIMEOUTS_TO_SIT_OUT = 2

export const DEFAULT_SETTINGS: Settings = {
  sb: 5,
  bb: 10,
  startingStack: 1000,
  maxSeats: 9,
  rebuyMaxBB: null,
  cards: 'live',
  turnSeconds: null,
  autoStart: 'off',
  felt: 'green',
  cardBack: 'classic',
}

// Описание игры для новой раздачи: карты на телефонах — холдем (пока одно); живые — null.
// У столов до этапа 2 поля cards нет — живые. По нему сервер знает, какую колоду тасовать
export function gameFor(settings: Settings): GameDef | null {
  return settings.cards === 'phones' ? HOLDEM_GAME : null
}

// Ведущий вне сети дольше этого — остальные могут взять ведение
export const HOST_TAKEOVER_MS = 60_000

export type TablePlayer = {
  id: string
  name: string
  regularId: string | null // постоянный игрок из списка ведущего (Р-12); null — гость
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
  // Ушёл со стола с остатком; имя и постоянный — чтобы назвать ушедшего в итоге вечера (у записей до #60 их нет)
  | { kind: 'leave'; playerId: string; by: string; chips: number; at: number; name?: string; regularId?: string | null }

export type HandResult = {
  number: number
  pots: { amount: number; winners: string[] }[]
  payouts: Record<string, number>
  record?: HandRecord // карты на телефонах — полная запись раздачи
}

// Запись раздачи с картами — под журнал раздач (этап 3). Карты сбросивших сюда не попадают
export type HandRecord = {
  game: GameDef
  sb: number
  bb: number
  ante?: number // анте раздачи (#78); нет — без анте
  seats: { id: string; name: string; chips: number }[] // по местам; стек в начале раздачи
  button: number // индекс в seats
  board: Card[]
  log: HandLogEntry[] // ходы по кругам торгов
  shown: Record<string, (Card | null)[]> // видны всем: дошедшие до вскрытия, открытые и показанные; null — не показана
  hands: Record<string, string> // у дошедших до вскрытия — что у него: «Две пары, короли и семёрки»
  // У дошедших до вскрытия — лучшая пятёрка: сначала карты комбинации, затем кикеры (#96); у записей до неё поля нет
  best?: Record<string, Card[]>
  hidden: { playerId: string; cards: Card[] } | null // взял банк без вскрытия: карты видны только ему, пока не покажет
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
  // Время (#75); у столов до него полей нет — таймера, перерыва и раздачи «сама» нет
  turn?: TurnClock | null // срок текущего хода; null — таймер не идёт
  paused?: boolean // «Перерыв»: новая раздача не начинается, таймер стоит
  nextHandAt?: number | null // когда начнётся раздача «сама»; null — не начнётся
  timeouts?: Record<string, number> // истечений хода подряд у игрока
  // Турнир (#78): часы уровней, места, призы; null — турнир не начат или стол — кэш. У столов до #78 поля нет
  tournament?: TournamentState | null
}

// Срок хода: ход — номер раздачи и число ходов в ней (log), чтобы будильник не принял старый срок за новый
export type TurnClock = { hand: number; move: number; deadline: number }

export type Result = { ok: true; state: TableState } | { ok: false; error: string }

export function createTable(
  hostId: string,
  hostName: string,
  settings: Partial<Settings>,
  now: number,
  hostRegularId: string | null = null,
): Result {
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
    turn: null,
    paused: false,
    nextHandAt: null,
    timeouts: {},
    tournament: null,
  }
  const sitError = sit(state, hostId, hostName, now, hostRegularId)
  return sitError ? { ok: false, error: sitError } : { ok: true, state }
}

// deck — перемешанная колода для новой раздачи с картами на телефонах (тасует сервер)
export function handle(state: TableState, from: string, message: unknown, now: number, deck?: Card[]): Result {
  if (!isRecord(message) || message.v !== PROTOCOL_VERSION) return { ok: false, error: VERSION_ERROR }
  const next = structuredClone(state)
  const error = apply(next, from, message as ClientBody, now, deck) ?? settle(next, now)
  if (error) return { ok: false, error }
  endWait(next, now)
  clock(next, now)
  return { ok: true, state: next }
}

// Ближайший срок стола — истечение хода, раздача «сама» или закрытие ребая, пока его ждут (#94);
// нет — null. По нему сервер ставит будильник
export function nextDeadline(state: TableState): number | null {
  const t = state.settings.tournament
  const rebuyCloses = t && state.tournament && alone(state) ? rebuyClosesAt(t, state.tournament) : null
  const times = [state.turn?.deadline, state.nextHandAt, rebuyCloses].filter((x): x is number => typeof x === 'number')
  return times.length > 0 ? Math.min(...times) : null
}

// Будильник сервера: ребай закрылся, пока его ждали, — турнир окончен; истёк ход — за игрока
// чек, если можно, иначе пас («время вышло»); пора — новая раздача (deck — колода от сервера,
// как на start). Сверяет срок с состоянием: сработал раньше срока или повторно — null, стол не меняется
export function onTime(state: TableState, now: number, deck?: Card[]): TableState | null {
  const closed = closeRebuyWait(state, now)
  if (closed) return closed
  const hand = state.hand
  const turn = state.turn
  if (hand && turn && now >= turn.deadline && sameTurn(turn, hand) && !state.paused) {
    const next = structuredClone(state)
    if (expire(next, now)) return null
    clock(next, now)
    return next
  }
  if (!hand && typeof state.nextHandAt === 'number' && now >= state.nextHandAt) {
    const next = structuredClone(state)
    next.nextHandAt = null
    // Не начать (меньше двоих с фишками, перерыв) — раздача «сама» стоит до ведущего
    if (!next.paused) start(next, deck, now)
    clock(next, now)
    return next
  }
  return null
}

// Истёк ход: тот же ход, что у ведущего «Пропустить», с пометкой в журнале раздачи.
// Истечений подряд TIMEOUTS_TO_SIT_OUT — игрок пропускает раздачи. Ошибка — строка
function expire(state: TableState, now: number): string | null {
  const hand = state.hand as Hand
  const id = hand.seats[hand.toAct].id
  const error = skip(state)
  if (error) return error
  const entry = hand.log[hand.log.length - 1]
  if (entry) entry.timeout = true
  const timeouts = (state.timeouts ??= {})
  timeouts[id] = (timeouts[id] ?? 0) + 1
  const p = state.players.find((x) => x.id === id)
  if (p && timeouts[id] >= TIMEOUTS_TO_SIT_OUT) {
    p.sittingOut = true
    delete timeouts[id]
  }
  return settle(state, now)
}

// Срок хода после любой перемены стола: новый ход — новый срок от now; тот же — срок прежний.
// Перерыв или таймер выключен — срока нет; идёт раздача — раздачи «сама» нет
function clock(state: TableState, now: number): void {
  const hand = state.hand
  if (hand) state.nextHandAt = null
  const seconds = state.settings.turnSeconds ?? null
  if (!hand || hand.toAct === -1 || seconds === null || state.paused) {
    state.turn = null
    return
  }
  if (state.turn && sameTurn(state.turn, hand)) return
  state.turn = { hand: hand.number, move: hand.log.length, deadline: now + seconds * 1000 }
}

function sameTurn(turn: TurnClock, hand: Hand): boolean {
  return turn.hand === hand.number && turn.move === hand.log.length && hand.toAct !== -1
}

// Раздача «сама» — через паузу из настроек; выкл, перерыв, идёт раздача, раздач ещё не было,
// турнир окончен или ждёт ребая — нет
function armNext(state: TableState, now: number): void {
  const mode = state.settings.autoStart ?? 'off'
  const ended = typeof state.tournament?.endedAt === 'number'
  const ready = mode !== 'off' && !state.hand && !state.paused && state.handCount > 0 && !ended && !alone(state)
  state.nextHandAt = ready ? now + AUTO_START_MS[mode] : null
}

// Что видит телефон игрока playerId: без колоды и без чужих закрытых карт — ни в раздаче,
// ни в записи прошлой (карты взявшего без вскрытия — только ему). null — не вошедший
export function viewFor(table: TableState, playerId: string | null): TableState {
  if (!table.hand?.cards && !table.lastHand?.record?.hidden) return table
  const view = structuredClone(table)
  const cards = view.hand?.cards
  if (cards) {
    cards.deck = []
    for (const id of Object.keys(cards.hole)) if (id !== playerId) cards.hole[id] = publicCards(cards, id)
  }
  const record = view.lastHand?.record
  if (record?.hidden && record.hidden.playerId !== playerId) record.hidden = null
  return view
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

function apply(state: TableState, from: string, msg: ClientBody, now: number, deck: Card[] | undefined): string | null {
  if (msg.type === 'sit') return sit(state, from, msg.name, now, msg.regularId)
  const me = state.players.find((p) => p.id === from)
  if (!me) return 'Вас нет за столом'
  const isHost = from === state.hostId
  const hostOnly = 'Это может только ведущий'
  switch (msg.type) {
    case 'start':
      if (!isHost) return hostOnly
      return state.paused ? 'Перерыв — сначала «Продолжить»' : start(state, deck, now)
    case 'tournamentRebuy':
      return tournamentRebuy(state, me, now)
    case 'endTournament':
      return isHost ? endTournament(state, now) : hostOnly
    case 'act':
      if (!state.hand) return 'Раздачи сейчас нет'
      if (!isAction(msg.action)) return 'Неизвестный ход — обновите приложение'
      return act(state.hand, from, msg.action) ?? resetTimeouts(state, from)
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
      // Вернулся в раздачи — истечения считаются заново
      return p.sittingOut ? null : resetTimeouts(state, id)
    }
    case 'pause':
      return isHost ? pause(state, msg.paused === true, now) : hostOnly
    case 'tableSettings':
      return isHost ? changeSettings(state, msg, now) : hostOnly
    case 'look':
      return isHost ? changeLook(state, msg) : hostOnly
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
    case 'show':
      return show(state, from, msg.cards)
    default:
      return 'Неизвестное сообщение — обновите приложение'
  }
}

// regularId — постоянный игрок; за столом он один: второй раз под ним не сесть
function sit(state: TableState, id: string, name: unknown, now: number, regularId: unknown): string | null {
  if (state.players.some((p) => p.id === id)) return 'Вы уже за столом'
  if (state.tournament) return 'Турнир уже идёт — новых не сажаем'
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return 'Нужно имя'
  const regular = typeof regularId === 'string' && regularId ? regularId : null
  if (regular && state.players.some((p) => p.regularId === regular)) return 'Этот игрок уже за столом'
  const taken = new Set(state.players.map((p) => p.seat))
  let seat = 0
  while (seat < state.settings.maxSeats && taken.has(seat)) seat++
  if (seat >= state.settings.maxSeats) return 'Стол заполнен'
  const chips = state.settings.startingStack
  state.players.push({
    id,
    name: trimmed,
    regularId: regular,
    seat,
    chips,
    buyIn: chips,
    sittingOut: false,
    online: true,
    offlineSince: null,
  })
  state.chipLog.push({ kind: 'buyin', playerId: id, amount: chips, at: now })
  return null
}

// now — время начала: в турнире по нему уровень блайндов и анте; первая раздача запускает часы
function start(state: TableState, deck: Card[] | undefined, now: number): string | null {
  if (state.hand) return 'Раздача ещё идёт'
  if (typeof state.tournament?.endedAt === 'number') return 'Турнир окончен'
  const playing = state.players.filter((p) => p.chips > 0 && !p.sittingOut).sort((a, b) => a.seat - b.seat)
  if (playing.length < 2) return 'Нужно хотя бы двое с фишками'
  // Карты на телефонах: описание игры — у раздачи (сейчас одно — холдем), колода — от сервера
  let deal: { game: GameDef; deck: Card[] } | undefined
  const game = gameFor(state.settings)
  if (game) {
    if (!isDeckOf(game, deck)) return 'Нет колоды — раздача не начата'
    if (cardsNeeded(game, playing.length) > deck.length) return 'Карт в колоде на всех не хватит'
    deal = { game, deck }
  }
  const t = state.settings.tournament
  if (state.settings.format === 'tournament' && t && !state.tournament) {
    const error = beginTournament(state, t, now)
    if (error) return error
  }
  // Кнопка — следующее играющее место по кругу после прошлой
  const prev = state.buttonSeat
  const after = prev === null ? -1 : playing.findIndex((p) => p.seat > prev)
  const button = after === -1 ? 0 : after
  state.buttonSeat = playing[button].seat
  state.handCount++
  const { sb, bb, ante } = blindsNow(state, now)
  state.hand = startHand(state.handCount, playing, button, sb, bb, deal, ante)
  return null
}

// «Начать турнир»: часы идут с этой минуты; играют все за столом, призы — заданные или по числу игроков
function beginTournament(state: TableState, t: TournamentSettings, now: number): string | null {
  const entrants = [...state.players].sort((a, b) => a.seat - b.seat).map((p) => p.id)
  const prizes = t.prizes ?? defaultPrizes(entrants.length)
  if (prizes.length > entrants.length) {
    return `Призовых мест — ${prizes.length}, а игроков — ${entrants.length}: поправьте призы`
  }
  state.tournament = { startedAt: now, pausedAt: null, pausedMs: 0, entrants, prizes, out: [], endedAt: null }
  return null
}

// Блайнды и анте новой раздачи: в турнире — уровня по часам, в кэше — из настроек стола
export function blindsNow(state: TableState, now: number): Level {
  const t = state.settings.tournament
  if (state.settings.format === 'tournament' && t && state.tournament) {
    return buildLevels(t, state.settings.sb, state.settings.bb)[clockAt(t, state.tournament, now).index]
  }
  return { sb: state.settings.sb, bb: state.settings.bb, ante: state.settings.ante ?? 0 }
}

// «Ребай» турнира: сам игрок (на одном телефоне — ведущий за него), только выбывший и пока ребай
// открыт; стек — стартовый, бай-ин — в журнал фишек. Докупы кэша в турнире выключены
function tournamentRebuy(state: TableState, me: TablePlayer, now: number): string | null {
  const t = state.settings.tournament
  const clock = state.tournament
  if (state.settings.format !== 'tournament' || !t) return 'Ребай — только в турнире'
  if (!clock) return 'Турнир ещё не начат'
  if (clock.endedAt !== null) return 'Турнир окончен'
  const index = clock.out.findIndex((b) => b.playerId === me.id)
  if (index === -1) return 'Ребай — когда кончились фишки'
  if (!rebuyOpen(t, clock, now)) return t.rebuyLevels === 0 ? 'В этом турнире без ребая' : `Ребай был до конца уровня ${t.rebuyLevels}`
  clock.out.splice(index, 1)
  const chips = state.settings.startingStack
  state.chipLog.push({ kind: 'rebuy', playerId: me.id, by: me.id, from: me.chips, to: chips, at: now })
  me.chips = chips
  me.buyIn += chips
  if (!state.hand && state.nextHandAt == null) armNext(state, now)
  return null
}

// Турнир: у кого после раздачи ноль — выбыл; остался один с фишками — турнир окончен,
// а при открытом ребае — ждёт ребая выбывших (#94)
function settleTournament(state: TableState, busts: Bust[], now: number): void {
  const clock = state.tournament
  if (!clock || clock.endedAt !== null) return
  addBusts(clock, busts)
  if (alone(state) && !waitingRebuy(state, now)) clock.endedAt = now
}

// Турнир идёт, а с фишками не больше одного: дальше — только ребай выбывших или конец
function alone(state: TableState): boolean {
  const clock = state.tournament
  if (!clock || clock.endedAt !== null) return false
  const out = new Set(clock.out.map((b) => b.playerId))
  return state.players.filter((p) => !out.has(p.id)).length <= 1
}

// «Ждём ребай» (#94): остался один с фишками, а ребай открыт — турнир не окончен, раздачи нет
export function waitingRebuy(state: TableState, now: number): boolean {
  const t = state.settings.tournament
  return alone(state) && t !== undefined && rebuyOpen(t, state.tournament as TournamentState, now)
}

// Ребай закрылся по часам, пока его ждали, — турнир окончен в минуту закрытия; не пора — null.
// Зовут будильник сервера (onTime) и часы стола на одном телефоне
export function closeRebuyWait(state: TableState, now: number): TableState | null {
  if (!alone(state) || waitingRebuy(state, now)) return null
  const next = structuredClone(state)
  endWait(next, now)
  return next
}

function endWait(state: TableState, now: number): void {
  const t = state.settings.tournament
  const clock = state.tournament
  if (!t || !clock || !alone(state) || waitingRebuy(state, now)) return
  clock.endedAt = Math.min(now, rebuyClosesAt(t, clock) ?? now)
  state.nextHandAt = null
}

// «Закончить турнир» (#94): ведущий, пока ждём ребай, — турнир окончен сейчас, места — по выбыванию
function endTournament(state: TableState, now: number): string | null {
  const clock = state.tournament
  if (state.settings.format !== 'tournament' || !clock) return 'Турнир ещё не начат'
  if (clock.endedAt !== null) return 'Турнир окончен'
  if (!alone(state)) return 'Закончить турнир — когда с фишками остался один'
  clock.endedAt = now
  state.nextHandAt = null
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
  if (hand.cards) return 'Банки раздаются сами — по картам'
  if (!Array.isArray(winners) || !winners.every((w) => Array.isArray(w) && w.every((id) => typeof id === 'string'))) {
    return 'Неизвестное сообщение — обновите приложение'
  }
  const payouts = awardPots(hand, winners as string[][])
  if (typeof payouts === 'string') return payouts
  finishHand(state, hand, winners as string[][], payouts, now)
  return null
}

// Карты на телефонах, торги закрыты: досдать стол, открыть карты дошедших и раздать каждый
// банк лучшей руке среди его претендентов; остался один — он берёт всё без вскрытия
function settle(state: TableState, now: number): string | null {
  const hand = state.hand
  const cards = hand?.cards
  if (!hand || !cards || hand.stage !== 'showdown') return null
  const { variant } = cards.game
  const live = hand.seats.filter((s) => !s.folded).map((s) => s.id)
  const hole = (id: string) => cards.hole[id] as Card[] // на сервере все карты на месте
  const shown: Record<string, (Card | null)[]> = {}
  const hands: Record<string, string> = {}
  const best: Record<string, Card[]> = {}
  let hidden: HandRecord['hidden'] = null
  let winners: string[][]
  if (live.length > 1) {
    runOut(cards, dealOrder(hand))
    winners = hand.pots.map((pot) => bestHands(variant, cards.board, pot.eligible.map((id) => ({ id, cards: hole(id) }))))
    for (const id of live) {
      const result = bestHand(variant, hole(id), cards.board)
      shown[id] = hole(id)
      hands[id] = result.name
      best[id] = result.cards
    }
  } else {
    winners = hand.pots.map((pot) => [...pot.eligible])
    hidden = { playerId: live[0], cards: hole(live[0]) }
  }
  // Открытые по описанию карты остальных — их и так видели все
  for (const s of hand.seats) {
    const open = publicCards(cards, s.id)
    if (!shown[s.id] && open.some((c) => c !== null)) shown[s.id] = open
  }
  const payouts = awardPots(hand, winners)
  if (typeof payouts === 'string') return payouts
  const names = new Map(state.players.map((p) => [p.id, p.name]))
  const record: HandRecord = {
    game: cards.game,
    sb: hand.sb,
    bb: hand.bb,
    ...(hand.ante ? { ante: hand.ante } : {}),
    // В начале раздачи: стек сейчас минус выигрыш плюс вложенное
    seats: hand.seats.map((s) => ({ id: s.id, name: names.get(s.id) ?? 'Ушёл', chips: s.chips - (payouts[s.id] ?? 0) + s.committed })),
    button: hand.button,
    board: [...cards.board],
    log: hand.log,
    shown,
    hands,
    best,
    hidden,
  }
  finishHand(state, hand, winners, payouts, now, record)
  return null
}

// Раздача окончена: стеки — игрокам, итог — в «прошлую раздачу», одобренные в ней докупы — в стек
function finishHand(
  state: TableState,
  hand: Hand,
  winners: string[][],
  payouts: Record<string, number>,
  now: number,
  record?: HandRecord,
): void {
  for (const seat of hand.seats) {
    const p = state.players.find((x) => x.id === seat.id)
    if (p) p.chips = seat.chips
  }
  state.lastHand = {
    number: hand.number,
    pots: hand.pots.map((pot, k) => ({ amount: pot.amount, winners: winners[k] })),
    payouts,
    ...(record ? { record } : {}),
  }
  state.hand = null
  // Докупы, одобренные во время раздачи, — в стек сейчас, между раздачами
  for (const r of state.approvedRebuys) addRebuy(state, r.playerId, r.amount, r.by, now)
  state.approvedRebuys = []
  // Турнир: без фишек после раздачи — выбыл; стек до неё — сейчас минус выигрыш плюс вложенное
  const seated = new Set(state.players.map((p) => p.id))
  const busts = hand.seats
    .filter((s) => s.chips === 0 && seated.has(s.id))
    .map((s) => ({ playerId: s.id, hand: hand.number, chips: s.chips - (payouts[s.id] ?? 0) + s.committed }))
  settleTournament(state, busts, now)
  armNext(state, now)
}

// «Перерыв»: новая раздача не начинается, идущая доигрывается без таймера. «Продолжить» —
// ход получает срок заново, между раздачами — раздача «сама» снова через паузу.
// В турнире «Перерыв» ещё и стоит часы уровней, «Продолжить» пускает их с того же места
function pause(state: TableState, paused: boolean, now: number): string | null {
  if (state.paused === paused) return paused ? 'Перерыв уже идёт' : 'Перерыва нет'
  state.paused = paused
  const clock = state.tournament
  if (clock && clock.endedAt === null) {
    if (paused) pauseClock(clock, now)
    else resumeClock(clock, now)
  }
  armNext(state, now)
  return null
}

// Время на ход и раздача «сама» — ведущий, между раздачами; действуют со следующей раздачи
function changeSettings(state: TableState, msg: Extract<ClientBody, { type: 'tableSettings' }>, now: number): string | null {
  if (state.hand) return 'Настройки стола меняются между раздачами'
  const s: Settings = { ...state.settings }
  if ('turnSeconds' in msg) s.turnSeconds = msg.turnSeconds
  if ('autoStart' in msg) s.autoStart = msg.autoStart
  const tournament = s.format === 'tournament'
  // Анте кэша (#78) — со следующей раздачи; в турнире анте — по уровням
  if ('ante' in msg) {
    if (tournament) return 'В турнире анте — по уровням'
    s.ante = msg.ante
  }
  // Призы турнира — до «Начать турнир»: тогда известно, сколько игроков
  if ('prizes' in msg) {
    if (!tournament || !s.tournament) return 'Призы — только в турнире'
    if (state.tournament) return 'Призы меняются до начала турнира'
    s.tournament = { ...s.tournament, prizes: msg.prizes ?? null }
  }
  const error = settingsError(s)
  if (error) return error
  const was = state.settings.autoStart ?? 'off'
  state.settings = s
  if ((s.autoStart ?? 'off') !== was) armNext(state, now)
  return null
}

// Вид стола (#77) — сукно и рубашка: не правило игры, меняется и во время раздачи
function changeLook(state: TableState, msg: Extract<ClientBody, { type: 'look' }>): string | null {
  const s: Settings = { ...state.settings }
  if ('felt' in msg) s.felt = msg.felt
  if ('cardBack' in msg) s.cardBack = msg.cardBack
  const error = settingsError(s)
  if (error) return error
  state.settings = s
  return null
}

// Игрок походил сам или вернулся в раздачи — истечения подряд с нуля
function resetTimeouts(state: TableState, playerId: string): null {
  if (state.timeouts) delete state.timeouts[playerId]
  return null
}

// «Показать»: взявший банк без вскрытия открывает всем свои карты — обе или одну (по номерам)
function show(state: TableState, from: string, which: unknown): string | null {
  const record = state.lastHand?.record
  const hidden = record?.hidden
  if (state.hand || !record || !hidden || hidden.playerId !== from) return 'Показать карты может взявший банк без вскрытия — до новой раздачи'
  const n = hidden.cards.length
  if (
    !Array.isArray(which) ||
    which.length === 0 ||
    !which.every((i) => Number.isInteger(i) && i >= 0 && i < n) ||
    new Set(which).size !== which.length
  ) {
    return 'Выберите, какие карты показать'
  }
  const before = record.shown[from] ?? []
  const shown = hidden.cards.map((c, i) => (which.includes(i) || before[i] ? c : null))
  record.shown[from] = shown
  if (shown.every((c) => c !== null)) record.hidden = null
  return null
}

function requestRebuy(state: TableState, me: TablePlayer, amount: unknown): string | null {
  if (state.settings.format === 'tournament') return 'В турнире докупов нет — ребай, когда кончились фишки'
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
  if (state.settings.format === 'tournament') return 'В турнире стек не правится'
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
  if (typeof state.tournament?.endedAt === 'number') return 'Турнир окончен — места уже распределены'
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
  state.chipLog.push({ kind: 'leave', playerId, by, chips, at: now, name: p.name, regularId: p.regularId })
  state.players = state.players.filter((x) => x.id !== playerId)
  state.rebuyRequests = state.rebuyRequests.filter((r) => r.playerId !== playerId)
  state.approvedRebuys = state.approvedRebuys.filter((r) => r.playerId !== playerId)
  // Турнир: ушёл — выбыл сразу, место — по моменту ухода, его фишки из игры уходят
  const clock = state.tournament
  if (clock && !clock.out.some((b) => b.playerId === playerId)) {
    settleTournament(state, [{ playerId, hand: state.handCount, chips }], now)
  }
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
  if (s.cards !== 'live' && s.cards !== 'phones') return 'Карты — живые или на телефонах'
  const t = s.turnSeconds ?? null
  if (t !== null && (!Number.isInteger(t) || t < TURN_MIN_S || t > TURN_MAX_S)) {
    return `Время на ход — от ${TURN_MIN_S} до ${TURN_MAX_S} секунд или без таймера`
  }
  const a = s.autoStart ?? 'off'
  if (a !== 'off' && !Object.keys(AUTO_START_MS).includes(a)) return 'Следующая раздача сама — выкл, быстро, средне или медленно'
  if (s.felt !== undefined && !(FELTS as readonly unknown[]).includes(s.felt)) return 'Сукно — зелёное, синее, бордовое или графит'
  if (s.cardBack !== undefined && !(CARD_BACKS as readonly unknown[]).includes(s.cardBack)) {
    return 'Рубашка карт — классика, синяя, зелёная или гео'
  }
  if (s.ante !== undefined && (!Number.isInteger(s.ante) || s.ante < 0)) return 'Анте — целое число фишек, не меньше нуля'
  const format = s.format ?? 'cash'
  if (format !== 'cash' && format !== 'tournament') return 'Игра — кэш или турнир'
  if (format === 'tournament') return tournamentError(s.tournament)
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
