// Бот покера (#117, Р-38; стили — #139, Р-45): решение хода — чистая функция. Вход — вид стола глазами
// бота (viewFor: свои карты, стол, банк, ставки, позиция, журнал ходов раздачи; чужие закрытые — null),
// стиль бота и стили соперников-ботов (подписи видны всем), выход — допустимый ход по правилам src/poker/.
// Холдем и омаха (#147, Р-46): у омахи своя оценка четырёх карт, дро, натсы и диапазоны (botOmaha), стили — те же.
// Чужие карты бот не читает, даже если ему подать весь стол: только свои и открытые всем.
// Случай — параметром (random): с одним и тем же случаем ответ один
import { buildDeck, type Card, type Variant } from '../poker/cards'
import { publicCards } from '../poker/game'
import type { Street } from '../poker/hand'
import type { BetAction } from '../poker/protocol'
import type { Hud } from '../poker/hud'
import type { TableState } from '../poker/table'
import { handScore } from './allInOdds'
import { PROFILES, readRival, type Profile, type RivalRead } from './botHud'
import {
  OMAHA_SPREAD,
  omahaBluff,
  omahaBoardRank,
  omahaDraw,
  omahaEquityVs,
  omahaRangeOf,
  omahaRankInRange,
  omahaTop,
  omahaTopOfRange,
} from './botOmaha'
import { blockerBluff, COMBOS, comboIndex, openWidth, topShare, WIDTHS, type BotStyle, type Who } from './botRanges'
import {
  behindOf,
  boardInfo,
  drawOf,
  equityVs,
  postflopOrder,
  quantiles,
  rangeOf,
  readHand,
  topOfRange,
  type HandRead,
  type Random,
} from './botRead'
import { actionsView, type ActionsView } from './pokerView'

export type { BotStyle } from './botRanges'
export type { Random } from './botRead'

// Уровень стола: из каких стилей боты; «Вперемешку» — все стили
export type BotLevel = 'novice' | 'amateur' | 'strong' | 'mixed'

export const BOT_LEVELS: [BotLevel, string][] = [
  ['novice', 'Новичок'],
  ['amateur', 'Любитель'],
  ['strong', 'Сильный'],
  ['mixed', 'Вперемешку'],
]

export const BOT_STYLES: [BotStyle, string][] = [
  ['maniac', 'Маньяк'],
  ['station', 'Колл-станция'],
  ['nit', 'Нит'],
  ['abc', 'ABC'],
  ['tag', 'ТАГ'],
  ['lag', 'ЛАГ'],
]

export const LEVEL_STYLES: Record<BotLevel, BotStyle[]> = {
  novice: ['maniac', 'station', 'nit'],
  amateur: ['abc'],
  strong: ['tag', 'lag'],
  mixed: ['maniac', 'station', 'nit', 'abc', 'tag', 'lag'],
}

export function styleLabel(style: BotStyle): string {
  return BOT_STYLES.find(([s]) => s === style)?.[1] ?? ''
}

// Стили на count ботов по уровню: без повтора, пока стилей хватает, затем — новый круг; порядок — случаем
export function pickStyles(level: BotLevel, count: number, random: Random): BotStyle[] {
  const out: BotStyle[] = []
  let pool: BotStyle[] = []
  while (out.length < count) {
    if (pool.length === 0) {
      pool = [...LEVEL_STYLES[level]]
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
    }
    out.push(pool.shift() as BotStyle)
  }
  return out
}

// Досдач на оценку руки после флопа: против случайных рук (слабые стили) или диапазонов (сильные)
export const BOT_SAMPLES = 60
// Соперников в оценке против случайных рук — не больше стольких: дальше доля почти не меняется
const MAX_RIVALS = 3
// Короткий стек сильного бота — пуш/фолд: столько больших блайндов и меньше
export const PUSH_FOLD_BB = 15
// Омаха: во сколько раз растянуть долю банка против случайных рук для слабых стилей и ABC
const OMAHA_STRETCH = 1.5

