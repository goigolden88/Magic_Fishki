// Покер за всё время (#164, Р-55): HUD постоянного игрока по раздачам всех вечеров, сохранённых на этом
// телефоне (хранилище hands, Р-37, Р-54), — тем же подсчётом, что HUD вечера за столом (addHand).
// Игрок за столом — по имени постоянного; гость с тем же именем не в счёт: с Р-55 запись помнит
// постоянных стола (EveningTable.regulars), у записей до неё — только имя.
// Ещё (#197): 3-бет, WTSD, W$SD, bb/100 и лучшие и худшие раздачи — только по раздачам с записью
// (record, карты на телефонах): HUD стола (addHand) их не считает, а живым картам не хватает итога
import type { Regular } from '../model'
import type { Street } from '../poker/hand'
import { addHand, HUD_FEW_HANDS, type HudCounts, type HudHand } from '../poker/hud'
import type { HandRecord, HandResult } from '../poker/table'
import { eveningDay, eveningName, type Evening, type SavedHand } from './evenings'
import { formatBB, formatTenths } from './format'

const EMPTY: HudCounts = { hands: 0, vpip: 0, pfr: 0, stealChances: 0, steals: 0, cbChances: 0, cbs: 0, raises: 0, calls: 0 }

const KEYS = Object.keys(EMPTY) as (keyof HudCounts)[]

// Счётчики постоянного за все сохранённые раздачи; не играл — hands: 0
export function allTimeHud(regular: Regular, saved: SavedHand[]): HudCounts {
  const total = { ...EMPTY }
  for (const s of saved) {
    const hand = hudHand(s)
    if (!hand) continue
    const id = seatOf(regular, s, hand.seats)
    if (id === null) continue
    const c = addHand({}, hand)[id]
    if (c) for (const k of KEYS) total[k] += c[k]
  }
  return total
}

// Место постоянного в раздаче: имя совпало и это не гость. Записи до Р-55 гостя не помнят —
// двое с этим именем в одной раздаче там не различить, такая раздача не в счёт
function seatOf(regular: Regular, s: SavedHand, seats: { id: string; name?: string }[]): string | null {
  const regulars = s.table?.regulars
  const mine = seats.filter((seat) => seat.name === regular.name && (!regulars || regulars[seat.id] !== undefined))
  return mine.length === 1 ? mine[0].id : null
}

// Раздача для addHand из записи: с картами — из её записи (record); живые карты — из live, блайнды —
// стола вечера (в турнире — стартовые: точнее записи нет). Ни того, ни другого — не в счёт
function hudHand(s: SavedHand): (HudHand & { seats: { id: string; name: string }[] }) | null {
  const record = s.hand.record
  if (record && Array.isArray(record.seats) && Array.isArray(record.log)) {
    const rounds = record.game?.rounds
    return {
      seats: record.seats,
      button: record.button,
      bb: record.bb,
      log: record.log,
      ...(Array.isArray(rounds) ? { cards: { game: { rounds } } } : {}),
    }
  }
  const live = s.hand.live
  if (live && Array.isArray(live.seats) && Array.isArray(live.log)) {
    return { seats: live.seats, button: live.button, bb: s.table?.bb ?? 0, log: live.log }
  }
  return null
}

// Доля: сколько раз случилось (made) из скольких случаев (of)
export type Share = { made: number; of: number }

// Итог постоянного в одной раздаче: вечер и номер — открыть её в истории; chips — выплаты минус
// вложенное (с блайндами и анте), bb — большой блайнд этой раздачи
export type HandOutcome = { evening: string; code: string | null; startedAt: number; number: number; chips: number; bb: number }

export type AllTimeMore = {
  hands: number // раздач с записью (record), где он сидел
  threeBet: Share // перерейз до флопа из случаев: до него ровно один рейз чужой, и стека хватает на больше колла
  wtsd: Share // дошёл до вскрытия из раздач, где увидел флоп
  wsd: Share // взял хоть один банк из дошедших до вскрытия
  bb: number // сумма итогов в больших блайндах раздач; bb/100 — bb / hands × 100
  best: HandOutcome[] // до трёх раздач в плюсе, лучшая первой
  worst: HandOutcome[] // до трёх раздач в минусе, худшая первой
}

const TOP = 3

