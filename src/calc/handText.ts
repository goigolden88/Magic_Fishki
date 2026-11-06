// Выгрузка раздач файлом (Р-54): текст в формате истории покер-румов — его читают трекеры и ИИ.
// Раздача: шапка (номер, игра, блайнды, дата), места и стеки, свои карты, ходы по улицам, борд, итог.
// Свои карты — видны; чужие — только вскрытые и показанные; карты взявшего банк без вскрытия — только свои
import type { Card } from '../poker/cards'
import type { GameId, Limit } from '../poker/game'
import type { HandLogEntry, Street } from '../poker/hand'
import { handFor } from '../poker/history'
import { eveningName, type SavedHand } from './evenings'

const GAME_NAMES: Record<GameId, string> = { holdem: "Hold'em", omaha: 'Omaha', shortdeck: "6+ Hold'em" }
const LIMIT_NAMES: Record<Limit, string> = { nolimit: 'No Limit', pot: 'Pot Limit' }

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']
const BOARD_AT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 } // карт на столе к улице
const FOLDED: Record<Street, string> = {
  preflop: 'folded before Flop',
  flop: 'folded on the Flop',
  turn: 'folded on the Turn',
  river: 'folded on the River',
}

// Раздачи по порядку: вечера — по началу, в вечере — по номеру; между раздачами — пустые строки, как у покер-румов
export function handsText(hands: SavedHand[]): string {
  const sorted = [...hands].sort(
    (a, b) => a.startedAt - b.startedAt || a.evening.localeCompare(b.evening) || a.number - b.number,
  )
  return sorted.map(handText).join('\n\n\n') + (sorted.length > 0 ? '\n' : '')
}

// Имя файла: fishki-hands-2026-11-06.txt — вечер; fishki-hands-all-2026-11-06.txt — все вечера на сегодня
export function handsFileName(day: string, all = false): string {
  return `fishki-hands-${all ? 'all-' : ''}${day}.txt`
}