// Повторимый случай по зерну (mulberry32) — для тестов
export function seededRandom(seed: number): Random {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

// Расклад глазами бота
type Spot = {
  me: string
  style: BotStyle
  street: Street
  preflop: boolean
  holdem: boolean // холдем: диапазоны и чтение соперника; иначе — сила против случайных рук
  omaha: boolean // омаха (#147): своя оценка четырёх карт, диапазоны — выборкой (botOmaha)
  own: Card[]
  board: Card[]
  known: Card[] // свои, общие и открытые всем карты соперников
  variant: Variant
  top: number // до флопа: верхняя доля руки (0 — тузы, 1 — 7-2 разной масти); у омахи — делённая на OMAHA_SPREAD
  toCall: number
  pot: number // всё в банке со ставками улицы
  price: number // доля колла в банке после колла
  bb: number
  currentBet: number
  stack: number // фишек за спиной
  eff: number // эффективный стек в больших блайндах: меньший из своего и крупнейшего у соперников
  read: HandRead
  rivals: string[] // в раздаче, не сбросили
  who: (id: string) => Who // типаж соперника для чтения диапазона (botHud)
  profile: (id: string) => Profile // поправки к игре против него (botHud)
  rival: (id: string) => RivalRead
  level: number // повышений на этой улице до хода (до флопа — сверх большого блайнда)
  limpers: number // до флопа: уравняли большой блайнд до первого повышения
  behind: number // до флопа: сколько ходят после (открытие первым)
}

type Intent = { kind: 'fold' } | { kind: 'call' } | { kind: 'raise'; to: number }

const FOLD: Intent = { kind: 'fold' }
const CALL: Intent = { kind: 'call' } // уравнивать нечего — чек
const ALLIN: Intent = { kind: 'raise', to: Infinity }
const raiseTo = (to: number): Intent => ({ kind: 'raise', to })

// Ход бота botId стиля style; styles — стили соперников-ботов (человек — без стиля); hud — HUD вечера всех
// за столом (счётчики по ходам, без карт): по нему ТАГ и ЛАГ читают соперников (botHud, #146); не его ход — null
export function botMove(
  view: TableState,
  botId: string,
  style: BotStyle,
  random: Random,
  styles: Record<string, BotStyle> = {},
  hud?: Hud,
): BetAction | null {
  const hand = view.hand
  const a = actionsView(view, botId)
  if (!hand || !a?.myTurn) return null
  const seat = hand.seats.find((s) => s.id === botId)
  if (!seat) return null
  const cards = hand.cards
  const own = (cards?.hole[botId] ?? []).filter(isCard)
  const board = cards?.board ?? []
  const pot = hand.seats.reduce((sum, s) => sum + s.committed, 0)
  const toCall = a.check ? 0 : a.call
  const rivalSeats = hand.seats.filter((s) => !s.folded && s.id !== botId)
  const variant = cards?.game.variant
  const holdem = variant !== undefined && variant.deck === 52 && variant.fromHand === 'any' && own.length === 2
  const omaha = variant !== undefined && variant.deck === 52 && variant.fromHand === 2 && own.length === 4
  // Открытые всем карты соперников — вне колоды; закрытые бот не знает
  const dead = cards ? rivalSeats.flatMap((r) => publicCards(cards, r.id).filter(isCard)) : []
  const read = readHand(hand)
  const pre = read.moves.filter((m) => m.street === 'preflop')
  const firstRaise = pre.findIndex((m) => m.aggressive)
  const streetMoves = read.moves.filter((m) => m.street === hand.stage)
  const biggest = Math.max(0, ...rivalSeats.map((s) => s.chips + s.bet))
  const reads = new Map<string, RivalRead>()
  const rival = (id: string): RivalRead => {
    let r = reads.get(id)
    if (!r) reads.set(id, (r = readRival(id, styles, hud, omaha)))
    return r
  }
  const x: Spot = {
    me: botId,
    style,
    street: hand.stage === 'showdown' ? 'river' : hand.stage,
    preflop: hand.stage === 'preflop',
    holdem,
    omaha,
    own,
    board,
    known: [...own, ...board, ...dead],
    variant: variant ?? { deck: 52, fromHand: 'any', order: [] },
    top: omaha
      ? omahaTop(own) / OMAHA_SPREAD[style]
      : own.length === 2
        ? holdem
          ? topShare(own[0], own[1])
          : 1 - preflopStrength(own)
        : 0.5,
    toCall,
    pot,
    price: toCall / (pot + toCall),
    bb: hand.bb,
    currentBet: hand.currentBet,
    stack: seat.chips,
    eff: Math.min(seat.chips + seat.bet, biggest) / hand.bb,
    read,
    rivals: rivalSeats.map((s) => s.id),
    who: (id) => rival(id).who,
    profile: (id) => rival(id).profile,
    rival,
    level: streetMoves.filter((m) => m.aggressive).length,
    limpers: (firstRaise === -1 ? pre : pre.slice(0, firstRaise)).filter((m) => m.passive).length,
    behind: behindOf(read, botId),
  }
  const move = x.preflop ? PREFLOP[style](x, random) : POSTFLOP[style](x, random)
  return toAction(a, move)
}

// ——— До флопа ———

// Размеры: открытие 2,5 ББ (малый блайнд — 3) и по ББ за каждого вошедшего; 3-бет — втрое, без позиции — вчетверо
function openSize(x: Spot): number {
  const sb = x.read.ids.indexOf(x.me) === (x.read.n === 2 ? x.read.button : (x.read.button + 1) % x.read.n)
  return ((sb && x.read.n > 2 ? 3 : 2.5) + x.limpers) * x.bb
}

function threeBetSize(x: Spot, ip: boolean): number {
  const callers = x.read.moves.filter((m) => m.street === 'preflop' && m.level === 1 && m.passive).length
  return x.currentBet * (ip ? 3 : 4) + callers * x.currentBet
}

// Ставка больше 40 % стека — сразу олл-ин
function commit(x: Spot, to: number): Intent {
  return to >= 0.4 * (x.stack + x.currentBet - x.toCall) ? ALLIN : raiseTo(to)
}

// Последний повысивший до флопа и ширина его диапазона по стилю и ходу
function lastRaiser(x: Spot): { id: string; width: number } | null {
  const pre = x.read.moves.filter((m) => m.street === 'preflop')
  const m = [...pre].reverse().find((e) => e.aggressive && e.id !== x.me)
  if (!m) return null
  const who = x.who(m.id)
  const wd = WIDTHS[who]
  if (m.level === 0) {
    const limped = pre.some((e) => e.passive && pre.indexOf(e) < pre.indexOf(m))
    const behind = behindOf(x.read, m.id)
    let width = openWidth(who, behind, x.read.n) * (limped ? 0.7 : 1)
    // Открылся с поздней позиции первым — ширина и по его ATS за вечер (доля краж ≈ ширина открытия там)
    const ats = x.rival(m.id).ats
    if (!limped && ats !== null && behind <= 3 && x.read.n > 2) width = Math.min(1, (width + ats) / 2)
    return { id: m.id, width }
  }
  if (m.level === 1) return { id: m.id, width: wd.threeBet + wd.bluffs * 0.03 }
  return { id: m.id, width: wd.fourBet + wd.bluffs * 0.01 }
}

const inPosition = (x: Spot, vs: string) => postflopOrder(x.read, x.me) > postflopOrder(x.read, vs)
const isBigBlind = (x: Spot) => x.read.ids.indexOf(x.me) === x.read.bbIndex
const myCombo = (x: Spot) => COMBOS[comboIndex(x.own[0], x.own[1])]
// Рука годится в блеф-повышение до флопа: у холдема — блокеры (botRanges), у омахи — свои признаки
const bluffHand = (x: Spot) => (x.omaha ? omahaBluff(x.own) : blockerBluff(myCombo(x)))

// Маньяк: входит почти всегда повышением, крупно; на повышение — часто ре-рейз, иногда олл-ин без руки
function maniacPre(x: Spot, r: Random): Intent {
  const t = x.top
  if (r() < 0.03) return ALLIN
  const size = (3 + Math.floor(r() * 3)) * x.bb + x.limpers * x.bb
  if (x.level === 0) {
    if (t <= openWidth('maniac', x.behind, x.read.n)) return raiseTo(size)
    if (t <= 0.85) return CALL
    return x.toCall === 0 ? CALL : FOLD
  }
  if (x.level === 1) {
    if (t <= 0.3) return raiseTo(x.currentBet * 3.5)
    return t <= 0.65 ? CALL : FOLD
  }
  if (x.level === 2) {
    if (t <= 0.12) return ALLIN
    if (t <= 0.2) return raiseTo(x.currentBet * 2.5)
    return t <= 0.4 ? CALL : FOLD
  }
  if (t <= 0.08) return ALLIN
  return t <= 0.2 ? CALL : FOLD
}

// Колл-станция: входит часто уравниванием, повышает только лучшими, пасует редко
function stationPre(x: Spot): Intent {
  const t = x.top
  const share = x.toCall / (x.stack + x.toCall)
  if (x.level === 0) {
    if (t <= openWidth('station', x.behind, x.read.n)) return raiseTo(3 * x.bb + x.limpers * x.bb)
    if (t <= 0.55 || (x.toCall < x.bb && t <= 0.75)) return CALL
    return x.toCall === 0 ? CALL : FOLD
  }
  if (x.level === 1 && t <= 0.015) return raiseTo(x.currentBet * 3)
  if (x.level === 1) return t <= (share <= 0.12 ? 0.5 : share <= 0.35 ? 0.25 : 0.08) ? CALL : FOLD
  return t <= (share <= 0.3 ? 0.12 : 0.04) ? CALL : FOLD
}

// Нит: только лучшие руки, малые пары — уравнять дёшево; на ре-рейз без сильнейших — пас
function nitPre(x: Spot): Intent {
  const t = x.top
  const pair = x.own.length === 2 && x.own[0][0] === x.own[1][0]
  if (x.level === 0) {
    if (x.limpers === 0 && t <= openWidth('nit', x.behind, x.read.n)) return raiseTo(openSize(x))
    if (x.limpers > 0 && t <= 0.1) return raiseTo((4 + x.limpers) * x.bb)
    if (pair && x.toCall <= x.bb) return CALL
    return x.toCall === 0 ? CALL : FOLD
  }
  if (x.level === 1) {
    if (t <= 0.05) return raiseTo(x.currentBet * 3)
    if (t <= 0.065 || (isBigBlind(x) && t <= 0.08)) return CALL
    if (pair && x.toCall <= x.stack * 0.06) return CALL
    return FOLD
  }
  if (t <= 0.01) return ALLIN
  return t <= 0.016 ? CALL : FOLD
}

// ABC: нормальные руки по позиции, открывает повышением; повышение соперника — сила
function abcPre(x: Spot): Intent {
  const t = x.top
  const pair = x.own.length === 2 && x.own[0][0] === x.own[1][0]
  if (x.level === 0) {
    const w = openWidth('abc', x.behind, x.read.n)
    if (x.limpers === 0) {
      if (t <= w) return raiseTo(3 * x.bb)
      return x.toCall === 0 ? CALL : FOLD
    }
    if (t <= w * 0.5) return raiseTo((4 + x.limpers) * x.bb)
    if (t <= w || x.toCall === 0) return CALL
    return FOLD
  }
  if (x.level === 1) {
    if (t <= 0.045) return raiseTo(x.currentBet * 3)
    if (t <= 0.13) return CALL
    if (isBigBlind(x) && t <= 0.32 && x.toCall <= 3 * x.bb) return CALL
    if (pair && x.toCall <= x.stack * 0.07) return CALL
    return FOLD
  }
  if (x.level === 2) {
    if (t <= 0.012) return raiseTo(x.currentBet * 2.3)
    return t <= 0.03 ? CALL : FOLD
  }
  return t <= 0.012 ? ALLIN : FOLD
}

// ТАГ и ЛАГ: открытие по позиции, ре-рейз поляризованно (сильные и блефы-блокеры), колл — по позиции и цене,
// короткий стек — пуш/фолд
function strongPre(x: Spot, r: Random, lag: boolean): Intent {
  const t = x.top
  const me: Who = lag ? 'lag' : 'tag'
  if (x.eff <= PUSH_FOLD_BB) return pushFold(x, me)
  if (x.level === 0) {
    const w = openWidth(me, x.behind, x.read.n)
    if (x.limpers === 0) {
      // Кража блайндов из поздних позиций: против тех, кто сзади сдаётся (нит), — шире
      if (t <= w * (x.behind <= 3 ? stealFactor(x) : 1)) return raiseTo(openSize(x))
      return x.toCall === 0 ? CALL : FOLD
    }
    // Изоляция вошедших: против слабых — шире
    const loose = x.read.moves.some((m) => m.street === 'preflop' && m.passive && ['station', 'maniac', 'unknown'].includes(x.who(m.id)))
    if (t <= w * (loose ? 0.75 : 0.55)) return raiseTo((3.5 + x.limpers) * x.bb)
    if (x.toCall === 0) return CALL
    if (t <= w * 0.9 && x.behind <= 2) return CALL
    return FOLD
  }
  const raiser = lastRaiser(x)
  const wR = raiser?.width ?? 0.2
  const ip = raiser ? inPosition(x, raiser.id) : false
  if (x.level === 1) {
    const callers = x.read.moves.filter((m) => m.street === 'preflop' && m.level === 1 && m.passive).length
    const v = Math.min(0.14, Math.max(0.025, wR * (lag ? 0.3 : 0.22))) * (callers > 0 ? 0.85 : 1)
    let call = isBigBlind(x) ? Math.min(0.6, wR * 0.9 + 0.06) : ip ? wR * (lag ? 0.75 : 0.55) : wR * 0.3
    call *= Math.min(1.2, Math.max(0.5, (2.5 * x.bb) / Math.max(x.bb, x.currentBet)))
    if (callers > 0) call *= 0.85
    // Блеф-3-бет — чаще против тех, кто на него сдаётся
    const foldsTo = raiser ? x.profile(raiser.id).folds : 1
    const bluff = callers === 0 && t > v && bluffHand(x) && r() < (lag ? 0.45 : 0.25) * (wR > 0.3 ? 1.3 : 1) * foldsTo
    if (t <= v || bluff) return commit(x, threeBetSize(x, ip))
    if (t <= call && x.toCall <= x.stack * 0.12) return CALL
    return FOLD
  }
  const iOpened = x.read.moves.some((m) => m.street === 'preflop' && m.id === x.me && m.aggressive)
  const cheap = 1 + Math.max(0, 0.35 - x.price) * 2
  if (x.level === 2) {
    const v4 = Math.max(0.02, wR * 0.35)
    const bluff = iOpened && wR >= 0.05 && bluffHand(x) && r() < (lag ? 0.3 : 0.15)
    if (t <= v4 || bluff) return commit(x, x.currentBet * 2.3)
    const call = (iOpened ? Math.max(0.045, wR * 0.9) : Math.max(0.03, wR * 0.5)) * cheap
    if (t <= call && (x.toCall <= x.stack * 0.3 || t <= call * 0.6)) return CALL
    return FOLD
  }
  if (t <= Math.max(0.012, wR * 0.5)) return ALLIN
  return t <= Math.max(0.02, wR * 0.8) * cheap ? CALL : FOLD
}

// Во сколько раз шире красть блайнды: среднее по тем, кто ходит после, — как они сдаются на кражу
function stealFactor(x: Spot): number {
  const after = x.read.ids.filter((id) => id !== x.me && behindOf(x.read, id) < x.behind)
  if (after.length === 0) return 1
  return after.reduce((sum, id) => sum + x.profile(id).steal, 0) / after.length
}

// Пуш/фолд от PUSH_FOLD_BB и меньше: первым — олл-ин шире открытия; на повышение — олл-ин по ширине повысившего и цене
function pushFold(x: Spot, me: Who): Intent {
  const t = x.top
  if (x.omaha) return pushFoldOmaha(x, me)
  if (x.level === 0) {
    const w = Math.min(0.85, openWidth(me, x.behind, x.read.n) * (1.1 + (PUSH_FOLD_BB - x.eff) * 0.05))
    if (t <= (x.limpers > 0 ? w * 0.6 : w)) return ALLIN
    return x.toCall === 0 ? CALL : FOLD
  }
  const wR = lastRaiser(x)?.width ?? 0.2
  if (t <= Math.min(0.6, Math.max(0.03, wR * (0.35 + x.price)))) return ALLIN
  return x.toCall === 0 ? CALL : FOLD
}

// Пуш/фолд омахи: олл-ин в пот-лимите — повышениями «в банк» (ход ALLIN держится в пределах банка, toAction),
// поэтому только верхние руки омахи; уже повышал в этой раздаче — до конца, без паса
function pushFoldOmaha(x: Spot, me: Who): Intent {
  const t = x.top
  if (x.read.moves.some((m) => m.street === 'preflop' && m.id === x.me && m.aggressive)) return ALLIN
  if (x.level === 0) {
    const w = Math.min(0.3, openWidth(me, x.behind, x.read.n) * 0.6)
    if (t <= (x.limpers > 0 ? w * 0.6 : w)) return ALLIN
    return x.toCall === 0 ? CALL : FOLD
  }
  const wR = lastRaiser(x)?.width ?? 0.2
  if (t <= Math.min(0.25, Math.max(0.03, wR * (0.3 + x.price)))) return ALLIN
  return x.toCall === 0 ? CALL : FOLD
}

const PREFLOP: Record<BotStyle, (x: Spot, r: Random) => Intent> = {
  maniac: maniacPre,
  station: stationPre,
  nit: nitPre,
  abc: abcPre,
  tag: (x, r) => strongPre(x, r, false),
  lag: (x, r) => strongPre(x, r, true),
}

// ——— После флопа ———

// Ставка — доля банка после уравнивания
const potBet = (x: Spot, f: number) => x.currentBet + f * (x.pot + x.toCall)

// Слабым стилям и ABC — сила против случайных рук и дро
function rawStrength(x: Spot, r: Random): { s: number; draw: boolean } {
  let s = x.own.length >= 2 ? equityVsRandom(x.variant, x.own, x.board, x.rivals.length, x.known.slice(x.own.length + x.board.length), r) : 0.5
  // Омаха: доли банка против случайных рук теснее, чем в холдеме (сет — около 0,75, пара — около 0,55) —
  // растянуть от средней доли 1 / (соперников + 1), чтобы пороги стилей значили то же
  if (x.omaha) {
    const mid = 1 / (Math.min(Math.max(1, x.rivals.length), MAX_RIVALS) + 1)
    s = Math.min(1, Math.max(0, mid + (s - mid) * OMAHA_STRETCH))
  }
  const d = x.omaha ? omahaDraw(x.own, x.board) : x.own.length === 2 ? drawOf(x.own[0], x.own[1], x.board) : { flush: false, straight: 0 }
  return { s, draw: d.flush || d.straight === 2 }
}

// Агрессия соперников за раздачу после флопа: ставок и повышений
const rivalAggression = (x: Spot) => x.read.moves.filter((m) => m.street !== 'preflop' && m.id !== x.me && m.aggressive).length

// Маньяк: ставит и повышает на всех улицах, крупно; олл-ин без руки
function maniacPost(x: Spot, r: Random): Intent {
  const { s } = rawStrength(x, r)
  if (r() < 0.05) return ALLIN
  if (x.toCall === 0) return r() < 0.8 ? raiseTo(potBet(x, 0.75 + r() * 0.5)) : CALL
  if (s >= 0.7) return r() < 0.25 ? ALLIN : raiseTo(x.currentBet * 3)
  if (r() < 0.4) return raiseTo(x.currentBet * (2.5 + r()))
  return s >= 0.35 || r() < 0.3 ? CALL : FOLD
}

// Колл-станция: ставит редко, уравнивает до конца с любой парой и дро
function stationPost(x: Spot, r: Random): Intent {
  const { s, draw } = rawStrength(x, r)
  if (x.toCall === 0) return s >= 0.85 && r() < 0.4 ? raiseTo(potBet(x, 0.4)) : CALL
  if (s >= 0.95 && r() < 0.25) return raiseTo(x.currentBet * 2.5)
  if (x.toCall > 0.6 * x.stack && s < 0.6) return FOLD
  const need = x.street === 'river' ? 0.45 : 0.38
  return s >= need || (draw && x.street !== 'river') || r() < 0.12 ? CALL : FOLD
}

// Нит: ставит только сильной рукой, на агрессию без неё сдаётся, не блефует
function nitPost(x: Spot, r: Random): Intent {
  const { s, draw } = rawStrength(x, r)
  if (x.toCall === 0) return s >= 0.78 ? raiseTo(potBet(x, 0.66)) : CALL
  if (s >= 0.93) return raiseTo(x.currentBet * 3)
  const b = x.toCall / Math.max(1, x.pot - x.toCall)
  if (s >= (x.street === 'river' ? 0.82 : 0.76) + 0.1 * Math.min(1, b)) return CALL
  return draw && x.street === 'flop' && x.price <= 0.25 ? CALL : FOLD
}

// ABC: ставит с силой и пасует без неё, повышение соперника читает как силу, блефует редко
function abcPost(x: Spot, r: Random): Intent {
  const raw = rawStrength(x, r)
  const s = raw.s - 0.06 * rivalAggression(x)
  const aggressor = lastAggressorBefore(x) === x.me
  if (x.toCall === 0) {
    if (s >= 0.62) return raiseTo(potBet(x, 0.6))
    if (x.street === 'flop' && aggressor && x.rivals.length === 1 && r() < 0.6) return raiseTo(potBet(x, 0.5))
    if (raw.draw && r() < 0.3) return raiseTo(potBet(x, 0.5))
    return r() < 0.04 ? raiseTo(potBet(x, 0.5)) : CALL
  }
  if (s >= 0.9) return raiseTo(x.currentBet * 3)
  const b = x.toCall / Math.max(1, x.pot - x.toCall)
  // Без пары или старшего туза — пас; крупнее ставка — нужна рука сильнее
  const need = x.street === 'river' ? 0.5 + 0.3 * Math.min(1, b) : Math.max(0.55, x.price + 0.2) + 0.06 * x.level
  if (s >= need) return CALL
  return raw.draw && x.street !== 'river' && x.price <= 0.3 ? CALL : FOLD
}

// Кто повышал последним на прошлой улице (на флопе — до флопа)
function lastAggressorBefore(x: Spot): string | null {
  const streets: Street[] = ['preflop', 'flop', 'turn', 'river']
  const prev = streets[streets.indexOf(x.street) - 1]
  const m = [...x.read.moves].reverse().find((e) => e.street === prev && e.aggressive)
  return m?.id ?? null
}

// Частоты сильных после флопа (#146, Р-47): ТАГ — агрессивно с запасом, ЛАГ — рискованнее, блефов больше
type StrongPlay = {
  slow: number // медленная игра очень сильной рукой
  draw: number // дро — ставкой
  cbetDry: number // продолжение ставкой на сухом флопе
  cbetWet: number // и на мокром
  barrel: number // вторая ставка без руки (тёрн)
  river: number // блеф ривера
  stab: number // соперник сдался (ставил прошлую улицу, теперь чек) — забрать банк
  probe: number // все прочекали ко мне — ставка
  semi: number // полу-блеф повышением с дро
  raise: number // повышение без руки (чек-рейз) на одиночную ставку до ривера
  float: number // в позиции против продолжения ставкой: повышение вместо колла
  protect: number // крепкая рука на одиночную ставку — повышением
  pushy: number // насколько тоньше повышать против того, кто давит
  riverRaise: number // блеф-повышение на ривере
}
const PLAY: Record<'tag' | 'lag', StrongPlay> = {
  tag: {
    slow: 0.1, draw: 0.75, cbetDry: 0.85, cbetWet: 0.75, barrel: 0.55, river: 0.25, stab: 0.75, probe: 0.6, semi: 0.4, raise: 0.16,
    float: 0.25, protect: 0.9, pushy: 0.2, riverRaise: 0.04,
  },
  lag: {
    slow: 0.08, draw: 0.9, cbetDry: 0.95, cbetWet: 0.8, barrel: 0.85, river: 0.5, stab: 0.9, probe: 0.7, semi: 0.55, raise: 0.26,
    float: 0.4, protect: 0.9, pushy: 0.2, riverRaise: 0.06,
  },
}

// ТАГ и ЛАГ: сила — против диапазонов соперников по их ходам; размер ставки — от текстуры; блефы — дро и
// руками без вскрытия, не дальше двух-трёх улиц; медленная игра и чек-рейз; защита банка по цене.
// Против каждого — по его чтению за вечер (botHud): кто всё уравнивает — без блефов и с вэлью тоньше,
// кто сдаётся — чаще давить, кто давит — шире ловить блефы
function strongPost(x: Spot, r: Random, lag: boolean): Intent {
  if (!x.holdem && !x.omaha) return abcPost(x, r)
  const g = x.omaha ? omahaReading(x, r) : holdemReading(x, r)
  const { eq, draw, versus } = g
  const p = PLAY[lag ? 'lag' : 'tag']
  const heads = x.rivals.length === 1
  const opp: Who = heads ? x.who(x.rivals[0]) : 'unknown'
  const prof = heads ? x.profile(x.rivals[0]) : PROFILES.unknown
  const folds = prof.folds
  const multi = 0.07 * (x.rivals.length - 1)
  const wet = wetBoard(x.board)
  const aggressor = lastAggressorBefore(x) === x.me
  const barrels = new Set(x.read.moves.filter((m) => m.street !== 'preflop' && m.id === x.me && m.aggressive).map((m) => m.street)).size
  const shallow = x.stack <= x.pot * 0.6
  const ip = x.rivals.every((id) => postflopOrder(x.read, id) < postflopOrder(x.read, x.me))
  // Омаха: натсы на ривере — проиграть нельзя: ставка в банк и повышение до конца
  if (g.nuts && x.street === 'river') {
    if (shallow) return ALLIN
    return x.toCall === 0 ? raiseTo(potBet(x, 1)) : commit(x, x.currentBet + x.pot + x.toCall)
  }
  if (x.toCall === 0) {
    // Вэлью — когда впереди той части диапазона, что уравняет; колл-станция уравнивает шире — ставка тоньше
    const thin = eq >= 0.3 ? versus(1) : 0
    // В омахе руки ближе по доле банка: на вэлью — чуть тоньше
    const value = (lag ? 0.47 : 0.48) + multi - (x.omaha ? 0.03 : 0)
    // Медленная игра — в холдеме; в омахе сильную руку догоняют чаще — ставка
    if (!x.omaha && eq >= 0.85 && x.street !== 'river' && heads && r() < p.slow) return CALL
    if (thin >= value) {
      if (shallow) return ALLIN
      const f = x.street === 'river' ? (eq >= 0.8 ? 0.75 : 0.5) + (opp === 'station' ? 0.25 : 0) : x.street === 'flop' && !wet ? 0.33 : 0.66
      return raiseTo(potBet(x, f))
    }
    // Дро — ставкой; в омахе дро здесь к натсам — чаще
    if (draw && r() < p.draw * (x.omaha ? 1.2 : 1) * Math.min(1, folds + 0.2)) return raiseTo(potBet(x, wet ? 0.66 : 0.5))
    if (x.street === 'flop' && aggressor && x.rivals.length <= 3) {
      // В омахе мокрый почти каждый флоп, а продолжение ставкой — всё равно частое
      const many = heads ? 1 : x.rivals.length === 2 ? 0.7 : 0.45
      const cbet = (wet ? p.cbetWet : p.cbetDry) * Math.min(1.2, folds) * many * (x.omaha ? 1.2 : 1)
      if (r() < cbet) return raiseTo(potBet(x, wet ? 0.66 : 0.33))
    }
    if (heads && thin < value && barrels >= 1 && x.street === 'turn' && aggressor && r() < p.barrel * prof.barrel) {
      return raiseTo(potBet(x, 0.66))
    }
    if (heads && eq < 0.25 && x.street === 'river' && barrels <= 2 && r() < p.river * folds * (barrels >= 2 ? 0.6 : 1)) {
      // Против тех, кто сдаётся на крупное, — в банк
      return raiseTo(potBet(x, folds >= 1.2 ? 1 : 0.75))
    }
    // Все прочекали до меня последним — забрать банк
    const checkedTo = x.read.moves.filter((m) => m.street === x.street).every((m) => m.type === 'check')
    // Ставил прошлую улицу, а теперь прочекал — сдался: забрать банк
    const gaveUp = heads && checkedTo && x.street !== 'flop' && lastAggressorBefore(x) === x.rivals[0]
    if (gaveUp && ip && r() < p.stab * Math.min(1, folds)) return raiseTo(potBet(x, 0.6))
    if (heads && checkedTo && ip && barrels === 0 && eq < 0.45 && r() < p.probe * folds) return raiseTo(potBet(x, 0.5))
    // Прошлую улицу все прочекали — ставка первым и без позиции: банк ничей
    const nobody = x.street !== 'flop' && lastAggressorBefore(x) === null
    if (heads && checkedTo && nobody && r() < p.probe * Math.min(1.2, folds)) return raiseTo(potBet(x, 0.5))
    // Втроём все прочекали ко мне последним — ставка реже
    if (x.rivals.length === 2 && checkedTo && ip && x.street !== 'river' && r() < p.probe * 0.5 * Math.min(1, folds)) {
      return raiseTo(potBet(x, 0.5))
    }
    return CALL
  }
  // Ставка против меня: повышение на вэлью — когда впереди того, что продолжит против повышения
  const b = x.toCall / Math.max(1, x.pot - x.toCall)
  const strongEnough = eq >= 0.55 && versus(0.6) >= (x.street === 'river' ? 0.6 : 0.55) + multi
  if (eq >= 0.85 + multi || strongEnough) {
    // Иногда пусть маньяк ставит дальше
    if (opp === 'maniac' && x.street !== 'river' && r() < 0.2) return CALL
    if (shallow) return ALLIN
    return commit(x, x.currentBet + 0.8 * (x.pot + x.toCall))
  }
  // Полу-блеф повышением с дро; в омахе дро здесь — к натсам («обёртка», старший флеш): чаще и не только
  // один на один
  const semi = p.semi * (x.omaha ? 1.5 : 1)
  if (draw && (heads || x.omaha) && x.level === 1 && r() < semi * folds) return commit(x, x.currentBet + 0.8 * (x.pot + x.toCall))
  // Крепкая, но не лучшая рука на одиночную ставку — часто повышением, а не коллом: защита от дро и вэлью
  // (на ривере — только впереди большей части диапазона)
  // Против того, кто давит без руки (маньяк, AF > 3 за вечер), — повышать тоньше: он и уравнивает, и
  // ре-рейзит шире; против того, кто ставит почти только с рукой (ABC, нит), — строже
  const pushy = prof.defend >= 1.1
  const honest = prof.defend < 0.5 ? 0.1 : 0
  const protectAt = (x.street === 'river' ? 0.75 : 0.6) + multi + honest - (pushy ? p.pushy : 0)
  if (x.level === 1 && eq >= protectAt && r() < p.protect) return commit(x, x.currentBet + 0.8 * (x.pot + x.toCall))
  // Блеф-повышение на ривере — против тех, кто сдаётся
  if (heads && x.street === 'river' && x.level === 1 && eq < 0.15 && r() < p.riverRaise * folds) return commit(x, x.currentBet + 0.8 * (x.pot + x.toCall))
  // Продолжение ставкой соперника на флопе и одиночная ставка до ривера — иногда рейз без руки (без позиции —
  // чек-рейз): чаще против тех, кто на повышение сдаётся
  const cbet = x.street === 'flop' && heads && x.level === 1 && lastAggressorBefore(x) === x.rivals[0]
  const single = heads && x.level === 1 && x.street !== 'river'
  if (single && eq < 0.35 && r() < p.raise * folds) return commit(x, x.currentBet + 0.8 * (x.pot + x.toCall))
  // В позиции против продолжения ставкой — уравнять с любой долей, чтобы забрать банк, когда он сдастся;
  // а то и повысить: часто продолжающий ставкой (CB за вечер) ставит и без руки
  if (cbet && ip && eq >= 0.25 && x.price <= 0.3 && folds >= 1) {
    const cb = x.rival(x.rivals[0]).cb
    return r() < p.float * (cb !== null && cb >= 0.75 ? 1.3 : 1) ? commit(x, x.currentBet + 0.8 * (x.pot + x.toCall)) : CALL
  }
  // Колл — по цене банка; до ривера без позиции долю банка добрать труднее; в омахе доля банка до ривера
  // обманчива (руки близки, догоняют чаще) — запас больше
  const margin = x.street === 'river' ? 0 : (draw ? -0.04 : 0) + (ip ? 0.02 : 0.06) + (heads ? 0 : 0.03) + (x.omaha ? 0.1 : 0)
  if (eq >= x.price + margin) return CALL
  // Защита банка: лучшая часть своего диапазона, что бьёт блефы, — с частотой 1 − ставка / (банк + ставка)
  // Продолжение ставкой на флопе у любого стиля широкое — защита там не меньше 0,75 от равновесной
  if (heads && eq >= (x.street === 'river' ? 0.08 : 0.28)) {
    // В омахе блефов меньше: ставят чаще с рукой или с дро — защита реже
    const defend = (1 / (1 + b)) * (cbet ? Math.max(0.75, prof.defend) : prof.defend) * (x.omaha ? 0.85 : 1)
    if (g.ownRank() >= 1 - defend) return CALL
  }
  return FOLD
}

// Что сильный знает о раздаче после флопа: доля банка против диапазонов соперников, против их верхней части
// (versus — та часть, что продолжит против ставки), дро, натсы (омаха, ривер) и место своей руки в своём диапазоне
type Reading = { eq: number; draw: boolean; nuts: boolean; versus: (share: number) => number; ownRank: () => number }

function holdemReading(x: Spot, r: Random): Reading {
  const ranges = x.rivals.map((id) => rangeOf(x.read, id, x.who(id), x.board, x.known))
  const eq = equityVs(x.own, x.board, ranges, r, BOT_SAMPLES * 2)
  const d = drawOf(x.own[0], x.own[1], x.board)
  return {
    eq,
    draw: (d.flush || d.straight === 2) && x.street !== 'river',
    nuts: false,
    versus: (share) =>
      equityVs(
        x.own,
        x.board,
        ranges.map((w, i) => topOfRange(w, x.board, Math.min(1, x.profile(x.rivals[i]).calls * share))),
        r,
        BOT_SAMPLES * 2,
      ),
    ownRank: () => ownRank(x),
  }
}

// Омаха: диапазоны — выборкой рук (botOmaha), сила — по правилу «ровно две из руки и три со стола»
function omahaReading(x: Spot, r: Random): Reading {
  const dead = x.known.slice(x.own.length + x.board.length)
  const ranges = x.rivals.map((id) => omahaRangeOf(x.read, id, x.who(id), x.board, x.known, r))
  const eq = omahaEquityVs(x.own, x.board, ranges, dead, r, BOT_SAMPLES * 2)
  const d = omahaDraw(x.own, x.board)
  return {
    eq,
    // Давят дро к старшему флешу и стриту от 8 карт («обёртка»): второй флеш в омахе часто проигрывает
    draw: (d.nutFlush || d.straight === 2) && x.street !== 'river',
    nuts: x.street === 'river' && omahaBoardRank(x.own, x.board, dead).nuts,
    versus: (share) =>
      omahaEquityVs(
        x.own,
        x.board,
        ranges.map((w, i) => omahaTopOfRange(w, Math.min(1, x.profile(x.rivals[i]).calls * share))),
        dead,
        r,
        BOT_SAMPLES * 2,
      ),
    ownRank: () => omahaRankInRange(omahaRangeOf(x.read, x.me, x.style, x.board, [...x.board, ...dead], r, x.own)),
  }
}

// Место своей руки в своём диапазоне — каким его видят соперники по моим ходам (0 — слабейшая, 1 — сильнейшая)
function ownRank(x: Spot): number {
  const known = [...x.board, ...x.known.slice(x.own.length + x.board.length)]
  const w = rangeOf(x.read, x.me, x.style, x.board, known)
  const i = comboIndex(x.own[0], x.own[1])
  if (w[i] <= 0) w[i] = 1e-3
  const q = quantiles(w, boardInfo(x.board))
  return q ? q[i] : 0.5
}

// Мокрый стол: две и больше одной масти на флопе, или три карты в окне из пяти рангов
function wetBoard(board: Card[]): boolean {
  const flop = board.slice(0, 3)
  const suits = new Set(flop.map((c) => c[1]))
  if (suits.size <= 2) return true
  const ranks = flop.map((c) => '23456789TJQKA'.indexOf(c[0])).sort((a, b) => a - b)
  return ranks[2] - ranks[0] <= 4 && new Set(ranks).size === 3
}

const POSTFLOP: Record<BotStyle, (x: Spot, r: Random) => Intent> = {
  maniac: maniacPost,
  station: stationPost,
  nit: nitPost,
  abc: abcPost,
  tag: (x, r) => strongPost(x, r, false),
  lag: (x, r) => strongPost(x, r, true),
}

// Намерение — в допустимый ход по кнопкам хода (actionsView): пас при возможном чеке — чек;
// повысить нельзя — олл-ин, если он есть, иначе колл; сумма — в пределах от минимума до максимума
function toAction(a: ActionsView, intent: Intent): BetAction {
  const passive: BetAction = a.check ? { type: 'check' } : { type: 'call' }
  if (intent.kind === 'fold') return a.check ? { type: 'check' } : { type: 'fold' }
  if (intent.kind === 'call') return passive
  const r = a.raise
  if (!r) return a.allIn !== null ? { type: 'allin' } : passive
  const to = Math.min(r.max, Math.max(r.min, Math.round(Math.min(intent.to, r.max))))
  return to === r.max && r.allIn ? { type: 'allin' } : { type: 'raise', to }
}

const RANKS = '23456789TJQKA'
const rankOf = (c: Card) => RANKS.indexOf(c[0]) + 2

// Сила руки до флопа по двум старшим картам — счёт Чена: старшая карта, пара, одной масти, разрыв;
// 0 — 7-2 разной масти, 1 — пара тузов. Холдем — по таблице рук (botRanges), это — для прочих игр
export function preflopStrength(own: Card[]): number {
  const [c1, c2] = [...own].sort((p, q) => rankOf(q) - rankOf(p))
  const hi = rankOf(c1)
  const lo = rankOf(c2)
  const points = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2)
  let score: number
  if (hi === lo) score = Math.max(5, points(hi) * 2)
  else {
    const gap = hi - lo - 1
    score = points(hi) + (c1[1] === c2[1] ? 2 : 0) - (gap >= 4 ? 5 : [0, 1, 2, 4][gap])
    if (gap <= 1 && hi < 12) score += 1
  }
  return Math.min(1, Math.max(0, (Math.ceil(score) + 1) / 21))
}

