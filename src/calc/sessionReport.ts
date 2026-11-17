// Отчёт сессии (#263): после вечера — как отчёт покер-рума, только для «меня» — игрока этого телефона
// (EveningTable.me). Топ раздач в плюс и в минус, премиум-руки до флопа (только холдем) и накопленный итог
// в ББ по раздачам — для графика, с итогом вечера в bb/100 тем же подсчётом, что HUD (#241).
// Итог раздачи — тот же, что в «Итоге вечера» (handNet, #239): с записью — по её блайндам, живые карты —
// по блайндам стола (в турнире их нет — раздача не в счёт). ББ раздачи — свой у каждой: в турнире растут
import type { Card } from '../poker/cards'
import { formatChips, formatNumber, formatTenths, signedStackText } from './format'
import { handBlinds, type SavedHand } from './evenings'
import { handNet } from './handResult'
import { bestWorst, type HandOutcome } from './pokerAllTime'

// Премиум до флопа: пары AA–JJ и AK одной масти и разных
export type Premium = 'AA' | 'KK' | 'QQ' | 'JJ' | 'AKs' | 'AKo'

export function premiumOf(cards: Card[]): Premium | null {
  if (cards.length !== 2) return null
  const [a, b] = cards
  const ranks = [a[0], b[0]].sort().join('')
  if (a[0] === b[0]) return ['A', 'K', 'Q', 'J'].includes(a[0]) ? (`${a[0]}${a[0]}` as Premium) : null
  if (ranks !== 'AK') return null
  return a[1] === b[1] ? 'AKs' : 'AKo'
}

// hands — раздач холдема с моими картами; premium — из них премиум; net — их итог в сотых ББ
export type PremiumStat = { hands: number; premium: number; net: number }

// hands — моих раздач с итогом; best и worst — до трёх в плюс и в минус; premium — null, если холдема
// с моими картами не было; curve — накопленный итог в сотых ББ после каждой раздачи (по номеру), начиная с 0;
// net — итог вечера в сотых ББ (последняя точка curve)
export type SessionReport = {
  hands: number
  best: HandOutcome[]
  worst: HandOutcome[]
  premium: PremiumStat | null
  curve: number[]
  net: number
}

// По раздачам одного вечера. Меня в вечере нет (стол на одном телефоне) или моих раздач с итогом нет — null
export function sessionReport(records: SavedHand[]): SessionReport | null {
  const me = records.find((s) => s.table)?.table?.me ?? null
  if (me === null) return null
  const outcomes: HandOutcome[] = []
  const curve = [0]
  let net = 0
  let premium: PremiumStat | null = null
  for (const s of [...records].sort((a, b) => a.number - b.number)) {
    const h = s.hand
    const blinds = handBlinds(s)
    const bb = h.record?.bb ?? blinds?.bb ?? 0
    const chips = handNet(h, me, blinds)
    if (chips === null || !(bb > 0)) continue
    // В сотых ББ своей раздачи, целым — как HUD (addHand)
    const hundredths = Math.round((chips * 100) / bb)
    net += hundredths
    curve.push(net)
    outcomes.push({ evening: s.evening, code: s.code, startedAt: s.startedAt, number: s.number, chips, bb })
    // Премиум — только холдем с записью и моими картами; живые карты — нет
    if (h.record?.game?.id !== 'holdem' || !Array.isArray(s.mine) || s.mine.length !== 2) continue
    premium ??= { hands: 0, premium: 0, net: 0 }
    premium.hands++
    if (premiumOf(s.mine)) {
      premium.premium++
      premium.net += hundredths
    }
  }
  if (outcomes.length === 0) return null
  return { hands: outcomes.length, ...bestWorst(outcomes), premium, curve, net }
}

// Меньше стольких раздач — графика нет
export const CHART_MIN_HANDS = 10

// Сотые ББ → «+38 ББ», «−12,5 ББ», «0 ББ»
function bbText(hundredths: number): string {
  return signedStackText(hundredths, 100)
}

// Ломаная графика в своей системе координат: x — 0…width по раздачам, y — 0…height сверху вниз;
// zero — y нуля. Все точки на нуле — линия посередине
export type ChartView = { width: number; height: number; points: string; zero: number }

export const CHART_WIDTH = 100
export const CHART_HEIGHT = 40

export function chartView(curve: number[]): ChartView {
  const n = Math.max(1, curve.length - 1)
  const top = Math.max(0, ...curve)
  const bottom = Math.min(0, ...curve)
  const span = top - bottom
  const y = (v: number) => (span === 0 ? CHART_HEIGHT / 2 : ((top - v) / span) * CHART_HEIGHT)
  const round = (v: number) => Math.round(v * 100) / 100
  const points = curve.map((v, i) => `${round((i / n) * CHART_WIDTH)},${round(y(v))}`).join(' ')
  return { width: CHART_WIDTH, height: CHART_HEIGHT, points, zero: round(y(0)) }
}

// Раздача в топе: number — открыть её в истории; result — «+42,5 ББ · +425»
export type TopView = { number: number; plus: boolean; result: string }

// Показ отчёта: bb100 — «Итог вечера: +12,5 bb/100 · раздач 40 (+5 ББ)»; premium — строка или null (не холдем,
// своих карт нет); chart — null, если раздач меньше CHART_MIN_HANDS: тогда note — «мало раздач для графика»
export type SessionView = {
  best: TopView[]
  worst: TopView[]
  premium: string | null
  bb100: string
  chart: ChartView | null
  note: string | null
}

export function sessionView(r: SessionReport): SessionView {
  const top = (o: HandOutcome): TopView => ({
    number: o.number,
    plus: o.chips > 0,
    result: `${signedStackText(o.chips, o.bb)} · ${formatChips(o.chips, true)}`,
  })
  const few = r.hands < CHART_MIN_HANDS
  return {
    best: r.best.map(top),
    worst: r.worst.map(top),
    premium: r.premium && premiumText(r.premium),
    bb100: `Итог вечера: ${formatTenths(r.net / r.hands, true)} bb/100 · раздач ${formatNumber(r.hands)} (${bbText(r.net)})`,
    chart: few ? null : chartView(r.curve),
    note: few ? 'мало раздач для графика' : null,
  }
}

// «Премиум: 7 из 112 раздач (6 %), итог с них +38 ББ»; премиум не пришёл — без итога
function premiumText(p: PremiumStat): string {
  const of = p.hands % 10 === 1 && p.hands % 100 !== 11 ? 'раздачи' : 'раздач'
  const share = `Премиум: ${formatNumber(p.premium)} из ${formatNumber(p.hands)} ${of} (${Math.round((p.premium * 100) / p.hands)} %)`
  return p.premium > 0 ? `${share}, итог с них ${bbText(p.net)}` : share
}
