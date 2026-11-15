// Чтение соперника за вечер (#146, Р-47): сильные боты (ТАГ, ЛАГ) читают каждого за столом по его HUD —
// счётчикам по ходам (VPIP, PFR, AF, ATS, CB, src/poker/hud.ts), которые любой за столом мог бы набрать сам.
// Карт HUD не содержит. Пока раздач меньше HUD_FEW_HANDS — соперник такой, как подписан (бот), а без подписи
// (человек) — средний игрок ABC. Две точки (#240, Р-80): с HUD_FEW_HANDS раздач — первое чтение, доли по
// счётчикам смешиваются с ожиданием от подписи (или ABC) весом readWeight: половина по игре, дальше ровно
// больше; с HUD_FIRM_HANDS — твёрдое, только по счётчикам
import { HUD_FEW_HANDS, type Hud, type HudCounts } from '../poker/hud'
import type { BotStyle, Who } from './botRanges'

// С стольких раздач чтение твёрдое: весь вес — по игре
export const HUD_FIRM_HANDS = 100
// Вес по игре на первой точке (HUD_FEW_HANDS раздач)
const FIRST_WEIGHT = 0.5

// Вес чтения по игре: до HUD_FEW_HANDS — 0, на HUD_FEW_HANDS — FIRST_WEIGHT, дальше ровно до 1 к HUD_FIRM_HANDS
export function readWeight(hands: number): number {
  if (hands < HUD_FEW_HANDS) return 0
  if (hands >= HUD_FIRM_HANDS) return 1
  return FIRST_WEIGHT + ((1 - FIRST_WEIGHT) * (hands - HUD_FEW_HANDS)) / (HUD_FIRM_HANDS - HUD_FEW_HANDS)
}

// Как сильные боты читают игрока: как подписан или средним (prior), первое чтение (first), твёрдое (firm)
export type ReadStage = 'prior' | 'first' | 'firm'
export function readStage(hands: number): ReadStage {
  return hands < HUD_FEW_HANDS ? 'prior' : hands < HUD_FIRM_HANDS ? 'first' : 'firm'
}

// Подпись в карточке HUD после «Боты читают:»; signed — у игрока есть подпись стиля (бот)
export function readLabel(hands: number, signed: boolean): string {
  const stage = readStage(hands)
  if (stage === 'firm') return 'твёрдое'
  if (stage === 'first') return 'первое чтение'
  return signed ? 'как подписан' : 'как среднего игрока'
}
// ATS и CB — с этого числа возможностей
const FEW_CHANCES = 10

// Как соперник сдаётся на ставку (множитель частоты блефа), как часто блефует сам (множитель защиты банка),
// как часто без руки ставит второй раз, какая часть его диапазона уравняет ставку, сдаётся ли на кражу блайндов
export type Profile = { folds: number; defend: number; barrel: number; calls: number; steal: number }

export const PROFILES: Record<Who, Profile> = {
  maniac: { folds: 0.5, defend: 1.15, barrel: 0.4, calls: 0.65, steal: 0.75 },
  station: { folds: 0.2, defend: 0.4, barrel: 0.1, calls: 0.85, steal: 0.8 },
  nit: { folds: 1.6, defend: 0.15, barrel: 0.8, calls: 0.3, steal: 2 },
  abc: { folds: 1.4, defend: 0.35, barrel: 0.4, calls: 0.4, steal: 1 },
  tag: { folds: 1, defend: 1, barrel: 0.9, calls: 0.5, steal: 1 },
  lag: { folds: 0.85, defend: 1, barrel: 0.8, calls: 0.55, steal: 0.9 },
  unknown: { folds: 0.9, defend: 0.9, barrel: 0.7, calls: 0.5, steal: 1 },
}

// Соперник глазами сильного бота: типаж для чтения диапазона, поправки к игре против него;
// ats / cb — его доли краж и продолжений ставкой, если возможностей набралось (иначе null)
export type RivalRead = { who: Who; profile: Profile; ats: number | null; cb: number | null }

// Чего ждать от типажа: VPIP и PFR (доли раздач), AF (рейзы к коллам за все улицы, как в HUD) — у холдема;
// у омахи VPIP выше. Цифры — HUD прогона ботов между собой
type Expect = { vpip: number; pfr: number; af: number }
const EXPECT: Record<BotStyle, Expect> = {
  maniac: { vpip: 0.65, pfr: 0.45, af: 2.5 },
  station: { vpip: 0.5, pfr: 0.03, af: 0.1 },
  nit: { vpip: 0.13, pfr: 0.1, af: 2 },
  abc: { vpip: 0.23, pfr: 0.14, af: 2 },
  tag: { vpip: 0.21, pfr: 0.17, af: 2.8 },
  lag: { vpip: 0.3, pfr: 0.26, af: 3.3 },
}
// AF в HUD — за все улицы, и до флопа осторожный игрок почти только повышает: у ABC он и так около 2–3.
// «Давит» — заметно выше
export const PUSHY_AF = 3.5
// Явный вор блайндов: ATS от стольких (у ABC и ТАГа — 25–30 %, у ЛАГа — около половины)
export const THIEF_ATS = 0.4
// Омаха: входят шире на столько
const OMAHA_VPIP = 0.05

