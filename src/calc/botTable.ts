// Стол против ботов (#117, Р-38): человек и боты на одном телефоне, без сервера и сети. Правила —
// src/poker/, как у комнаты: колоду тасует телефон и подаёт в handle на «Начать раздачу», ходы — за себя
// и за ботов. Бот получает только вид стола своими глазами (viewFor) — чужих закрытых карт в нём нет.
// В историю вечеров, учёт и статистику стол не идёт. Время — параметром now, случай — параметрами
import { deckFor, shuffle } from '../poker/game'
import { finishedHand, keepHand, type HistoryHand } from '../poker/history'
import { PROTOCOL_VERSION, type BetAction } from '../poker/protocol'
import { AUTO_START_MS, createTable, gameFor, handle, onTime, viewFor, type AutoStart, type Result, type TableState } from '../poker/table'
import type { RandomBytes } from '../poker/tokens'
import { BOT_LEVELS, BOT_STYLES, botMove, pickStyles, seededRandom, styleLabel, type BotLevel, type BotStyle, type Random } from './bot'
import { actFor, hostDo, parseLocalTable, rebuyNow, seatPlayer, toActId } from './localTable'
import { hudView, tableView, type TableView } from './pokerView'
import type { QuickBets } from './quickBets'

export const BOTS_MIN = 1
export const BOTS_MAX = 5
export const BOTS_DEFAULT = 3
export const BOT_LEVEL_DEFAULT: BotLevel = 'amateur'
// Пауза перед ходом бота, мс: видно, кто и как сходил
export const BOT_PAUSE_MS = 1000

export const ME_NAME = 'Вы'
const BOT_NAMES = ['Бот Север', 'Бот Юг', 'Бот Запад', 'Бот Восток', 'Бот Центр']

export type BotTable = {
  id: string // свой id стола
  table: TableState // весь стол — с колодой и картами ботов; на экран — только botTableView
  meId: string // человек — он же ведущий стола
  level: BotLevel
  styles: Record<string, BotStyle> // стиль каждого бота по его id (#139); виден подписью под именем
  open: boolean // «Карты ботов открыты» — только на экране человека; ботам не виднее
  showStyles: boolean // «Стиль ботов виден» (#145, Р-48) — подпись стиля под именем; только для экрана человека
  autoFinish: boolean // «После паса — сразу доигрывать» (#194): я сбросил — раздача доигрывается сама мгновенно
  hudAll: boolean // «HUD у всех мест» (#196): строка HUD и у ботов; только для экрана человека, ботам — как было
  history: HistoryHand[] // раздачи по номерам — «История раздач»; стирается со столом
}

// Игра стола ботов (#147, Р-46): холдем без лимита или омаха пот-лимит; кэш
export type BotGame = 'holdem' | 'omaha'

export const BOT_GAMES: [BotGame, string][] = [
  ['holdem', 'Холдем'],
  ['omaha', 'Омаха'],
]

export const BOT_GAME_DEFAULT: BotGame = 'holdem'

// «Следующая раздача сама» у нового стола ботов (#156, Р-51) — сначала самая короткая пауза
export const BOT_AUTO_START_DEFAULT: AutoStart = 'fast'

// showStyles — «Стиль ботов виден»; не задано — виден. autoStart — «Следующая раздача сама»; не задано — нет.
// autoFinish — «После паса — сразу доигрывать»; не задано — нет. hudAll — «HUD у всех мест»; не задано — у всех
export type BotForm = {
  bots: number
  level: BotLevel
  open: boolean
  showStyles?: boolean
  autoFinish?: boolean
  hudAll?: boolean
  sb: number
  bb: number
  startingStack: number
  game?: BotGame
  autoStart?: AutoStart
}

export type BotStep = { ok: true; bots: BotTable } | { ok: false; error: string }

export function botCountError(n: number): string | null {
  return Number.isInteger(n) && n >= BOTS_MIN && n <= BOTS_MAX ? null : `Ботов — от ${BOTS_MIN} до ${BOTS_MAX}`
}

