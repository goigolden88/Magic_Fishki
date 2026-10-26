// Турнир (#78, Р-28): уровни блайндов по времени, анте уровня, места выбывших, призы.
// Чистые функции: время — параметром now. Уровень считается от времени старта и пауз,
// а не от нажатий: ведущий может быть вне сети, телефон — в фоне. Стол — table.ts
import type { TableState } from './table'

export type BlindScheme = 'classic' | 'percent'

export type TournamentSettings = {
  buyIn: number // бай-ин, целые рубли: в «Фишки» он пишется фишками по курсу 1 ₽ за фишку
  scheme: BlindScheme // «классика» — шкала CLASSIC_STEPS, «проценты» — рост на growthPct за уровень
  growthPct: number // рост блайндов за уровень, % (для «процентов»)
  levelMinutes: number // минут на уровень
  antePct: number // анте — % от большого блайнда уровня; 0 — без анте
  rebuyLevels: number // ребай — до конца этого уровня; 0 — без ребая
  prizes: number[] | null // проценты по местам, сумма 100; null — по числу игроков (defaultPrizes)
}

export type Level = { sb: number; bb: number; ante: number }

// Выбывший: номер раздачи (у ушедшего — сколько их было) и стек до неё — для мест при одновременном вылете
export type Bust = { playerId: string; hand: number; chips: number }

export type TournamentState = {
  startedAt: number // «Начать турнир»
  pausedAt: number | null // часы стоят с этого момента («Перерыв»)
  pausedMs: number // сколько стояли раньше
  entrants: string[] // кто играл с начала — по местам за столом
  prizes: number[] // проценты по местам, заданы при старте
  out: Bust[] // выбывшие по порядку: позже выбыл — выше место
  // Турнир окончен: остался один с фишками и ребай закрыт, или ведущий нажал «Закончить турнир» (#94)
  endedAt: number | null
}

export const LEVEL_COUNT = 20 // уровней в расписании; после последнего блайнды не растут

// «Классика»: большой блайнд уровня — стартовый, умноженный на шаг шкалы
export const CLASSIC_STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120]

// Призы по умолчанию: от стольких игроков — такие проценты по местам
export const PRIZE_RULES: { from: number; prizes: number[] }[] = [
  { from: 1, prizes: [100] },
  { from: 5, prizes: [65, 35] },
  { from: 8, prizes: [50, 30, 20] },
]

export const LEVEL_MIN_MINUTES = 1
export const LEVEL_MAX_MINUTES = 120
export const GROWTH_MIN_PCT = 1
export const GROWTH_MAX_PCT = 200
export const ANTE_MAX_PCT = 100
export const MAX_PRIZE_PLACES = 10 // один стол — до 10 мест

export const DEFAULT_TOURNAMENT: TournamentSettings = {
  buyIn: 1000,
  scheme: 'classic',
  growthPct: 50,
  levelMinutes: 15,
  antePct: 0,
  rebuyLevels: 0,
  prizes: null,
}

export function defaultPrizes(players: number): number[] {
  let prizes = PRIZE_RULES[0].prizes
  for (const r of PRIZE_RULES) if (players >= r.from) prizes = r.prizes
  return [...prizes]
}

// Расписание: LEVEL_COUNT уровней от стартовых блайндов стола
export function buildLevels(t: TournamentSettings, sb: number, bb: number): Level[] {
  const levels: Level[] = []
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const k = t.scheme === 'classic' ? CLASSIC_STEPS[i] : (1 + t.growthPct / 100) ** i
    const big = Math.max(1, Math.round(bb * k))
    const small = Math.min(big, Math.max(1, Math.round(sb * k)))
    levels.push({ sb: small, bb: big, ante: Math.round((big * t.antePct) / 100) })
  }
  return levels
}

// Уровень по часам (номер с нуля) и сколько мс до следующего; последний — null.
// Часы стоят на паузе: от старта — минус все паузы, идущая — до её начала
export function clockAt(t: TournamentSettings, clock: TournamentState, now: number): { index: number; msLeft: number | null } {
  const levelMs = t.levelMinutes * 60_000
  const elapsed = elapsedMs(clock, now)
  const index = Math.min(Math.floor(elapsed / levelMs), LEVEL_COUNT - 1)
  return { index, msLeft: index === LEVEL_COUNT - 1 ? null : (index + 1) * levelMs - elapsed }
}

// Часы встали («Перерыв») и пошли снова («Продолжить»)
export function pauseClock(clock: TournamentState, now: number): void {
  if (clock.pausedAt === null) clock.pausedAt = now
}

export function resumeClock(clock: TournamentState, now: number): void {
  if (clock.pausedAt === null) return
  clock.pausedMs += now - clock.pausedAt
  clock.pausedAt = null
}

// Ребай открыт: уровень по часам — не дальше rebuyLevels
export function rebuyOpen(t: TournamentSettings, clock: TournamentState, now: number): boolean {
  return clock.endedAt === null && clockAt(t, clock, now).index < t.rebuyLevels
}

