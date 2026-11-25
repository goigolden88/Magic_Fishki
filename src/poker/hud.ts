// HUD вечера (#79, Р-32): счётчики игрока за этим столом — по ходам раздачи (журнал hand.log),
// карты не нужны. Лежат в столе по игроку и прибавляются в конце каждой раздачи (addHand):
// запись комнаты с раздачами не растёт. Определения — как в прототипе (prototype/poker/src/poker/stats.js):
// VPIP — раздач, где игрок добровольно вложил фишки до флопа (колл, рейз, олл-ин; блайнд не в счёт);
// PFR — раздач с рейзом до флопа; AF — рейзы (и ставки) / коллы за все улицы;
// ATS — из BTN, CO, SB (хедз-ап — только кнопка, она же SB), когда до игрока рейза не было: сколько раз
// открылся рейзом; CB — агрессор до флопа, торговавшийся на флопе: сколько раз поставил или повысил там.
// «До флопа» — первый круг торгов по описанию игры, «флоп» — второй.
// Ещё (#241) — по ходам и итогу раздачи (HudEnd):
// 3-бет — до флопа перед ходом игрока было ровно одно повышение, чужое (колл после него не мешает —
// сквиз тоже 3-бет): сколько раз повысил из скольких таких случаев; случай — один за раздачу, первый;
// фолд на 3-бет — игрок открыл повышением, получил 3-бет (перед его ходом повышений ровно два): сколько
// раз сбросил из скольких; WTSD — из раздач, где игрок увидел флоп (вдвоём и больше после первого круга,
// и олл-ин до флопа тоже), сколько дошёл до вскрытия (не сбросил, и не сбросивших двое и больше);
// W$SD — из дошедших до вскрытия, сколько взял банк или его часть; bb/100 — итог игрока в больших
// блайндах на 100 раздач, со знаком: ББ — свой у каждой раздачи, итог копится целым в сотых ББ
import type { Hand, HandLogEntry, Street } from './hand'

// Поля #241 необязательны: у столов до него и от старого сервера их нет — с нуля (EMPTY_HUD), а экран
// показывает «—», пока случаев нет
export type HudCounts = {
  hands: number // сдан в раздаче
  vpip: number
  pfr: number
  stealChances: number // ATS: мог украсть блайнды
  steals: number // и открылся рейзом
  cbChances: number // CB: агрессор до флопа торговался на флопе
  cbs: number // и поставил или повысил
  raises: number // ставки и рейзы на всех улицах (олл-ин выше ставки круга — тоже)
  calls: number // коллы на всех улицах (олл-ин в пределах уравнивания — тоже)
  threeBetChances?: number // 3-бет: перед ходом до флопа — ровно одно чужое повышение
  threeBets?: number // и повысил
  foldTo3BetChances?: number // открыл повышением и получил 3-бет
  foldsTo3Bet?: number // и сбросил
  flops?: number // WTSD: увидел флоп
  showdowns?: number // и дошёл до вскрытия
  showdownWins?: number // W$SD: дошёл до вскрытия и взял банк или его часть
  netHands?: number // bb/100: раздач с итогом
  net?: number // итог этих раздач в сотых ББ своей раздачи, со знаком
}

// Счётчики по игрокам; у столов до #79 поля нет — с нуля
export type Hud = Record<string, HudCounts>

// Меньше стольких раздач — «мало раздач»: цифрам рано верить
export const HUD_FEW_HANDS = 30

export const EMPTY_HUD: Required<HudCounts> = {
  hands: 0,
  vpip: 0,
  pfr: 0,
  stealChances: 0,
  steals: 0,
  cbChances: 0,
  cbs: 0,
  raises: 0,
  calls: 0,
  threeBetChances: 0,
  threeBets: 0,
  foldTo3BetChances: 0,
  foldsTo3Bet: 0,
  flops: 0,
  showdowns: 0,
  showdownWins: 0,
  netHands: 0,
  net: 0,
}

// Чем раздача кончилась: won — взявшие банк или его часть; net — итог в фишках (выплаты минус
// вложенное) у тех, чей итог известен: нет игрока — его раздача в bb/100 не идёт
export type HudEnd = { won: string[]; net: Record<string, number> }

// Что addHand читает из раздачи: идущая раздача стола (Hand) подходит целиком; сохранённую раздачу
// прошлого вечера собирают из её записи (покер за всё время, #164)
export type HudHand = Pick<Hand, 'button' | 'bb'> & {
  seats: { id: string }[]
  log: HandLogEntry[]
  cards?: { game: { rounds: { street: Street }[] } }
}