// По раздачам с записью; живые карты (без record) — не в счёт. Место постоянного — как у allTimeHud
export function allTimeMore(regular: Regular, saved: SavedHand[]): AllTimeMore {
  const out: AllTimeMore = {
    hands: 0,
    threeBet: { made: 0, of: 0 },
    wtsd: { made: 0, of: 0 },
    wsd: { made: 0, of: 0 },
    bb: 0,
    best: [],
    worst: [],
  }
  const outcomes: HandOutcome[] = []
  for (const s of saved) {
    const record = s.hand.record
    if (!record || !Array.isArray(record.seats) || !Array.isArray(record.log) || !(record.bb > 0)) continue
    const id = seatOf(regular, s, record.seats)
    if (id === null) continue
    // Запись с другого телефона и старых версий — без доверия к полям
    const payouts: Record<string, number> | undefined = s.hand.payouts
    const h = handStats(record, Array.isArray(s.hand.pots) ? s.hand.pots : [], id)
    const chips = handNet(record, payouts ?? {})[id] ?? 0
    out.hands++
    if (h.threeBetChance) {
      out.threeBet.of++
      if (h.threeBet) out.threeBet.made++
    }
    if (h.sawFlop) {
      out.wtsd.of++
      if (h.showdown) {
        out.wtsd.made++
        out.wsd.of++
        if (h.wonPot) out.wsd.made++
      }
    }
    out.bb += chips / record.bb
    outcomes.push({ evening: s.evening, code: s.code, startedAt: s.startedAt, number: s.number, chips, bb: record.bb })
  }
  // При равном итоге — позднее выше
  const later = (a: HandOutcome, b: HandOutcome) => b.startedAt - a.startedAt || b.number - a.number
  const inBB = (o: HandOutcome) => o.chips / o.bb
  out.best = outcomes
    .filter((o) => o.chips > 0)
    .sort((a, b) => inBB(b) - inBB(a) || later(a, b))
    .slice(0, TOP)
  out.worst = outcomes
    .filter((o) => o.chips < 0)
    .sort((a, b) => inBB(a) - inBB(b) || later(a, b))
    .slice(0, TOP)
  return out
}

// Чистый итог раздачи каждого места в фишках: выплаты минус вложенное. Вложенное — как у стола (hand.ts):
// анте, блайнды (в журнале ходов их нет — до первого хода ставка улицы и есть блайнд), на каждой улице —
// ставка после последнего хода; непокрытая часть самой большой ставки вернулась хозяину (closeBetting)
export function handNet(record: HandRecord, payouts: Record<string, number>): Record<string, number> {
  const put = invested(record)
  const out: Record<string, number> = {}
  for (const s of record.seats) out[s.id] = (payouts[s.id] ?? 0) - (put.get(s.id) ?? 0)
  return out
}

function invested(record: HandRecord): Map<string, number> {
  const seats = record.seats
  const n = seats.length
  const total = new Map(seats.map((s) => [s.id, 0]))
  const left = new Map(seats.map((s) => [s.id, s.chips])) // стек после анте — на блайнды
  const add = (id: string, amount: number) => total.set(id, (total.get(id) ?? 0) + amount)
  for (const e of record.log) {
    if (e.type !== 'ante') continue
    add(e.playerId, e.bet)
    left.set(e.playerId, (left.get(e.playerId) ?? 0) - e.bet)
  }
  // Ставка улицы по игрокам: блайнды — до флопа, затем — после каждого хода
  const bets = new Map<Street, Map<string, number>>()
  const betsOf = (street: Street): Map<string, number> => {
    const m = bets.get(street) ?? new Map<string, number>()
    bets.set(street, m)
    return m
  }
  const blind = (index: number, amount: number) => {
    const id = seats[index]?.id
    if (id !== undefined) betsOf('preflop').set(id, Math.max(0, Math.min(amount, left.get(id) ?? 0)))
  }
  if (n >= 2) {
    // Хедз-ап: кнопка ставит малый (startHand)
    const sb = n === 2 ? record.button : (record.button + 1) % n
    blind(sb, record.sb)
    blind((sb + 1) % n, record.bb)
  }
  const folded = new Set<string>()
  for (const e of record.log) {
    if (e.type === 'ante') continue
    betsOf(e.street).set(e.playerId, e.bet)
    if (e.type === 'fold') folded.add(e.playerId)
  }
  for (const m of bets.values()) for (const [id, bet] of m) add(id, bet)
  const [top, second] = [...total.entries()].sort((a, b) => b[1] - a[1])
  if (top && !folded.has(top[0])) total.set(top[0], Math.min(top[1], second?.[1] ?? 0))
  return total
}