// Новый стол: я на первом месте и веду стол, боты — по порядку; холдем или омаха пот-лимит, кэш, карты
// раздаёт программа. Игра и раздача «сама» — в настройках стола (у стола до #147 — холдем, до #156 — кнопкой).
// Стили ботов — по уровню (pickStyles): без повтора, пока хватает; random — для тестов
export function startBotTable(form: BotForm, now: number, makeId: () => string, random: Random = Math.random): BotStep {
  const error = botCountError(form.bots)
  if (error) return { ok: false, error }
  const meId = makeId()
  const { sb, bb, startingStack } = form
  const autoStart = form.autoStart ?? 'off'
  const game = form.game === 'omaha' ? ({ game: 'omaha', limit: 'pot' } as const) : ({ game: 'holdem' } as const)
  const settings = { sb, bb, startingStack, maxSeats: form.bots + 1, cards: 'phones', autoStart, ...game } as const
  let r = createTable(meId, ME_NAME, settings, now)
  for (let i = 0; r.ok && i < form.bots; i++) r = seatPlayer(r.state, makeId(), { name: BOT_NAMES[i], regularId: null }, now)
  if (!r.ok) return r
  const styles = stylesFor(r.state, meId, form.level, random)
  const showStyles = form.showStyles !== false
  const autoFinish = form.autoFinish === true
  const hudAll = form.hudAll !== false
  const flags = { open: form.open, showStyles, autoFinish, hudAll }
  const bots = { id: makeId(), table: r.state, meId, level: form.level, styles, ...flags, history: [] }
  return { ok: true, bots }
}

// Игра стола ботов — по его настройкам; стол до #147 без поля — холдем
export function botGameOf(bt: BotTable): BotGame {
  return bt.table.settings.game === 'omaha' ? 'omaha' : 'holdem'
}

// Строка игры стола: «Омаха, пот-лимит, кэш» или «Холдем, кэш»
export function botGameLine(game: BotGame): string {
  return game === 'omaha' ? 'Омаха, пот-лимит, кэш' : 'Холдем, кэш'
}

function stylesFor(table: TableState, meId: string, level: BotLevel, random: Random): Record<string, BotStyle> {
  const bots = table.players.filter((p) => p.id !== meId)
  const picked = pickStyles(level, bots.length, random)
  return Object.fromEntries(bots.map((p, i) => [p.id, picked[i]]))
}

// Стиль бота id; нет в столе — по уровню (не бывает: стили есть у каждого бота)
export function botStyleOf(bt: BotTable, id: string): BotStyle {
  return bt.styles[id] ?? pickStyles(bt.level, 1, () => 0)[0]
}

// Мои фишки кончились (между раздачами) — «Докупиться» или «Закончить»
export function iAmBroke(bt: BotTable): boolean {
  return !bt.table.hand && myChips(bt.table, bt.meId) === 0
}

// «Начать раздачу»: колода перемешана здесь, как на сервере комнаты; random — для тестов
export function dealBotHand(bt: BotTable, now: number, random?: RandomBytes): BotStep {
  if (iAmBroke(bt)) return { ok: false, error: 'Фишки кончились — докупитесь или закончите игру' }
  const game = gameFor(bt.table.settings)
  const deck = game ? shuffle(deckFor(game), random) : undefined
  return after(bt, handle(bt.table, bt.meId, { v: PROTOCOL_VERSION, type: 'start' }, now, deck), now)
}

// Раздача «сама» у стола ботов (#156, Р-51) — тот же взвод, что у комнаты (settings.autoStart, nextHandAt):
// первая — кнопкой, дальше — через паузу после раздачи банков; «Перерыв» и мои кончившиеся фишки её снимают
export function botAutoStart(bt: BotTable): AutoStart {
  return bt.table.settings.autoStart ?? 'off'
}

// Когда начнётся раздача «сама»; null — не начнётся. Мои фишки кончились — боты без меня не играют
export function botNextHandAt(bt: BotTable): number | null {
  const at = bt.table.nextHandAt
  return typeof at === 'number' && !bt.table.hand && !iAmBroke(bt) ? at : null
}

// Срок вышел — раздача начинается сама, колода — как у «Начать раздачу»; рано или некому — ошибка, стол как был
export function autoDealBotHand(bt: BotTable, now: number, random?: RandomBytes): BotStep {
  if (botNextHandAt(bt) === null) return { ok: false, error: 'Раздача сама не начнётся' }
  const game = gameFor(bt.table.settings)
  const deck = game ? shuffle(deckFor(game), random) : undefined
  const next = onTime(bt.table, now, deck)
  if (!next) return { ok: false, error: 'Раздача сама начнётся позже' }
  return after(bt, { ok: true, state: next }, now)
}

// «Перерыв» / «Продолжить»: в перерыв раздача сама не начинается, идущая доигрывается; «Продолжить» —
// снова через полную паузу
export function botPause(bt: BotTable, paused: boolean, now: number): BotStep {
  return after(bt, hostDo(bt.table, { type: 'pause', paused }, now), now)
}