// Сколько мс ребай ещё открыт по часам (на «Перерыве» не убывает). Без ребая или ребай до конца
// последнего уровня — он не кончается — null
export function rebuyLeft(t: TournamentSettings, clock: TournamentState, now: number): number | null {
  const end = rebuyEndMs(t)
  return end === null ? null : Math.max(0, end - elapsedMs(clock, now))
}

// Когда ребай закроется по часам — срок будильника сервера (#94); часы стоят или не закроется — null
export function rebuyClosesAt(t: TournamentSettings, clock: TournamentState): number | null {
  const end = rebuyEndMs(t)
  return end === null || clock.pausedAt !== null ? null : clock.startedAt + clock.pausedMs + end
}

// Ребай закрывается в конце уровня rebuyLevels — столько мс игры от старта
function rebuyEndMs(t: TournamentSettings): number | null {
  return t.rebuyLevels > 0 && t.rebuyLevels < LEVEL_COUNT ? t.rebuyLevels * t.levelMinutes * 60_000 : null
}

// Мс игры от старта: часы стоят на паузе — минус все паузы, идущая — до её начала
function elapsedMs(clock: TournamentState, now: number): number {
  return Math.max(0, (clock.pausedAt ?? now) - clock.startedAt - clock.pausedMs)
}

// Выбывшие в одной раздаче: в журнал по возрастанию стека до неё — у кого было больше, тот выше
export function addBusts(clock: TournamentState, busts: Bust[]): void {
  clock.out.push(...[...busts].sort((a, b) => a.chips - b.chips))
}

export type Standing = { playerId: string; place: number; out: boolean }

// Места: в игре — по стеку сверху, затем выбывшие — выбывший позже выше
export function standings(table: TableState): Standing[] {
  const clock = table.tournament
  const out = clock?.out ?? []
  const outIds = new Set(out.map((b) => b.playerId))
  const alive = table.players
    .filter((p) => !outIds.has(p.id))
    .sort((a, b) => b.chips - a.chips || a.seat - b.seat)
    .map((p) => ({ playerId: p.id, out: false }))
  const busted = [...out].reverse().map((b) => ({ playerId: b.playerId, out: true }))
  return [...alive, ...busted].map((s, i) => ({ ...s, place: i + 1 }))
}

// Призы в рублях по местам; не делится ровно — остаток первому месту
export function prizeAmounts(pool: number, prizes: number[]): number[] {
  const amounts = prizes.map((p) => Math.floor((pool * p) / 100))
  if (amounts.length > 0) amounts[0] += pool - amounts.reduce((sum, a) => sum + a, 0)
  return amounts
}

// Бай-инов у игрока: вход и ребаи (ребай турнира — запись rebuy в журнале фишек)
export function buyIns(table: TableState, playerId: string): number {
  const entered = table.tournament?.entrants.includes(playerId) ? 1 : 0
  return entered + table.chipLog.filter((e) => e.kind === 'rebuy' && e.playerId === playerId).length
}

// Призовой фонд, ₽: все бай-ины; до старта — по одному с каждого за столом
export function prizePool(table: TableState, t: TournamentSettings): number {
  const clock = table.tournament
  if (!clock) return table.players.length * t.buyIn
  const rebuys = table.chipLog.filter((e) => e.kind === 'rebuy').length
  return (clock.entrants.length + rebuys) * t.buyIn
}

export function prizesError(prizes: unknown): string | null {
  if (
    !Array.isArray(prizes) ||
    prizes.length === 0 ||
    prizes.length > MAX_PRIZE_PLACES ||
    !prizes.every((p) => Number.isInteger(p) && p > 0)
  ) {
    return `Призы — от 1 до ${MAX_PRIZE_PLACES} мест, проценты — целые больше нуля`
  }
  const sum = (prizes as number[]).reduce((a, b) => a + b, 0)
  return sum === 100 ? null : `Проценты призов в сумме — 100, сейчас ${sum}`
}

export function tournamentError(t: unknown): string | null {
  if (!isRecord(t)) return 'Нет настроек турнира'
  if (!isPositiveInt(t.buyIn)) return 'Бай-ин — целое число рублей больше нуля'
  if (t.scheme !== 'classic' && t.scheme !== 'percent') return 'Шкала уровней — классика или проценты'
  if (!isIntIn(t.growthPct, GROWTH_MIN_PCT, GROWTH_MAX_PCT)) {
    return `Рост блайндов — от ${GROWTH_MIN_PCT} до ${GROWTH_MAX_PCT} % за уровень`
  }
  if (!isIntIn(t.levelMinutes, LEVEL_MIN_MINUTES, LEVEL_MAX_MINUTES)) {
    return `Уровень — от ${LEVEL_MIN_MINUTES} до ${LEVEL_MAX_MINUTES} минут`
  }
  if (!isIntIn(t.antePct, 0, ANTE_MAX_PCT)) return `Анте — от 0 до ${ANTE_MAX_PCT} % большого блайнда`
  if (!isIntIn(t.rebuyLevels, 0, LEVEL_COUNT)) return `Ребай — до конца уровня от 1 до ${LEVEL_COUNT} или без ребая`
  if (t.prizes !== null) return prizesError(t.prizes)
  return null
}

function isIntIn(x: unknown, min: number, max: number): boolean {
  return typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max
}

function isPositiveInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x > 0
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