// Счётчики после конца раздачи: прежние плюс эта. Чистая — прежние не меняет
export function addHand(hud: Hud, hand: HudHand, end: HudEnd): Hud {
  const streets: Street[] = hand.cards ? hand.cards.game.rounds.map((r) => r.street) : ['preflop', 'flop']
  const [first, second] = streets
  const n = hand.seats.length
  const counts = new Map(hand.seats.map((s) => [s.id, { ...EMPTY_HUD, ...hud[s.id] }]))
  const steal = new Set(hand.seats.filter((_, i) => stealSeat((i - hand.button + n) % n, n)).map((s) => s.id))
  const vpip = new Set<string>()
  const pfr = new Set<string>()
  const actedFirst = new Set<string>() // уже ходили до флопа
  const threeBetSeen = new Set<string>() // случай 3-бета уже был
  const foldedFirst = new Set<string>() // сбросили до флопа
  const folded = new Set<string>() // сбросили за раздачу
  let street: Street = first
  let toBeat = hand.bb // ставка круга перед ходом: до флопа — большой блайнд
  let raises = 0 // повышений до флопа
  let opener: string | null = null // первый повысивший до флопа
  let foldTo3BetSeen = false // открывший уже ходил против 3-бета
  let aggressor: string | null = null // последний, кто повысил до флопа
  let cbChance = false
  let cb = false
  for (const e of hand.log) {
    if (e.type === 'ante') continue
    if (e.street !== street) {
      street = e.street
      toBeat = 0
    }
    // Страддл (#222) и BB вслепую вернувшегося (#323) — как блайнд: поднимают ставку круга, но не вход, не рейз
    // и не первый ход
    if (e.type === 'straddle' || e.type === 'post') {
      toBeat = Math.max(toBeat, e.bet)
      continue
    }
    const c = counts.get(e.playerId)
    if (!c) continue
    const isRaise = e.type === 'raise' || (e.type === 'allin' && e.bet > toBeat)
    const isCall = e.type === 'call' || (e.type === 'allin' && !isRaise)
    toBeat = Math.max(toBeat, e.bet)
    if (isRaise) c.raises++
    if (isCall) c.calls++
    if (e.type === 'fold') {
      folded.add(e.playerId)
      if (street === first) foldedFirst.add(e.playerId)
    }
    if (street === first) {
      if (isRaise || isCall) vpip.add(e.playerId)
      if (isRaise) pfr.add(e.playerId)
      if (!actedFirst.has(e.playerId)) {
        actedFirst.add(e.playerId)
        if (raises === 0 && steal.has(e.playerId)) {
          c.stealChances++
          if (isRaise) c.steals++
        }
      }
      // Счётчики #241 — по числу повышений до этого хода
      if (raises === 1 && e.playerId !== aggressor && !threeBetSeen.has(e.playerId)) {
        threeBetSeen.add(e.playerId)
        c.threeBetChances++
        if (isRaise) c.threeBets++
      }
      if (raises === 2 && e.playerId === opener && !foldTo3BetSeen) {
        foldTo3BetSeen = true
        c.foldTo3BetChances++
        if (e.type === 'fold') c.foldsTo3Bet++
      }
      if (isRaise) {
        raises++
        if (raises === 1) opener = e.playerId
        aggressor = e.playerId
      }
    } else if (street === second && e.playerId === aggressor) {
      cbChance = true
      if (isRaise) cb = true
    }
  }
  // Флоп открыт — после первого круга не сбросивших двое и больше (олл-ин до флопа — тоже);
  // вскрытие — к концу раздачи не сбросивших двое и больше. Игра в один круг торгов флопа не знает
  const left = (out: Set<string>) => hand.seats.filter((s) => !out.has(s.id)).length
  const flopOpen = streets.length > 1 && left(foldedFirst) >= 2
  const showdown = left(folded) >= 2
  const won = new Set(end.won)
  const out: Hud = { ...hud }
  for (const [id, c] of counts) {
    c.hands++
    if (vpip.has(id)) c.vpip++
    if (pfr.has(id)) c.pfr++
    if (id === aggressor && cbChance) {
      c.cbChances++
      if (cb) c.cbs++
    }
    if (flopOpen && !foldedFirst.has(id)) {
      c.flops++
      if (showdown && !folded.has(id)) {
        c.showdowns++
        if (won.has(id)) c.showdownWins++
      }
    }
    const net = end.net[id]
    if (net !== undefined && hand.bb > 0) {
      c.netHands++
      c.net += Math.round((net * 100) / hand.bb)
    }
    out[id] = c
  }
  return out
}

// Место крадёт блайнды (ATS) — по месту от кнопки rel из n сданных, по подписям позиций экрана
// (positionLabels): BTN, SB и CO, без BB; хедз-ап — только кнопка (она же SB). CO — с пяти сданных
export function stealSeat(rel: number, n: number): boolean {
  if (n === 2) return rel === 0
  return rel === 0 || rel === 1 || (n >= 5 && rel === n - 1)
}