// Стол снова на экране (приложение открыли заново или вернулись к нему): ждавшая раздача «сама» не начинается
// мгновенно — отсчёт заново с полной паузы
export function resumeBotTable(bt: BotTable, now: number): BotTable {
  const mode = botAutoStart(bt)
  if (typeof bt.table.nextHandAt !== 'number' || bt.table.hand || mode === 'off') return bt
  return { ...bt, table: { ...bt.table, nextHandAt: now + AUTO_START_MS[mode] } }
}

// Чей ход — бота: его id; мой ход или торгов нет — null
export function botToAct(bt: BotTable): string | null {
  const id = toActId(bt.table)
  return id !== null && id !== bt.meId ? id : null
}

// Мой ход кнопками
export function myMove(bt: BotTable, action: BetAction, now: number): BotStep {
  if (toActId(bt.table) !== bt.meId) return { ok: false, error: 'Сейчас не ваш ход' }
  return after(bt, actFor(bt.table, action, now), now)
}

// Ход бота: решает по виду стола своими глазами и по HUD вечера всех за столом (#146) — счётчикам по ходам,
// без карт; их любой за столом мог бы набрать сам. Докуп HUD не сбрасывает: он лежит в столе по игроку
export function botStep(bt: BotTable, now: number, random: Random): BotStep {
  const id = botToAct(bt)
  if (!id) return { ok: false, error: 'Сейчас не ход бота' }
  const move = botMove(viewFor(bt.table, id), id, botStyleOf(bt, id), random, bt.styles, bt.table.hud)
  if (!move) return { ok: false, error: 'Бот не нашёл хода' }
  return after(bt, actFor(bt.table, move, now), now)
}

// Я сбросил (или меня нет в раздаче), а раздача идёт дальше между ботами — «Доиграть сразу» (#194)
export function botsPlayOn(bt: BotTable): boolean {
  const hand = bt.table.hand
  if (!hand || !botToAct(bt)) return false
  const me = hand.seats.find((s) => s.id === bt.meId)
  return !me || me.folded
}

// Предел ходов одной раздачи при доигрывании: столько не бывает, но цикл не повиснет
const FINISH_MAX_STEPS = 1000

// «Доиграть сразу» (#194): ходы ботов подряд, без пауз — те же botStep, что по таймеру, с той же записью
// в историю; олл-ин и вскрытие — движком, как после последнего хода. Конец — как у обычной раздачи
// (докуп ботов, раздача «сама» взводится). Я в раздаче — отказ, стол как был
export function finishBotHand(bt: BotTable, now: number, random: Random): BotStep {
  if (!botsPlayOn(bt)) return { ok: false, error: 'Вы в раздаче — ходите сами' }
  let cur = bt
  for (let i = 0; cur.table.hand && botToAct(cur); i++) {
    if (i >= FINISH_MAX_STEPS) return { ok: false, error: 'Раздача не доигрывается' }
    const r = botStep(cur, now, random)
    if (!r.ok) return r
    cur = r.bots
  }
  return { ok: true, bots: cur }
}

// «После паса — сразу доигрывать» включено и я сбросил — доиграть без кнопки
export function autoFinishNow(bt: BotTable): boolean {
  return bt.autoFinish && botsPlayOn(bt)
}

// «Докупиться»: мне — стартовый стек
export function myRebuy(bt: BotTable, now: number): BotStep {
  return after(bt, rebuyNow(bt.table, bt.meId, bt.table.settings.startingStack, now), now)
}

// «Докупить всех до N» (#195): раздачи нет, а у кого-то меньше стартового стека. Во время раздачи стек
// в players — на её начало, живой — в раздаче, поэтому только между ними (на отсчёте и в «Перерыве» тоже)
export function canTopUpAll(bt: BotTable): boolean {
  const n = bt.table.settings.startingStack
  return !bt.table.hand && bt.table.players.some((p) => p.chips < n)
}

// Каждому, у кого меньше стартового стека, — докуп ровно до него (мне тоже), обычным докупом стола:
// в стеке и в истории фишек; у кого столько и больше — как был. Нечего докупать или идёт раздача — отказ
export function topUpAll(bt: BotTable, now: number): BotStep {
  if (bt.table.hand) return { ok: false, error: 'Докупить всех — между раздачами' }
  if (!canTopUpAll(bt)) return { ok: false, error: 'У всех уже стартовый стек или больше' }
  const n = bt.table.settings.startingStack
  let table = bt.table
  for (const p of bt.table.players) {
    if (p.chips >= n) continue
    const r = rebuyNow(table, p.id, n - p.chips, now)
    if (!r.ok) return r
    table = r.state
  }
  return after(bt, { ok: true, state: table }, now)
}

