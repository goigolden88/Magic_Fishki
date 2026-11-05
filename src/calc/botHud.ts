// Чтение соперника за вечер (#146, Р-47): сильные боты (ТАГ, ЛАГ) читают каждого за столом по его HUD —
// счётчикам по ходам (VPIP, PFR, AF, ATS, CB, src/poker/hud.ts), которые любой за столом мог бы набрать сам.
// Карт HUD не содержит. Пока раздач меньше HUD_FEW_HANDS — соперник такой, как подписан (бот), а без подписи
// (человек) — средний игрок ABC. С HUD_FEW_HANDS раздач — по счётчикам: они смешиваются с ожиданием от
// подписи (или ABC) с весом PRIOR_HANDS раздач, так что к ~100 раздачам чтение почти целиком по игре
import { HUD_FEW_HANDS, type Hud, type HudCounts } from '../poker/hud'
import type { BotStyle, Who } from './botRanges'

// Вес ожидания от подписи в раздачах: при 30 раздачах счётчики весят 0,6, при 100 — 0,83
const PRIOR_HANDS = 20
// ATS и CB — с этого числа возможностей
const FEW_CHANCES = 10

// Как соперник сдаётся на ставку (множитель частоты блефа), как часто блефует сам (множитель защиты банка),
// как часто без руки ставит второй раз, какая часть его диапазона уравняет ставку, сдаётся ли на кражу блайндов
export type Profile = { folds: number; defend: number; barrel: number; calls: number; steal: number }

export const PROFILES: Record<Who, Profile> = {
  maniac: { folds: 0.5, defend: 1.15, barrel: 0.4, calls: 0.65, steal: 0.75 },
  station: { folds: 0.2, defend: 0.4, barrel: 0.1, calls: 0.85, steal: 0.8 },
  nit: { folds: 1.6, defend: 0.15, barrel: 0.8, calls: 0.3, steal: 1.45 },
  abc: { folds: 1.4, defend: 0.35, barrel: 0.4, calls: 0.4, steal: 1 },
  tag: { folds: 1, defend: 1, barrel: 0.9, calls: 0.5, steal: 1 },
  lag: { folds: 0.85, defend: 1, barrel: 0.8, calls: 0.55, steal: 0.9 },
  unknown: { folds: 0.9, defend: 0.9, barrel: 0.7, calls: 0.5, steal: 1 },
}

// Соперник глазами сильного бота: типаж для чтения диапазона, поправки к игре против него;
// ats / cb — его доли краж и продолжений ставкой, если возможностей набралось (иначе null)
export type RivalRead = { who: Who; profile: Profile; ats: number | null; cb: number | null }

// Чего ждать от типажа: VPIP и PFR (доли раздач), AF (рейзы к коллам) — у холдема; у омахи VPIP выше
type Expect = { vpip: number; pfr: number; af: number }
const EXPECT: Record<BotStyle, Expect> = {
  maniac: { vpip: 0.6, pfr: 0.45, af: 4 },
  station: { vpip: 0.55, pfr: 0.04, af: 0.4 },
  nit: { vpip: 0.13, pfr: 0.1, af: 1.5 },
  abc: { vpip: 0.24, pfr: 0.15, af: 1.3 },
  tag: { vpip: 0.22, pfr: 0.18, af: 2.5 },
  lag: { vpip: 0.31, pfr: 0.26, af: 3 },
}
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
  const vpip = mix(c.vpip, c.hands, e.vpip + (omaha ? OMAHA_VPIP : 0))
  const pfr = mix(c.pfr, c.hands, e.pfr)
  const af = afOf(c, e.af)
  const who = typeOf(vpip, pfr, af, omaha)
  const base = PROFILES[who]
  // Много давит (AF > 3) — блефует часто: защита банка шире, на ставки сдаётся реже
  const pushy = af > 3 && who !== 'maniac'
  const profile: Profile = pushy ? { ...base, defend: Math.max(base.defend, 1.15), folds: Math.min(base.folds, 0.7) } : base
  return {
    who,
    profile,
    ats: c.stealChances >= FEW_CHANCES ? c.steals / c.stealChances : null,
    cb: c.cbChances >= FEW_CHANCES ? c.cbs / c.cbChances : null,
  }
}

// Доля по счётчику, смешанная с ожиданием весом PRIOR_HANDS раздач
const mix = (count: number, hands: number, expected: number) => (count + PRIOR_HANDS * expected) / (hands + PRIOR_HANDS)

// AF, смешанный с ожиданием весом PRIOR_HANDS ходов
function afOf(c: HudCounts, expected: number): number {
  const raises = c.raises + (PRIOR_HANDS * expected) / (1 + expected)
  const calls = c.calls + PRIOR_HANDS / (1 + expected)
  return raises / calls
}
