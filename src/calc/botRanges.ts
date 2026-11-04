// Диапазоны ботов покера (#139, Р-45): стартовые руки холдема по силе — своей таблицей в коде, без солверов.
// Рука до флопа — «верхняя доля»: какая часть всех 1326 сочетаний не хуже её (тузы — 0,005, 7-2 разной
// масти — 1). Диапазон «верхние 20 %» — руки с долей не больше 0,2. Ширина диапазона по позиции и стилю —
// таблицами ниже. Только холдем: омаха — отдельная задача
import { buildDeck, HOLDEM, type Card } from '../poker/cards'

// Стили ботов: маньяк, колл-станция, нит («Новичок»), ABC («Любитель»), ТАГ и ЛАГ («Сильный»)
export type BotStyle = 'maniac' | 'station' | 'nit' | 'abc' | 'tag' | 'lag'
// Соперник глазами бота: бот — по стилю (подпись видна всем за столом), человек — «неизвестный»
export type Who = BotStyle | 'unknown'

// 169 классов рук от сильных к слабым: пары, одномастные (s) и разномастные (o) — порядок в духе таблиц
// открытия на 6 мест: силы и играбельности (одномастные и связанные — выше)
export const HAND_ORDER = (
  'AA KK QQ JJ AKs AQs TT AKo AJs KQs ATs AQo 99 KJs KTs QJs AJo KQo 88 QTs ' +
  'A9s JTs ATo A8s KJo 77 A5s A7s K9s QJo A4s A6s A3s KTo Q9s T9s J9s 66 A2s A9o ' +
  'K8s QTo JTo 55 98s T8s K7s Q8s J8s 87s A8o K6s 44 K9o 97s 76s 33 K5s A7o 22 ' +
  'Q9o T7s J9o A5o 65s 86s K4s Q7s T9o A6o K3s A4o 54s 75s K2s J7s Q6s A3o 96s K8o ' +
  '64s Q5s 98o A2o T8o 85s J8o Q4s 53s Q3s 74s T6s Q2s K7o 87o J6s 43s 63s J5s Q8o ' +
  '95s 97o K6o J4s 76o T7o 52s 84s J3s 86o K5o 65o J2s T5s 42s T4s 73s K4o 54o 32s ' +
  'Q7o T3s 75o 94s J7o 62s K3o T2s 93s 96o 64o 83s 92s K2o Q6o 82s 53o 85o 72s Q5o ' +
  'T6o 43o Q4o 74o J6o Q3o 63o 95o J5o Q2o 52o J4o 84o 42o J3o T5o 73o J2o T4o 32o ' +
  '62o T3o 94o 93o T2o 83o 92o 82o 72o'
).split(' ')

const RANKS = '23456789TJQKA'
export const rankOf = (c: Card) => RANKS.indexOf(c[0]) + 2

// Класс руки: «AKs», «QJo», «77»
export function handClass(a: Card, b: Card): string {
  const [hi, lo] = rankOf(a) >= rankOf(b) ? [a, b] : [b, a]
  if (hi[0] === lo[0]) return hi[0] + lo[0]
  return hi[0] + lo[0] + (hi[1] === lo[1] ? 's' : 'o')
}

const combosOf = (cls: string) => (cls.length === 2 ? 6 : cls[2] === 's' ? 4 : 12)

// Верхняя доля класса — середина его сочетаний в общем ряду
const TOP = new Map<string, number>()
{
  let before = 0
  for (const cls of HAND_ORDER) {
    const k = combosOf(cls)
    TOP.set(cls, (before + k / 2) / 1326)
    before += k
  }
}

export function topShare(a: Card, b: Card): number {
  return TOP.get(handClass(a, b)) ?? 1
}