// Доля банка против случайных рук rivals соперников: досдать стол и руки из остатка колоды BOT_SAMPLES раз
function equityVsRandom(variant: Variant, own: Card[], board: Card[], rivals: number, dead: Card[], random: Random): number {
  const n = Math.min(Math.max(1, rivals), MAX_RIVALS)
  const known = new Set([...own, ...board, ...dead])
  const rest = buildDeck(variant).filter((c) => !known.has(c))
  const needBoard = 5 - board.length
  const need = needBoard + n * own.length
  if (need > rest.length) return 0.5
  let share = 0
  for (let k = 0; k < BOT_SAMPLES; k++) {
    // Частичное тасование: первые need карт остатка — новые
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(random() * (rest.length - i))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    const full = [...board, ...rest.slice(0, needBoard)]
    const mine = handScore(variant, own, full)
    let tied = 1
    let lost = false
    for (let p = 0; p < n && !lost; p++) {
      const from = needBoard + p * own.length
      const d = mine - handScore(variant, rest.slice(from, from + own.length), full)
      if (d < 0) lost = true
      else if (d === 0) tied++
    }
    if (!lost) share += 1 / tied
  }
  return share / BOT_SAMPLES
}

function isCard(c: Card | null): c is Card {
  return typeof c === 'string'
}