type HandStats = { threeBetChance: boolean; threeBet: boolean; sawFlop: boolean; showdown: boolean; wonPot: boolean }

// 3-бет, флоп, вскрытие и банк у места id. «До флопа» и «флоп» — первый и второй круги торгов игры,
// рейз — как у HUD: рейз или олл-ин выше ставки круга
function handStats(record: HandRecord, pots: HandResult['pots'], id: string): HandStats {
  const rounds = record.game?.rounds
  const streets: Street[] = Array.isArray(rounds) ? rounds.map((r) => r.street) : ['preflop', 'flop', 'turn', 'river']
  const first = streets[0]
  const stack = record.seats.find((s) => s.id === id)?.chips ?? 0
  let ante = 0
  let toBeat = record.bb
  let raises = 0
  let raiser: string | null = null
  let threeBetChance = false
  let threeBet = false
  const foldedFirst = new Set<string>()
  const folded = new Set<string>()
  for (const e of record.log) {
    if (e.type === 'ante') {
      if (e.playerId === id) ante += e.bet
      continue
    }
    if (e.type === 'fold') {
      folded.add(e.playerId)
      if (e.street === first) foldedFirst.add(e.playerId)
    }
    if (e.street !== first) continue
    const isRaise = e.type === 'raise' || (e.type === 'allin' && e.bet > toBeat)
    // Случай 3-бета — раз за раздачу: первый ход против ровно одного чужого рейза
    if (e.playerId === id && !threeBetChance && raises === 1 && raiser !== id && stack - ante > toBeat) {
      threeBetChance = true
      threeBet = isRaise
    }
    toBeat = Math.max(toBeat, e.bet)
    if (isRaise) {
      raises++
      raiser = e.playerId
    }
  }
  const inFlop = record.seats.filter((s) => !foldedFirst.has(s.id)).length
  const inEnd = record.seats.filter((s) => !folded.has(s.id)).length
  // Вдвоём и больше после первого круга — флоп открыт (и при олл-ине — досдан)
  const sawFlop = streets.length > 1 && !foldedFirst.has(id) && inFlop >= 2
  const showdown = sawFlop && !folded.has(id) && inEnd >= 2
  const wonPot = showdown && pots.some((p) => Array.isArray(p.winners) && p.winners.includes(id))
  return { threeBetChance, threeBet, sawFlop, showdown, wonPot }
}

// Доля на экране: проценты — целые, случаев не было — null; мало случаев — few, как у HUD
export type ShareView = { pct: number | null; of: number; few: boolean }

// Раздача в «лучших» и «худших»: day — YYYY-MM-DD вечера, table — «Стол KQ7MZP», result — «+42,5 ББ»
export type OutcomeView = { evening: string; number: number; day: string; table: string; result: string }

export type MoreView = {
  hands: number // «по N раздачам с ходами»
  threeBet: ShareView
  wtsd: ShareView
  wsd: ShareView
  bb100: { text: string; few: boolean; sign: number } // «+12,5»; sign — знак для цвета
  best: OutcomeView[]
  worst: OutcomeView[]
}

// Показ; раздач с записью нет — null: ни нулей, ни деления на ноль
export function moreView(m: AllTimeMore): MoreView | null {
  if (m.hands === 0) return null
  const share = (s: Share): ShareView => ({
    pct: s.of > 0 ? Math.round((s.made / s.of) * 100) : null,
    of: s.of,
    few: s.of < HUD_FEW_HANDS,
  })
  const per100 = Math.round((m.bb / m.hands) * 1000) / 10
  return {
    hands: m.hands,
    threeBet: share(m.threeBet),
    wtsd: share(m.wtsd),
    wsd: share(m.wsd),
    bb100: { text: formatTenths(per100, true), few: m.hands < HUD_FEW_HANDS, sign: Math.sign(per100) },
    best: m.best.map(outcomeView),
    worst: m.worst.map(outcomeView),
  }
}

function outcomeView(o: HandOutcome): OutcomeView {
  const evening: Evening = { id: o.evening, code: o.code, startedAt: o.startedAt }
  return {
    evening: o.evening,
    number: o.number,
    day: eveningDay(evening),
    table: eveningName(evening),
    result: `${o.chips > 0 ? '+' : ''}${formatBB(o.chips, o.bb)}`,
  }
}