// Все 1326 рук холдема: карты, верхняя доля, одномастная ли
export type Combo = { a: Card; b: Card; top: number; suited: boolean }
export const COMBOS: Combo[] = []
// Номер руки по двум картам (в любом порядке)
const COMBO_INDEX = new Map<string, number>()
{
  const deck = buildDeck(HOLDEM)
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const a = deck[i]
      const b = deck[j]
      COMBO_INDEX.set(a + b, COMBOS.length)
      COMBO_INDEX.set(b + a, COMBOS.length)
      COMBOS.push({ a, b, top: topShare(a, b), suited: a[1] === b[1] })
    }
  }
}

export function comboIndex(a: Card, b: Card): number {
  return COMBO_INDEX.get(a + b) ?? -1
}

// Открытие первым (никто не вошёл): доля рук по числу игроков, что ходят после (1 — малый блайнд против
// большого, 2 — кнопка, 3 — CO, 4 — HJ, 5 — UTG); хедз-ап — шире всего. Колл-станция повышает редко —
// у неё это доля повышения, остальное она уравнивает (LIMP)
const OPEN: Record<Who, { by: number[]; hu: number }> = {
  maniac: { by: [0.75, 0.75, 0.62, 0.55, 0.5], hu: 0.9 },
  station: { by: [0.04, 0.04, 0.035, 0.03, 0.03], hu: 0.05 },
  nit: { by: [0.22, 0.24, 0.18, 0.15, 0.13], hu: 0.3 },
  abc: { by: [0.38, 0.45, 0.3, 0.23, 0.19], hu: 0.55 },
  tag: { by: [0.42, 0.45, 0.27, 0.19, 0.15], hu: 0.7 },
  lag: { by: [0.6, 0.66, 0.4, 0.3, 0.24], hu: 0.85 },
  unknown: { by: [0.4, 0.42, 0.27, 0.2, 0.16], hu: 0.6 },
}

export function openWidth(who: Who, behind: number, seats: number): number {
  const o = OPEN[who]
  if (seats === 2) return o.hu
  return o.by[Math.min(Math.max(behind, 1), 5) - 1]
}

// Ширины для чтения диапазона: вход уравниванием без повышения, колл повышения, 3-бет, 4-бет и выше
type Widths = { limp: number; call: number; bbCall: number; threeBet: number; fourBet: number; bluffs: number }
export const WIDTHS: Record<Who, Widths> = {
  maniac: { limp: 0.85, call: 0.6, bbCall: 0.7, threeBet: 0.3, fourBet: 0.15, bluffs: 0.5 },
  station: { limp: 0.55, call: 0.5, bbCall: 0.6, threeBet: 0.02, fourBet: 0.012, bluffs: 0 },
  nit: { limp: 0.1, call: 0.07, bbCall: 0.12, threeBet: 0.015, fourBet: 0.01, bluffs: 0 },
  abc: { limp: 0.3, call: 0.14, bbCall: 0.3, threeBet: 0.035, fourBet: 0.015, bluffs: 0.05 },
  tag: { limp: 0.3, call: 0.16, bbCall: 0.4, threeBet: 0.05, fourBet: 0.025, bluffs: 0.25 },
  lag: { limp: 0.35, call: 0.22, bbCall: 0.5, threeBet: 0.07, fourBet: 0.03, bluffs: 0.45 },
  unknown: { limp: 0.45, call: 0.2, bbCall: 0.4, threeBet: 0.06, fourBet: 0.03, bluffs: 0.2 },
}

// Вес руки в диапазоне «верхние width»: внутри — 1, за краем — плавно к нулю
export function inTop(top: number, width: number): number {
  if (top <= width) return 1
  return Math.max(0, 1 - (top - width) / (0.25 * width + 0.02))
}

// Блефы-блокеры для 3-бета и 4-бета: одномастные малые тузы (A5s…A2s) и одномастные связанные
export function blockerBluff(c: Combo): boolean {
  if (!c.suited) return false
  const hi = Math.max(rankOf(c.a), rankOf(c.b))
  const lo = Math.min(rankOf(c.a), rankOf(c.b))
  return (hi === 14 && lo <= 5) || (hi - lo === 1 && lo >= 5 && hi <= 11)
}