// Пороги типажей по VPIP / PFR / AF (после смешения с ожиданием); у омахи VPIP — по её полосам (Р-46)
type Bounds = { maniacVpip: number; maniacPfr: number; stationVpip: number; nitVpip: number; lagVpip: number; lagPfr: number; tagRatio: number }
const BOUNDS: Record<'holdem' | 'omaha', Bounds> = {
  holdem: { maniacVpip: 0.45, maniacPfr: 0.3, stationVpip: 0.4, nitVpip: 0.16, lagVpip: 0.28, lagPfr: 0.21, tagRatio: 0.7 },
  omaha: { maniacVpip: 0.5, maniacPfr: 0.3, stationVpip: 0.45, nitVpip: 0.19, lagVpip: 0.33, lagPfr: 0.22, tagRatio: 0.65 },
}

// Типаж по смешанным VPIP / PFR / AF
export function typeOf(vpip: number, pfr: number, af: number, omaha: boolean): BotStyle {
  const b = BOUNDS[omaha ? 'omaha' : 'holdem']
  if (vpip >= b.maniacVpip && pfr >= b.maniacPfr) return 'maniac'
  if (vpip >= b.stationVpip && (af < 1 || pfr < 0.1)) return 'station'
  if (vpip < b.nitVpip) return 'nit'
  if (vpip >= b.lagVpip && pfr >= b.lagPfr) return 'lag'
  if (pfr >= 0.15 && pfr >= b.tagRatio * vpip) return 'tag'
  return 'abc'
}

// Чтение соперника id: подпись стиля (бот) или ABC (человек и любой без подписи), с HUD_FEW_HANDS раздач — по HUD
export function readRival(id: string, styles: Record<string, BotStyle>, hud: Hud | undefined, omaha: boolean): RivalRead {
  const signed = styles[id]
  const prior: BotStyle = signed ?? 'abc'
  const c = hud?.[id]
  if (!c || c.hands < HUD_FEW_HANDS) return { who: prior, profile: PROFILES[prior], ats: null, cb: null }
  const e = EXPECT[prior]
  const w = readWeight(c.hands)
  const vpip = mix(w, c.vpip / c.hands, e.vpip + (omaha ? OMAHA_VPIP : 0))
  const pfr = mix(w, c.pfr / c.hands, e.pfr)
  const af = afOf(w, c, e.af)
  const who = typeOf(vpip, pfr, af, omaha)
  const base = PROFILES[who]
  // Много давит (AF > PUSHY_AF) — блефует часто: защита банка шире, на ставки сдаётся реже. Кроме нита: он
  // почти не уравнивает, а повышает — с рукой, и AF у него высокий без блефов
  const pushy = af > PUSHY_AF && who !== 'maniac' && who !== 'nit'
  // Нит по HUD без подписи нита: от нита — только кражи шире и сдаваться на его повышения, а руки и прочие
  // поправки — как у среднего: на прогоне так выигрывается больше, чем с узким диапазоном и блефами против нита
  const readNit = who === 'nit' && prior !== 'nit'
  const own = readNit ? { ...PROFILES[prior], steal: base.steal, defend: base.defend } : base
  const profile: Profile = pushy ? { ...own, defend: Math.max(own.defend, 1.15), folds: Math.min(own.folds, 0.7) } : own
  return {
    who: readNit ? prior : who,
    profile,
    ats: c.stealChances >= FEW_CHANCES ? c.steals / c.stealChances : null,
    cb: c.cbChances >= FEW_CHANCES ? c.cbs / c.cbChances : null,
  }
}

// Доля по игре, смешанная с ожиданием: w — по игре, остальное — ожидание
const mix = (w: number, seen: number, expected: number) => w * seen + (1 - w) * expected

// AF через долю рейзов в ходах (рейзы / (рейзы + коллы)): доля смешивается с ожидаемой весом w и
// обращается назад в AF. Ходов не было — ожидание; при w = 1 без коллов — ∞, как в HUD
function afOf(w: number, c: HudCounts, expected: number): number {
  const moves = c.raises + c.calls
  if (moves === 0) return expected
  const share = mix(w, c.raises / moves, expected / (1 + expected))
  return share / (1 - share)
}
