// Раздача из истории — в калькулятор «Тренажёра» (#221): стороны и борд прошлой раздачи холдема с картами
// на телефонах, и адрес экрана с ними. Сторона — две карты («Рука») или null — пустой диапазон: его задают сами.
// Ввод уходит адресом и нигде не хранится; кривой адрес — калькулятор с чистого листа
import { SUITS, type Card } from '../poker/cards'
import type { Street } from '../poker/hand'
import { handFor } from '../poker/history'
import type { SavedHand } from './evenings'
import { BOARD_MAX, HAND_CARDS, TRAINER_SIDES_MAX, TRAINER_SIDES_MIN } from './trainerView'

export const TRAINER_PATH = '/poker/trainer'

export type TrainerStart = { sides: (Card[] | null)[]; board: Card[] }

const RANK_CHARS = '23456789TJQKA'

const isCard = (c: string): boolean => c.length === 2 && RANK_CHARS.includes(c[0]) && (SUITS as readonly string[]).includes(c[1])

// Все карты известны — две карты руки холдема
function known(cards: (Card | null)[] | undefined): Card[] | null {
  return cards && cards.length === HAND_CARDS && cards.every((c) => c !== null) ? (cards as Card[]) : null
}

// Сколько первых карт у всех бордов общие — как в выгрузке (handText)
function commonLength(boards: Card[][]): number {
  let n = 0
  while (boards.every((b) => n < b.length && b[n] === boards[0][n])) n++
  return n
}

// Стороны калькулятора из раздачи — в «моём виде» (handFor): карты взявшего банк без вскрытия — только если это я.
// 1) я — первым, если мои карты известны: свои с телефона (mine), иначе взятые без вскрытия, иначе вскрытые;
// 2) соперники: вскрытые — рукой (даже сбросившие), не сбросившие без вскрытия — пустым диапазоном;
// 3) сторон меньше двух — сбросившие на последней улице, по местам от кнопки; всё равно мало — пустые до двух;
// 4) больше шести — первые шесть: я, вскрытые, пустые — по местам от кнопки.
// Борд — раздачи; прогнали несколько раз — общая часть бордов. Не холдем с картами на телефонах — null
export function trainerStart(saved: SavedHand): TrainerStart | null {
  const me = saved.table?.me ?? null
  const record = handFor(saved.hand, me).record
  if (!record || record.game.id !== 'holdem') return null

  const n = record.seats.length
  // Места по порядку от кнопки: сначала следующий за ней, кнопка — последней
  const order = Array.from({ length: n }, (_, k) => record.seats[(record.button + 1 + k) % n].id)
  const moves = record.log.filter((e) => e.type !== 'ante')
  const folded = new Map<string, Street>()
  for (const e of moves) if (e.type === 'fold') folded.set(e.playerId, e.street)
  const lastStreet: Street = moves.at(-1)?.street ?? 'preflop'

  let mine: Card[] | null = null
  if (me && record.seats.some((s) => s.id === me)) {
    mine = known(saved.mine) ?? (record.hidden?.playerId === me ? known(record.hidden.cards) : null) ?? known(record.shown[me])
  }

  const others = order.filter((id) => id !== me)
  const shown: Card[][] = []
  const empty: string[] = []
  for (const id of others) {
    const cards = known(record.shown[id])
    if (cards) shown.push(cards)
    else if (!folded.has(id)) empty.push(id)
  }
  const sides: (Card[] | null)[] = [...(mine ? [mine] : []), ...shown, ...empty.map(() => null)]
  if (sides.length < TRAINER_SIDES_MIN) {
    for (const id of others) if (folded.get(id) === lastStreet && !empty.includes(id)) sides.push(null)
  }
  while (sides.length < TRAINER_SIDES_MIN) sides.push(null)

  const runs = record.runs && record.runs.length > 1 ? record.runs : null
  const board = runs ? runs[0].board.slice(0, commonLength(runs.map((r) => r.board))) : record.board
  return { sides: sides.slice(0, TRAINER_SIDES_MAX), board: [...board] }
}

// Адрес калькулятора: #/poker/trainer?side=AsKs&side=&side=QhQd&board=Ah7d2c — пустая сторона — пустой диапазон
export function trainerHash(start: TrainerStart): string {
  const params = start.sides.map((s) => `side=${s ? s.join('') : ''}`)
  if (start.board.length > 0) params.push(`board=${start.board.join('')}`)
  return `#${TRAINER_PATH}?${params.join('&')}`
}

// Кнопка «В калькулятор» у раздачи: адрес или null — кнопки нет
export function trainerHashOf(saved: SavedHand): string | null {
  const start = trainerStart(saved)
  return start ? trainerHash(start) : null
}

// Карты подряд: «AhKd» → ['Ah', 'Kd']; не карты — null
function cardsOf(text: string): Card[] | null {
  if (text.length % 2 !== 0) return null
  const out: Card[] = []
  for (let i = 0; i < text.length; i += 2) {
    const c = text.slice(i, i + 2)
    if (!isCard(c)) return null
    out.push(c)
  }
  return out
}

// Разбор адреса калькулятора (путь после #): без параметров — null, с чистого листа, как в #213.
// Кривые параметры — тоже null: карта не из колоды, повтор карты, сторона не из двух карт, больше шести сторон,
// борд не из 0, 3, 4 или 5 карт. Одна сторона — вторая пустым диапазоном
export function parseTrainerPath(path: string): TrainerStart | null {
  const at = path.indexOf('?')
  if (at < 0) return null
  const params = new URLSearchParams(path.slice(at + 1))
  const raw = params.getAll('side')
  if (raw.length === 0 || raw.length > TRAINER_SIDES_MAX) return null
  const boards = params.getAll('board')
  if (boards.length > 1) return null
  const board = cardsOf(boards[0] ?? '')
  if (!board || ![0, 3, 4, BOARD_MAX].includes(board.length)) return null
  const sides: (Card[] | null)[] = []
  for (const text of raw) {
    if (text === '') {
      sides.push(null)
      continue
    }
    const cards = cardsOf(text)
    if (!cards || cards.length !== HAND_CARDS) return null
    sides.push(cards)
  }
  const all = [...board, ...sides.flatMap((s) => s ?? [])]
  if (new Set(all).size !== all.length) return null
  while (sides.length < TRAINER_SIDES_MIN) sides.push(null)
  return { sides, board }
}
