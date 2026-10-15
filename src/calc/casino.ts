import { playerByName, type CasinoRound, type Game, type Player, type Regular } from '../model'
import { balance, playerTotals, type Balance, type PlayerTotal } from './totals'
import { kopeckTransfers, transfers, type Payment } from './transfers'

// Раунд из текста: у каждого имени — сумма в копейках (имя дважды — сложено), порядок — первого появления
export type ParsedRound = {
  amounts: { name: string; kopecks: number }[]
  sum: number // копеек; не 0 — раунд не сходится
  bad: string[] // строки, которые не разобраны
}

// «Эрик, Артём +150», «Эдик 550», «Арман, Аскар -250», «Эдик 1 000,50 ₽»: имена через запятую, затем число в рублях
const LINE = /^(.+?)\s+([+\-−–]?)\s*(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:₽|руб\.?|р\.?)?$/i

// Строки раунда: каждый названный получает число строки; без знака — плюс; пустые строки пропускаются
export function parseRound(text: string): ParsedRound {
  const sums = new Map<string, number>()
  const bad: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const m = LINE.exec(line)
    const names = m
      ? m[1]
          .split(',')
          .map((n) => n.trim().replace(/:$/, '').trim())
          .filter((n) => n !== '')
      : []
    const rub = m ? Number(m[3].replace(/[  ]/g, '')) : 0
    const kop = m?.[4] ? Number(m[4].padEnd(2, '0')) : 0
    const kopecks = (rub * 100 + kop) * (m && m[2] !== '' && m[2] !== '+' ? -1 : 1)
    if (names.length === 0 || kopecks === 0 || !Number.isSafeInteger(kopecks)) {
      bad.push(line)
      continue
    }
    for (const name of names) sums.set(name, (sums.get(name) ?? 0) + kopecks)
  }
  const amounts = [...sums].map(([name, kopecks]) => ({ name, kopecks }))
  return { amounts, sum: amounts.reduce((s, a) => s + a.kopecks, 0), bad }
}

// Имена раунда, которых нет среди участников, — станут участниками только казино
export function newNames(round: ParsedRound, players: Player[]): string[] {
  const known = new Set(players.map((p) => p.name))
  return round.amounts.map((a) => a.name).filter((n) => !known.has(n))
}

// Раунд в игру: новые имена — участниками (связь с постоянным по имени, Р-12), без покерных записей.
// Доли, сложившиеся в ноль, не пишутся
export function addRound(game: Game, round: ParsedRound, regulars: Regular[], makeId: () => string, now: string): Game {
  const players = [...game.players]
  const amounts = round.amounts
    .filter((a) => a.kopecks !== 0)
    .map((a) => {
      let p = players.find((x) => x.name === a.name)
      if (!p) {
        p = playerByName(a.name, regulars, makeId())
        players.push(p)
      }
      return { playerId: p.id, kopecks: a.kopecks }
    })
  const next: CasinoRound = { id: makeId(), amounts, at: now }
  return { ...game, players, casino: [...(game.casino ?? []), next] }
}

export function roundSum(round: CasinoRound): number {
  return round.amounts.reduce((s, a) => s + a.kopecks, 0)
}

// Три итога участника (Р-13), в копейках
export type PlayerResult = {
  playerId: string
  poker: PlayerTotal // покер — как без казино
  casino: number // сумма долей по раундам
  kopecks: number // итого: покер + казино
  inPoker: boolean // есть покерные записи
  inCasino: boolean // есть в раундах
}

export type GameResult = {
  players: PlayerResult[] // в порядке участников
  balance: Balance // покер
  hasCasino: boolean // есть раунды
  casinoOk: boolean // все раунды в ноль
  ok: boolean // игра сходится: покер и казино
  transfers: Payment[] // не сходится — пусто
}

// Итоги и переводы игры. Без казино — переводы в фишках, как были (Р-03);
// с казино — по «итого» в копейках
export function gameResult(game: Game): GameResult {
  const rounds = game.casino ?? []
  const totals = playerTotals(game.players, game.entries, game.rate)
  const casino = new Map<string, number>()
  for (const r of rounds) for (const a of r.amounts) casino.set(a.playerId, (casino.get(a.playerId) ?? 0) + a.kopecks)
  const inPoker = new Set(game.entries.map((e) => e.playerId))
  const players = totals.map((t) => {
    const c = casino.get(t.playerId) ?? 0
    return {
      playerId: t.playerId,
      poker: t,
      casino: c,
      kopecks: t.kopecks + c,
      inPoker: inPoker.has(t.playerId),
      inCasino: casino.has(t.playerId),
    }
  })
  const b = balance(totals)
  const hasCasino = rounds.length > 0
  const casinoOk = rounds.every((r) => roundSum(r) === 0)
  const ok = b.ok && casinoOk
  const list = !ok ? [] : hasCasino ? kopeckTransfers(players) : transfers(totals, game.rate)
  return { players, balance: b, hasCasino, casinoOk, ok, transfers: list }
}
