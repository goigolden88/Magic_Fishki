// Сортировка и отбор в «Истории раздач» (#294), как в покер-румах: итог в плюс или в минус, моя рука
// диапазоном (как в чартах, parseRange), позиция, до какой улицы дошла, было ли вскрытие; сортировка —
// новые, старые, по выигрышу, по проигрышу, по банку. Только экран: выбор живёт, пока открыт список,
// в хранилище, копию и синхронизацию не идёт; в записи раздачи нового поля нет — всё считается по ней.
// Чего у записи нет (меня нет в раздаче, итог неизвестен, живые карты — нет стола и вскрытия), то отбор
// по этому признаку раздачу не берёт; остальные признаки работают
import type { Street } from '../poker/hand'
import type { HistoryHand } from '../poker/history'
import type { SavedHand } from './evenings'
import { boardAtOf } from './handText'
import { handClass } from './botRanges'
import { classIndex, parseRange } from './rangeText'
import { historyList, type HistoryItem } from './pokerView'

// Строка списка и признаки отбора: банк — всё, что разыграно (сумма банков); улица — до какой дошла
// (по картам стола; живые карты — null); вскрытие — дошёл ли кто-то до него (живые карты — null)
export type HistoryRow = HistoryItem & { pot: number; street: Street | null; showdown: boolean | null }

export type HistorySort = 'new' | 'old' | 'won' | 'lost' | 'pot'

export type HistoryPick = {
  sort: HistorySort
  result: 'all' | 'plus' | 'minus'
  range: string // пусто — без отбора по руке
  position: string | null
  street: Street | null
  showdown: 'all' | 'yes' | 'no'
}

export const NO_PICK: HistoryPick = { sort: 'new', result: 'all', range: '', position: null, street: null, showdown: 'all' }

export const SORT_LABELS: Record<HistorySort, string> = {
  new: 'Новые',
  old: 'Старые',
  won: 'По выигрышу',
  lost: 'По проигрышу',
  pot: 'По банку',
}

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river']

// Порядок позиций в выборе — от кнопки по кругу, как подписи мест (positionLabels)
const POSITION_ORDER = ['BTN', 'BTN/SB', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'MP', 'LJ', 'HJ', 'CO']

// До какой улицы дошла: последняя, к которой на столе хватает карт (своя игра, #224 — по её кругам)
function streetOf(h: HistoryHand): Street | null {
  const record = h.record
  if (!record || !Array.isArray(record.board)) return null
  const rounds = Array.isArray(record.game?.rounds) && record.game.rounds.length > 0 ? record.game.rounds : null
  const at = boardAtOf(rounds ?? [])
  const streets = rounds ? rounds.map((r) => r.street) : STREETS
  let reached: Street = 'preflop'
  for (const s of streets) if (at[s] <= record.board.length) reached = s
  return reached
}

// Список истории с признаками отбора — новые сверху, как historyList
export function historyRows(hands: SavedHand[]): HistoryRow[] {
  const byNumber = new Map(hands.map((s) => [s.hand.number, s.hand]))
  return historyList(hands).map((item) => {
    const h = byNumber.get(item.number)
    const record = h?.record
    return {
      ...item,
      pot: (h?.pots ?? []).reduce((sum, p) => sum + p.amount, 0),
      street: h ? streetOf(h) : null,
      showdown: record ? Object.keys(record.hands ?? {}).length > 0 : null,
    }
  })
}

// Что можно выбрать в этом списке: отбор по руке — если есть мои руки из двух карт (омаха и свои игры
// с другим числом карт — нет); итог и позиции — если я был в раздачах; улицы и вскрытие — если есть записи с картами
export type PickOptions = { range: boolean; result: boolean; positions: string[]; streets: boolean; showdown: boolean }

export function pickOptions(rows: HistoryRow[]): PickOptions {
  const positions = [...new Set(rows.flatMap((r) => (r.mine ? [r.mine.position] : [])))]
  const rank = (p: string) => (POSITION_ORDER.includes(p) ? POSITION_ORDER.indexOf(p) : POSITION_ORDER.length)
  positions.sort((a, b) => rank(a) - rank(b))
  return {
    range: rows.some((r) => r.mine?.cards?.length === 2),
    result: rows.some((r) => r.mine && r.mine.net !== null),
    positions,
    streets: rows.some((r) => r.street !== null),
    showdown: rows.some((r) => r.showdown !== null),
  }
}

// Выбрано что-то, кроме обычного вида (новые сверху, без отбора)
export function isPicked(pick: HistoryPick): boolean {
  return (
    pick.sort !== NO_PICK.sort ||
    pick.result !== 'all' ||
    pick.range.trim() !== '' ||
    pick.position !== null ||
    pick.street !== null ||
    pick.showdown !== 'all'
  )
}

// Отбор и сортировка. Диапазон не разобран — ошибка (кусок, как в чартах), отбор по руке не идёт
export function pickHistory(rows: HistoryRow[], pick: HistoryPick): { rows: HistoryRow[]; rangeError: string | null } {
  let weights: number[] | null = null
  let rangeError: string | null = null
  if (pick.range.trim() !== '') {
    const parsed = parseRange(pick.range)
    if ('error' in parsed) rangeError = parsed.error
    else weights = parsed.weights
  }
  const inRange = (r: HistoryRow) => {
    const cards = r.mine?.cards
    if (!weights) return true
    if (!cards || cards.length !== 2) return false
    const k = classIndex(handClass(cards[0], cards[1]))
    return k >= 0 && weights[k] > 0
  }
  const net = (r: HistoryRow) => r.mine?.net ?? null
  const picked = rows.filter((r) => {
    if (pick.result === 'plus' && !((net(r) ?? 0) > 0)) return false
    if (pick.result === 'minus' && !((net(r) ?? 0) < 0)) return false
    if (pick.position !== null && r.mine?.position !== pick.position) return false
    if (pick.street !== null && r.street !== pick.street) return false
    if (pick.showdown === 'yes' && r.showdown !== true) return false
    if (pick.showdown === 'no' && r.showdown !== false) return false
    return inRange(r)
  })
  // Без итога — в конце списка по выигрышу и по проигрышу; равные — новые выше
  const byNet = (sign: 1 | -1) => (a: HistoryRow, b: HistoryRow) => {
    const x = net(a)
    const y = net(b)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return sign * (y - x)
  }
  const compare: Record<HistorySort, (a: HistoryRow, b: HistoryRow) => number> = {
    new: () => 0,
    old: (a, b) => a.number - b.number,
    won: byNet(1),
    lost: byNet(-1),
    pot: (a, b) => b.pot - a.pot,
  }
  const sorted = [...picked].sort((a, b) => compare[pick.sort](a, b) || b.number - a.number)
  return { rows: sorted, rangeError }
}
