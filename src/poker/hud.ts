// HUD вечера (#79, Р-32): счётчики игрока за этим столом — по ходам раздачи (журнал hand.log),
// карты не нужны. Лежат в столе по игроку и прибавляются в конце каждой раздачи (addHand):
// запись комнаты с раздачами не растёт. Определения — как в прототипе (prototype/poker/src/poker/stats.js):
// VPIP — раздач, где игрок добровольно вложил фишки до флопа (колл, рейз, олл-ин; блайнд не в счёт);
// PFR — раздач с рейзом до флопа; AF — рейзы (и ставки) / коллы за все улицы;
// ATS — из BTN, CO, SB (хедз-ап — только кнопка, она же SB), когда до игрока рейза не было: сколько раз
// открылся рейзом; CB — агрессор до флопа, торговавшийся на флопе: сколько раз поставил или повысил там.
// «До флопа» — первый круг торгов по описанию игры, «флоп» — второй
import type { Hand, Street } from './hand'

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
}

// Счётчики по игрокам; у столов до #79 поля нет — с нуля
export type Hud = Record<string, HudCounts>

// Меньше стольких раздач — «мало раздач»: цифрам рано верить
export const HUD_FEW_HANDS = 30

const EMPTY: HudCounts = { hands: 0, vpip: 0, pfr: 0, stealChances: 0, steals: 0, cbChances: 0, cbs: 0, raises: 0, calls: 0 }

// Счётчики после конца раздачи: прежние плюс эта. Чистая — прежние не меняет
export function addHand(hud: Hud, hand: Hand): Hud {
  const streets = hand.cards ? hand.cards.game.rounds.map((r) => r.street) : (['preflop', 'flop'] as Street[])
  const [first, second] = streets
  const n = hand.seats.length
  const counts = new Map(hand.seats.map((s) => [s.id, { ...EMPTY, ...hud[s.id] }]))
  const steal = new Set(hand.seats.filter((_, i) => stealSeat((i - hand.button + n) % n, n)).map((s) => s.id))
  const vpip = new Set<string>()
  const pfr = new Set<string>()
  const actedFirst = new Set<string>() // уже ходили до флопа
  let street: Street = first
  let toBeat = hand.bb // ставка круга перед ходом: до флопа — большой блайнд
  let raised = false // до флопа уже был рейз
  let aggressor: string | null = null // последний, кто повысил до флопа
  let cbChance = false
  let cb = false
  for (const e of hand.log) {
    if (e.type === 'ante') continue
    if (e.street !== street) {
      street = e.street
      toBeat = 0
    }
    const c = counts.get(e.playerId)
    if (!c) continue
    const isRaise = e.type === 'raise' || (e.type === 'allin' && e.bet > toBeat)
    const isCall = e.type === 'call' || (e.type === 'allin' && !isRaise)
    toBeat = Math.max(toBeat, e.bet)
    if (isRaise) c.raises++
    if (isCall) c.calls++
    if (street === first) {
      if (isRaise || isCall) vpip.add(e.playerId)
      if (isRaise) pfr.add(e.playerId)
      if (!actedFirst.has(e.playerId)) {
        actedFirst.add(e.playerId)
        if (!raised && steal.has(e.playerId)) {
          c.stealChances++
          if (isRaise) c.steals++
        }
      }
      if (isRaise) {
        raised = true
        aggressor = e.playerId
      }
    } else if (street === second && e.playerId === aggressor) {
      cbChance = true
      if (isRaise) cb = true
    }
  }
  const out: Hud = { ...hud }
  for (const [id, c] of counts) {
    c.hands++
    if (vpip.has(id)) c.vpip++
    if (pfr.has(id)) c.pfr++
    if (id === aggressor && cbChance) {
      c.cbChances++
      if (cb) c.cbs++
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