// После хода: между раздачами боты без фишек докупаются сами на стартовый стек; окончилась раздача — она и в историю.
// Мои фишки кончились — раздача «сама» снята (#156): боты без меня не играют; докуп взводит её заново с полной паузы
function after(bt: BotTable, r: Result, now: number): BotStep {
  if (!r.ok) return r
  let table = r.state
  if (!table.hand) table = rebuyBots(table, bt.meId, now)
  if (!table.hand && myChips(table, bt.meId) === 0 && table.nextHandAt != null) table = { ...table, nextHandAt: null }
  return { ok: true, bots: { ...bt, table, history: keepHand(bt.history, finishedHand(bt.table, table)) } }
}

function myChips(table: TableState, meId: string): number {
  return table.players.find((p) => p.id === meId)?.chips ?? 0
}

function rebuyBots(table: TableState, meId: string, now: number): TableState {
  let t = table
  for (const p of table.players) {
    if (p.id === meId || p.chips > 0) continue
    const r = rebuyNow(t, p.id, t.settings.startingStack, now)
    if (r.ok) t = r.state
  }
  return t
}

// Вид стола мне: как у игрока комнаты — свои карты, у ботов рубашки. «Карты ботов открыты» — у ботов
// в раздаче карты лицом; только для глаз, в ход бота это не идёт. Под именем бота — его стиль (tag): «ЛАГ»;
// «Стиль ботов виден» снят — подписи нет (#145). «HUD у всех мест» (#196) — у ботов строка HUD из того же
// state.hud, что читают боты; снят — HUD только у моего места. bets — быстрые ставки этого телефона (Р-62)
export function botTableView(bt: BotTable, now: number, bets?: QuickBets): TableView {
  const base = tableView(viewFor(bt.table, bt.meId), bt.meId, now, bets)
  const withHud = bt.hudAll ? { ...base, seats: base.seats.map((s) => (s.isMe ? s : { ...s, hud: hudView(bt.table, s.id) })) } : base
  const tagged = (s: TableView['seats'][number]) => (s.isMe ? s : { ...s, tag: styleLabel(botStyleOf(bt, s.id)) })
  const v = bt.showStyles ? { ...withHud, seats: withHud.seats.map(tagged) } : withHud
  const cards = bt.table.hand?.cards
  if (!bt.open || !cards) return v
  return { ...v, seats: v.seats.map((s) => (s.isMe || s.cards === null ? s : { ...s, cards: cards.hole[s.id] ?? s.cards })) }
}

// Стол из памяти устройства; не похоже на стол с ботами — null. Стол до #139 — без стилей (или стиль у бота
// не из списка): стили по его уровню, всякий раз те же — случай от id стола. Стол до #145 — со стилем на виду
export function parseBotTable(text: string): BotTable | null {
  const base = parseLocalTable(text)
  if (!base) return null
  const x = JSON.parse(text) as Record<string, unknown>
  const meId = x.meId
  const level = BOT_LEVELS.find(([l]) => l === x.level)?.[0]
  if (typeof meId !== 'string' || !level || !base.table.players.some((p) => p.id === meId)) return null
  // Боты играют холдем и омаху пот-лимит; у стола до #147 поля игры нет — холдем
  const { game, limit } = base.table.settings
  if (game !== undefined && game !== 'holdem' && game !== 'omaha') return null
  if (game === 'omaha' && limit !== undefined && limit !== 'pot') return null
  const saved = typeof x.styles === 'object' && x.styles !== null ? (x.styles as Record<string, unknown>) : {}
  const bots = base.table.players.filter((p) => p.id !== meId)
  const known = new Set<unknown>(BOT_STYLES.map(([s]) => s))
  const styles = bots.every((p) => known.has(saved[p.id]))
    ? Object.fromEntries(bots.map((p) => [p.id, saved[p.id] as BotStyle]))
    : stylesFor(base.table, meId, level, seededRandom(hashOf(base.id)))
  // Стол до #194 без autoFinish — доигрывание кнопкой; до #196 без hudAll — HUD только у моего места
  const flags = { open: x.open === true, showStyles: x.showStyles !== false, autoFinish: x.autoFinish === true, hudAll: x.hudAll === true }
  return { id: base.id, table: base.table, meId, level, styles, ...flags, history: base.history }
}

function hashOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}
