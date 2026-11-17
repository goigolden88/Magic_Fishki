// Покер за всё время (#164, Р-55): HUD постоянного игрока по раздачам всех вечеров, сохранённых на этом
// телефоне (хранилище hands, Р-37, Р-54), — тем же подсчётом, что HUD вечера за столом (addHand).
// Игрок за столом — по имени постоянного; гость с тем же именем не в счёт: с Р-55 запись помнит
// постоянных стола (EveningTable.regulars), у записей до неё — только имя.
// 3-бет, фолд на 3-бет, WTSD, W$SD и bb/100 (#241) — тоже addHand: итог раздачи — по её выплатам и банкам
// (handNet из handResult.ts); у живых карт блайнды — стола вечера, в турнире их нет — раздача в bb/100 не идёт.
// Лучшие и худшие раздачи (#197) — только по раздачам с записью (record, карты на телефонах)
import type { Regular } from '../model'
import { addHand, EMPTY_HUD, type HudCounts, type HudHand } from '../poker/hud'
import type { HandRecord } from '../poker/table'
import { eveningDay, eveningName, type Evening, type SavedHand } from './evenings'
import { formatBB } from './format'
import { handNet as netOf } from './handResult'
import { invested } from './invested'

const KEYS = Object.keys(EMPTY_HUD) as (keyof HudCounts)[]

// Счётчики постоянного за все сохранённые раздачи; не играл — hands: 0
export function allTimeHud(regular: Regular, saved: SavedHand[]): Required<HudCounts> {
  const total = { ...EMPTY_HUD }
  for (const s of saved) {
    const hand = hudHand(s)
    if (!hand) continue
    const id = seatOf(regular, s, hand.seats)
    if (id === null) continue
    const c = addHand({}, hand, handEnd(s, id))[id]
    if (c) for (const k of KEYS) total[k] += c[k] ?? 0
  }
  return total
}

// Итог раздачи для addHand: взявшие банк — по банкам записи; итог — только у постоянного, и если блайнды известны.
// Запись с другого телефона и старых версий — без доверия к полям
function handEnd(s: SavedHand, id: string): { won: string[]; net: Record<string, number> } {
  const pots = Array.isArray(s.hand.pots) ? s.hand.pots : []
  const won = pots.flatMap((p) => (Array.isArray(p.winners) ? p.winners : []))
  const blinds = s.table && !s.table.tournament ? { sb: s.table.sb, bb: s.table.bb } : null
  const net = s.hand.payouts && typeof s.hand.payouts === 'object' ? netOf({ ...s.hand, pots }, id, blinds) : null
  return { won, net: net === null ? {} : { [id]: net } }
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

// Итог постоянного в одной раздаче: вечер и номер — открыть её в истории; chips — выплаты минус
// вложенное (с блайндами и анте), bb — большой блайнд этой раздачи
export type HandOutcome = { evening: string; code: string | null; startedAt: number; number: number; chips: number; bb: number }

// 3-бет, WTSD, W$SD и bb/100 этой сводки (#197) с #241 считает HUD (allTimeHud) — здесь только раздачи
export type AllTimeMore = {
  hands: number // раздач с записью (record), где он сидел
  best: HandOutcome[] // до трёх раздач в плюсе, лучшая первой
  worst: HandOutcome[] // до трёх раздач в минусе, худшая первой
}

const TOP = 3

// По раздачам с записью; живые карты (без record) — не в счёт. Место постоянного — как у allTimeHud
export function allTimeMore(regular: Regular, saved: SavedHand[]): AllTimeMore {
  const out: AllTimeMore = { hands: 0, best: [], worst: [] }
  const outcomes: HandOutcome[] = []
  for (const s of saved) {
    const record = s.hand.record
    if (!record || !Array.isArray(record.seats) || !Array.isArray(record.log) || !(record.bb > 0)) continue
    const id = seatOf(regular, s, record.seats)
    if (id === null) continue
    // Запись с другого телефона и старых версий — без доверия к полям
    const payouts: Record<string, number> | undefined = s.hand.payouts
    const chips = handNet(record, payouts ?? {})[id] ?? 0
    out.hands++
    outcomes.push({ evening: s.evening, code: s.code, startedAt: s.startedAt, number: s.number, chips, bb: record.bb })
  }
  return { ...out, ...bestWorst(outcomes) }
}

// До трёх раздач в плюсе и в минусе — по итогу в ББ; при равном итоге — позднее выше.
// Общее с отчётом сессии (#263): там — раздачи одного вечера и мои
export function bestWorst(outcomes: HandOutcome[]): { best: HandOutcome[]; worst: HandOutcome[] } {
  const later = (a: HandOutcome, b: HandOutcome) => b.startedAt - a.startedAt || b.number - a.number
  const inBB = (o: HandOutcome) => o.chips / o.bb
  return {
    best: outcomes
      .filter((o) => o.chips > 0)
      .sort((a, b) => inBB(b) - inBB(a) || later(a, b))
      .slice(0, TOP),
    worst: outcomes
      .filter((o) => o.chips < 0)
      .sort((a, b) => inBB(a) - inBB(b) || later(a, b))
      .slice(0, TOP),
  }
}

// Чистый итог раздачи каждого места в фишках: выплаты минус вложенное (invested — общее с кулером, #262)
export function handNet(record: HandRecord, payouts: Record<string, number>): Record<string, number> {
  const put = invested(record)
  const out: Record<string, number> = {}
  for (const s of record.seats) out[s.id] = (payouts[s.id] ?? 0) - (put.get(s.id) ?? 0)
  return out
}

// Раздача в «лучших» и «худших»: day — YYYY-MM-DD вечера, table — «Стол KQ7MZP», result — «+42,5 ББ»
export type OutcomeView = { evening: string; number: number; day: string; table: string; result: string }

export type MoreView = {
  best: OutcomeView[]
  worst: OutcomeView[]
}

// Показ; раздач с записью нет — null
export function moreView(m: AllTimeMore): MoreView | null {
  if (m.hands === 0) return null
  return {
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