function isGameId(id: string): id is GameId {
  return id in GAME_NAMES
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

// Дата по часам телефона: 2026/11/06 21:15:00
function dateText(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const cardsText = (cards: Card[]) => `[${cards.join(' ')}]`

// Несколько бордов (#167) — подписи покер-румов
const RUN_ORDINALS = ['FIRST', 'SECOND', 'THIRD']
const RUN_TIMES: Record<number, string> = { 2: 'twice', 3: 'three times' }

// Сколько первых карт у всех бордов общие
function commonLength(boards: Card[][]): number {
  let n = 0
  while (boards.every((b) => n < b.length && b[n] === boards[0][n])) n++
  return n
}

// Номер для трекера — уникальный между вечерами: начало вечера в секундах и номер раздачи в нём
function handId(s: SavedHand): string {
  return `${Math.floor(s.startedAt / 1000)}${pad(s.number, 4)}`
}

export function handText(saved: SavedHand): string {
  const t = saved.table
  // Чей телефон: у записей до Р-54 — взявший банк без вскрытия (чужим эти карты не приходят)
  const hero = t?.me ?? saved.hand.record?.hidden?.playerId ?? null
  const h = handFor(saved.hand, hero)
  const record = h.record
  const seats = record?.seats ?? h.live?.seats ?? []
  const button = record?.button ?? h.live?.button ?? 0
  const log: HandLogEntry[] = record?.log ?? h.live?.log ?? []
  // Прогнали несколько раз (#167): общая часть бордов сдана до олл-ина, остальное — у каждого борда своё
  const runs = record?.runs && record.runs.length > 1 ? record.runs : null
  const board = runs ? runs[0].board.slice(0, commonLength(runs.map((r) => r.board))) : (record?.board ?? [])
  const names = new Map(seats.map((s) => [s.id, s.name]))
  const name = (id: string) => names.get(id) ?? 'Ушёл'

  const rawGame = record?.game.id ?? t?.game ?? 'holdem'
  const game: GameId = isGameId(rawGame) ? rawGame : 'holdem'
  const limit: Limit = t?.limit ?? (game === 'omaha' ? 'pot' : 'nolimit')
  // Блайнды: из записи раздачи; у живых карт — стола, если не турнир (там они растут)
  const blinds = record
    ? { sb: record.sb, bb: record.bb }
    : t && !t.tournament
      ? { sb: t.sb, bb: t.bb }
      : null

  const lines: string[] = []
  lines.push(
    `PokerStars Hand #${handId(saved)}: ${GAME_NAMES[game]} ${LIMIT_NAMES[limit]}${blinds ? ` (${blinds.sb}/${blinds.bb})` : ''} - ${dateText(saved.startedAt)}`,
  )
  lines.push(`Table '${eveningName({ id: saved.evening, code: saved.code, startedAt: saved.startedAt })}' ${t?.maxSeats ?? 9}-max Seat #${button + 1} is the button`)
  seats.forEach((s, i) => lines.push(`Seat ${i + 1}: ${s.name} (${s.chips} in chips)`))

  const left = new Map(seats.map((s) => [s.id, s.chips])) // в стеке сейчас
  const committed = new Map(seats.map((s) => [s.id, 0])) // вложено за раздачу
  const put = (id: string, amount: number) => {
    left.set(id, (left.get(id) ?? 0) - amount)
    committed.set(id, (committed.get(id) ?? 0) + amount)
  }
  const allIn = (on: boolean) => (on ? ' and is all-in' : '')

  for (const e of log) {
    if (e.type !== 'ante') continue
    put(e.playerId, e.bet)
    lines.push(`${name(e.playerId)}: posts the ante ${e.bet}${allIn(e.allIn)}`)
  }

  // Блайнды в журнал ходов не пишутся — по местам от кнопки, как в раздаче: хедз-ап — малый у кнопки
  const streetBet = new Map<string, number>()
  let max = 0
  let sbIndex = -1
  let bbIndex = -1
  const n = seats.length
  if (blinds && n >= 2) {
    sbIndex = n === 2 ? button : (button + 1) % n
    bbIndex = (sbIndex + 1) % n
    for (const [index, blind, label] of [
      [sbIndex, blinds.sb, 'small blind'],
      [bbIndex, blinds.bb, 'big blind'],
    ] as const) {
      const id = seats[index].id
      const amount = Math.min(blind, left.get(id) ?? 0)
      if (amount <= 0) continue
      put(id, amount)
      streetBet.set(id, amount)
      max = Math.max(max, amount)
      lines.push(`${name(id)}: posts ${label} ${amount}${allIn(left.get(id) === 0)}`)
    }
  }

  lines.push('*** HOLE CARDS ***')
  const mine = hero ? heroCards(saved, hero) : null
  if (hero && mine) lines.push(`Dealt to ${name(hero)} ${cardsText(mine)}`)

  let street = 0 // индекс в STREETS
  const folded = new Map<string, Street>()
  const nextStreet = () => {
    street++
    streetBet.clear()
    max = 0
    const s = STREETS[street]
    const at = BOARD_AT[s]
    if (board.length < at) lines.push(`*** ${s.toUpperCase()} ***`)
    else if (s === 'flop') lines.push(`*** FLOP *** ${cardsText(board.slice(0, 3))}`)
    else lines.push(`*** ${s.toUpperCase()} *** ${cardsText(board.slice(0, at - 1))} [${board[at - 1]}]`)
  }

  for (const e of log) {
    if (e.type === 'ante') continue
    while (street < STREETS.indexOf(e.street)) nextStreet()
    const who = name(e.playerId)
    const before = streetBet.get(e.playerId) ?? 0
    const add = Math.max(0, e.bet - before)
    if (e.type === 'fold') {
      folded.set(e.playerId, STREETS[street])
      lines.push(`${who}: folds`)
      continue
    }
    if (e.type === 'check') lines.push(`${who}: checks`)
    else if (e.type === 'call' || e.bet <= max) lines.push(`${who}: calls ${add}${allIn(e.allIn)}`)
    else if (max === 0) lines.push(`${who}: bets ${e.bet}${allIn(e.allIn)}`)
    else lines.push(`${who}: raises ${e.bet - max} to ${e.bet}${allIn(e.allIn)}`)
    if (add > 0) put(e.playerId, add)
    streetBet.set(e.playerId, Math.max(before, e.bet))
    max = Math.max(max, e.bet)
  }
  // Ва-банк до ривера — остальные улицы открываются без ходов
  while (street < STREETS.length - 1 && board.length >= BOARD_AT[STREETS[street + 1]]) nextStreet()
  // Прогнали несколько раз — оставшиеся улицы каждого борда, как у покер-румов: «*** FIRST FLOP ***», «*** SECOND TURN ***»
  runs?.forEach((run, b) => {
    for (let k = street + 1; k < STREETS.length; k++) {
      const s = STREETS[k]
      const at = BOARD_AT[s]
      if (run.board.length < at) break
      const head = `*** ${RUN_ORDINALS[b]} ${s.toUpperCase()} ***`
      lines.push(s === 'flop' ? `${head} ${cardsText(run.board.slice(0, 3))}` : `${head} ${cardsText(run.board.slice(0, at - 1))} [${run.board[at - 1]}]`)
    }
  })

  // Непокрытая ставка вернулась: вложено больше, чем во всех банках, — у вложившего больше всех
  const total = h.pots.reduce((sum, p) => sum + p.amount, 0)
  const returned = [...committed.values()].reduce((a, b) => a + b, 0) - total
  if (returned > 0 && n > 0) {
    const top = seats.reduce((a, b) => ((committed.get(b.id) ?? 0) > (committed.get(a.id) ?? 0) ? b : a))
    lines.push(`Uncalled bet (${returned}) returned to ${top.name}`)
  }

  const hands = record?.hands ?? {}
  const shown = record?.shown ?? {}
  const shownOf = (id: string) => (shown[id] ?? []).filter((c): c is Card => c !== null)
  const atShowdown = seats.filter((s) => hands[s.id] !== undefined)
  if (runs) {
    runs.forEach((run, b) => {
      lines.push(`*** ${RUN_ORDINALS[b]} SHOW DOWN ***`)
      for (const s of atShowdown) lines.push(`${s.name}: shows ${cardsText(shownOf(s.id))} (${run.hands[s.id] ?? hands[s.id]})`)
    })
  } else if (atShowdown.length > 0) {
    lines.push('*** SHOW DOWN ***')
    for (const s of atShowdown) lines.push(`${s.name}: shows ${cardsText(shownOf(s.id))} (${hands[s.id]})`)
  }
  for (const s of seats) {
    const won = h.payouts[s.id] ?? 0
    if (won > 0) lines.push(`${s.name} collected ${won} from pot`)
  }
  // «Показать» после банка без вскрытия — видно всем
  for (const s of seats) {
    if (hands[s.id] === undefined && shownOf(s.id).length > 0) lines.push(`${s.name}: shows ${cardsText(shownOf(s.id))}`)
  }

  lines.push('*** SUMMARY ***')
  lines.push(`Total pot ${total} | Rake 0`)
  if (runs) {
    lines.push(`Hand was run ${RUN_TIMES[runs.length] ?? `${runs.length} times`}`)
    runs.forEach((run, b) => lines.push(`${RUN_ORDINALS[b]} Board ${cardsText(run.board)}`))
  } else if (board.length > 0) lines.push(`Board ${cardsText(board)}`)
  seats.forEach((s, i) => {
    const tags = `${i === button ? ' (button)' : ''}${i === sbIndex ? ' (small blind)' : i === bbIndex ? ' (big blind)' : ''}`
    const won = h.payouts[s.id] ?? 0
    const fold = folded.get(s.id)
    const result = fold
      ? FOLDED[fold]
      : hands[s.id] !== undefined
        ? won > 0
          ? `showed ${cardsText(shownOf(s.id))} and won (${won})${runs ? '' : ` with ${hands[s.id]}`}`
          : `showed ${cardsText(shownOf(s.id))} and lost${runs ? '' : ` with ${hands[s.id]}`}`
        : won > 0
          ? `collected (${won})`
          : 'mucked'
    lines.push(`Seat ${i + 1}: ${s.name}${tags} ${result}`)
  })
  return lines.join('\n')
}

// Свои карты: что видел телефон в раздаче, иначе — из записи (взял без вскрытия или вскрылся)
function heroCards(saved: SavedHand, hero: string): Card[] | null {
  if (saved.mine && saved.mine.length > 0) return saved.mine
  const record = saved.hand.record
  if (record?.hidden?.playerId === hero) return record.hidden.cards
  const shown = record?.shown[hero]
  return shown && shown.length > 0 && shown.every((c) => c !== null) ? (shown as Card[]) : null
}
