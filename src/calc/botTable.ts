// Стол против ботов (#117, Р-38): человек и боты на одном телефоне, без сервера и сети. Правила —
// src/poker/, как у комнаты: колоду тасует телефон и подаёт в handle на «Начать раздачу», ходы — за себя
// и за ботов. Бот получает только вид стола своими глазами (viewFor) — чужих закрытых карт в нём нет.
// В историю вечеров, учёт и статистику стол не идёт. Время — параметром now, случай — параметрами
import { deckFor, shuffle } from '../poker/game'
import { finishedHand, keepHand, type HistoryHand } from '../poker/history'
import { PROTOCOL_VERSION, type BetAction } from '../poker/protocol'
import { createTable, gameFor, handle, viewFor, type Result, type TableState } from '../poker/table'
import type { RandomBytes } from '../poker/tokens'
import { BOT_LEVELS, BOT_STYLES, botMove, pickStyles, seededRandom, styleLabel, type BotLevel, type BotStyle, type Random } from './bot'
import { actFor, parseLocalTable, rebuyNow, seatPlayer, toActId } from './localTable'
import { tableView, type TableView } from './pokerView'

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
  history: HistoryHand[] // раздачи по номерам — «История раздач»; стирается со столом
}

export type BotForm = { bots: number; level: BotLevel; open: boolean; sb: number; bb: number; startingStack: number }

export type BotStep = { ok: true; bots: BotTable } | { ok: false; error: string }

export function botCountError(n: number): string | null {
  return Number.isInteger(n) && n >= BOTS_MIN && n <= BOTS_MAX ? null : `Ботов — от ${BOTS_MIN} до ${BOTS_MAX}`
}

// Новый стол: я на первом месте и веду стол, боты — по порядку; холдем, кэш, карты раздаёт программа.
// Стили ботов — по уровню (pickStyles): без повтора, пока хватает; random — для тестов
export function startBotTable(form: BotForm, now: number, makeId: () => string, random: Random = Math.random): BotStep {
  const error = botCountError(form.bots)
  if (error) return { ok: false, error }
  const meId = makeId()
  const { sb, bb, startingStack } = form
  let r = createTable(meId, ME_NAME, { sb, bb, startingStack, maxSeats: form.bots + 1, cards: 'phones', game: 'holdem' }, now)
  for (let i = 0; r.ok && i < form.bots; i++) r = seatPlayer(r.state, makeId(), { name: BOT_NAMES[i], regularId: null }, now)
  if (!r.ok) return r
  const styles = stylesFor(r.state, meId, form.level, random)
  return { ok: true, bots: { id: makeId(), table: r.state, meId, level: form.level, styles, open: form.open, history: [] } }
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
  return !bt.table.hand && (bt.table.players.find((p) => p.id === bt.meId)?.chips ?? 0) === 0
}

// «Начать раздачу»: колода перемешана здесь, как на сервере комнаты; random — для тестов
export function dealBotHand(bt: BotTable, now: number, random?: RandomBytes): BotStep {
  if (iAmBroke(bt)) return { ok: false, error: 'Фишки кончились — докупитесь или закончите игру' }
  const game = gameFor(bt.table.settings)
  const deck = game ? shuffle(deckFor(game), random) : undefined
  return after(bt, handle(bt.table, bt.meId, { v: PROTOCOL_VERSION, type: 'start' }, now, deck), now)
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

// Ход бота: решает по виду стола своими глазами
export function botStep(bt: BotTable, now: number, random: Random): BotStep {
  const id = botToAct(bt)
  if (!id) return { ok: false, error: 'Сейчас не ход бота' }
  const move = botMove(viewFor(bt.table, id), id, botStyleOf(bt, id), random, bt.styles)
  if (!move) return { ok: false, error: 'Бот не нашёл хода' }
  return after(bt, actFor(bt.table, move, now), now)
}

// «Докупиться»: мне — стартовый стек
export function myRebuy(bt: BotTable, now: number): BotStep {
  return after(bt, rebuyNow(bt.table, bt.meId, bt.table.settings.startingStack, now), now)
}

// После хода: между раздачами боты без фишек докупаются сами на стартовый стек; окончилась раздача — она и в историю
function after(bt: BotTable, r: Result, now: number): BotStep {
  if (!r.ok) return r
  let table = r.state
  if (!table.hand) table = rebuyBots(table, bt.meId, now)
  return { ok: true, bots: { ...bt, table, history: keepHand(bt.history, finishedHand(bt.table, table)) } }
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
// в раздаче карты лицом; только для глаз, в ход бота это не идёт. Под именем бота — его стиль (tag): «ЛАГ»
export function botTableView(bt: BotTable, now: number): TableView {
  const base = tableView(viewFor(bt.table, bt.meId), bt.meId, now)
  const v = { ...base, seats: base.seats.map((s) => (s.isMe ? s : { ...s, tag: styleLabel(botStyleOf(bt, s.id)) })) }
  const cards = bt.table.hand?.cards
  if (!bt.open || !cards) return v
  return { ...v, seats: v.seats.map((s) => (s.isMe || s.cards === null ? s : { ...s, cards: cards.hole[s.id] ?? s.cards })) }
}

// Стол из памяти устройства; не похоже на стол с ботами — null. Стол до #139 — без стилей (или стиль у бота
// не из списка): стили по его уровню, всякий раз те же — случай от id стола
export function parseBotTable(text: string): BotTable | null {
  const base = parseLocalTable(text)
  if (!base) return null
  const x = JSON.parse(text) as Record<string, unknown>
  const meId = x.meId
  const level = BOT_LEVELS.find(([l]) => l === x.level)?.[0]
  if (typeof meId !== 'string' || !level || !base.table.players.some((p) => p.id === meId)) return null
  const saved = typeof x.styles === 'object' && x.styles !== null ? (x.styles as Record<string, unknown>) : {}
  const bots = base.table.players.filter((p) => p.id !== meId)
  const known = new Set<unknown>(BOT_STYLES.map(([s]) => s))
  const styles = bots.every((p) => known.has(saved[p.id]))
    ? Object.fromEntries(bots.map((p) => [p.id, saved[p.id] as BotStyle]))
    : stylesFor(base.table, meId, level, seededRandom(hashOf(base.id)))
  return { id: base.id, table: base.table, meId, level, styles, open: x.open === true, history: base.history }
}

function hashOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}
