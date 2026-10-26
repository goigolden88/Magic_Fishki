// Форма «Кэш» / «Турнир» (#78): у новой комнаты и у стола на одном телефоне. Поля — строками,
// как их набрал ведущий; в настройки стола — после разбора, проверка — та же, что у стола
import type { Settings, TableFormat } from '../poker/table'
import {
  DEFAULT_TOURNAMENT,
  defaultPrizes,
  PRIZE_RULES,
  prizesError,
  tournamentError,
  type BlindScheme,
  type Level,
} from '../poker/tournament'
import { formatNumber } from './format'

export type TournamentForm = {
  format: TableFormat
  ante: string // кэш: анте, фишек; пусто — 0
  buyIn: string // ₽
  scheme: BlindScheme
  growth: string // % за уровень — для «процентов»
  minutes: string
  antePct: string // % от большого блайнда; пусто — 0
  rebuy: boolean
  rebuyLevels: string // ребай — до конца уровня
  prizesOwn: boolean // свои проценты призов; нет — по числу игроков
  prizes: string[] // свои проценты по местам
}

export const SCHEME_LABELS: [BlindScheme, string][] = [
  ['classic', 'Классика'],
  ['percent', 'Проценты'],
]

// Сначала — кэш без анте; турнир — по умолчанию стола, призы — по числу игроков
export function tournamentForm(players: number): TournamentForm {
  const t = DEFAULT_TOURNAMENT
  return {
    format: 'cash',
    ante: '0',
    buyIn: String(t.buyIn),
    scheme: t.scheme,
    growth: String(t.growthPct),
    minutes: String(t.levelMinutes),
    antePct: String(t.antePct),
    rebuy: t.rebuyLevels > 0,
    rebuyLevels: String(t.rebuyLevels || 1),
    prizesOwn: false,
    prizes: defaultPrizes(players).map(String),
  }
}

// Настройки стола из формы; ошибка — та же строка, что скажет стол
export function formSettings(
  form: TournamentForm,
): { ok: true; settings: Pick<Settings, 'format' | 'ante' | 'tournament'> } | { ok: false; error: string } {
  if (form.format === 'cash') {
    const ante = wholeOf(form.ante)
    return ante === null ? { ok: false, error: 'Анте — целое число фишек, не меньше нуля' } : { ok: true, settings: { format: 'cash', ante } }
  }
  const buyIn = wholeOf(form.buyIn)
  if (buyIn === null || buyIn === 0) return { ok: false, error: 'Бай-ин — целое число рублей больше нуля' }
  const prizes = form.prizesOwn ? prizesOf(form.prizes) : { ok: true as const, prizes: null }
  if (!prizes.ok) return prizes
  const tournament = {
    buyIn,
    scheme: form.scheme,
    growthPct: wholeOf(form.growth) ?? NaN,
    levelMinutes: wholeOf(form.minutes) ?? NaN,
    antePct: wholeOf(form.antePct) ?? NaN,
    rebuyLevels: form.rebuy ? (wholeOf(form.rebuyLevels) ?? NaN) : 0,
    prizes: prizes.prizes,
  }
  if (form.rebuy && tournament.rebuyLevels === 0) return { ok: false, error: 'Ребай — до конца уровня от 1' }
  // Рост нужен только «процентам»: у «классики» поле скрыто — берётся прежнее или по умолчанию
  if (form.scheme === 'classic' && !Number.isInteger(tournament.growthPct)) tournament.growthPct = DEFAULT_TOURNAMENT.growthPct
  const error = tournamentError(tournament)
  return error ? { ok: false, error } : { ok: true, settings: { format: 'tournament', tournament } }
}

// Свои проценты призов по местам
export function prizesOf(texts: string[]): { ok: true; prizes: number[] } | { ok: false; error: string } {
  const prizes = texts.map((x) => wholeOf(x) ?? NaN)
  const error = prizesError(prizes)
  return error ? { ok: false, error } : { ok: true, prizes }
}

// Сумма своих процентов — подпись «Сумма: N %»; нечисло — как ноль
export function prizesSum(texts: string[]): number {
  return texts.reduce((sum, x) => sum + (wholeOf(x) ?? 0), 0)
}

// «10/20, анте 2»
export function levelText(l: Level): string {
  return `${formatNumber(l.sb)}/${formatNumber(l.bb)}${l.ante > 0 ? `, анте ${formatNumber(l.ante)}` : ''}`
}

// Призы по умолчанию словами: «до 4 игроков — всё первому, 5–7 — 65/35, от 8 — 50/30/20»
export function prizeRuleText(): string {
  return PRIZE_RULES.map((r, i) => {
    const next = PRIZE_RULES[i + 1]
    const who = i === 0 ? `до ${next.from - 1} игроков` : next ? `${r.from}–${next.from - 1}` : `от ${r.from}`
    return `${who} — ${r.prizes.length === 1 ? 'всё первому' : r.prizes.join('/')}`
  }).join(', ')
}

// «1 000» → 1000, «0» → 0; пусто — 0; не целое — null
function wholeOf(text: string): number | null {
  const clean = text.replace(/[\s ]/g, '')
  if (clean === '') return 0
  if (!/^\d+$/.test(clean)) return null
  const n = Number(clean)
  return Number.isSafeInteger(n) ? n : null
}
