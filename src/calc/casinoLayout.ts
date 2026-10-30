// Казино-стол (#129): участники сидят рядами над и под колонкой столов, столы — друг под другом
// в центре сукна. Только размеры и порядок мест — правил раунда не держит (они в casinoDeal.ts).
// Размеры — в rem: экран красит места и карты ими же (CSS-переменные), так что тест о том же, что на экране
import { BOARD_CARDS, DEAL_KINDS, type DealKind } from './casinoDeal'

// За казино-столом мест — как у покерного стола (Р-26, #129)
export const MAX_CASINO_SEATS = 10

// Самый узкий экран — 320 px без полей экрана (по 16 px с боков): 18rem. Шире места и столы не растут
export const MIN_WIDTH = 18
export const GAP = 0.3 // между местами и между столами
const CENTER_PAD = 0.6 // от рядов мест до колонки столов

// Карта у места: холдем — две крупнее, омаха — четыре мельче, чтобы три места вошли в ряд
const HAND_CARD: Record<DealKind, { w: number; h: number }> = {
  holdem: { w: 1.5, h: 2.1 },
  omaha: { w: 1.2, h: 1.7 },
}
const HAND_GAP = 0.1
const SEAT_PAD = 0.5 // поля и рамка места по ширине
const SEAT_MIN_W = 4.2 // имя читается и у холдема с двумя картами
const SEAT_TEXT_H = 2.4 // имя и подпись руки победителя, с полями

const BOARD_CARD = { w: 2.2, h: 3.05 }
const BOARD_GAP = 0.2
const BOARD_PAD = 0.6
const BOARD_TEXT_H = 1.4 // «Стол N · часть банка» и под картами — кто берёт

export type Size = { w: number; h: number }
export type Box = { x: number; y: number; w: number; h: number } // rem: x — слева, y — сверху

export type CasinoLayout = {
  hand: Size // карта у места
  seat: Size
  boardCard: Size
  board: Size // стол: подпись и пять карт
  center: Size // колонка столов
  perRow: number // мест в ряду, не больше
  top: number[][] // номера участников над столами: ряды сверху вниз, в ряду — слева направо
  bottom: number[][] // под столами: так же
  width: number // нужная ширина, rem
  height: number // нужная высота: места, столы и отступы между ними
}

// Раскладка на n участников и m столов. Порядок — по часовой: первая половина — над столами слева
// направо, вторая — под столами справа налево. Мест больше MAX_CASINO_SEATS или меньше одного — ошибка
export function casinoLayout(kind: DealKind, players: number, tables: number): CasinoLayout {
  if (!Number.isInteger(players) || players < 1 || players > MAX_CASINO_SEATS) {
    throw new Error(`За столом казино от 1 до ${MAX_CASINO_SEATS} участников`)
  }
  if (!Number.isInteger(tables) || tables < 1) throw new Error('Столов должно быть не меньше одного')
  const cards = DEAL_KINDS[kind].hand
  const hand = HAND_CARD[kind]
  const seat = {
    w: round(Math.max(SEAT_MIN_W, cards * hand.w + (cards - 1) * HAND_GAP + SEAT_PAD)),
    h: round(hand.h + SEAT_TEXT_H),
  }
  const board = {
    w: round(BOARD_CARDS * BOARD_CARD.w + (BOARD_CARDS - 1) * BOARD_GAP + BOARD_PAD),
    h: round(BOARD_CARD.h + BOARD_TEXT_H + BOARD_PAD),
  }
  const perRow = Math.max(1, Math.floor((MIN_WIDTH + GAP) / (seat.w + GAP)))
  const upper = Math.ceil(players / 2)
  const ids = Array.from({ length: players }, (_, i) => i)
  const top = rows(ids.slice(0, upper), perRow)
  const bottom = rows(ids.slice(upper).reverse(), perRow)
  const center = { w: board.w, h: round(tables * board.h + (tables - 1) * GAP) }
  const width = round(Math.max(perRow * seat.w + (perRow - 1) * GAP, board.w))
  const height = round(blockHeight(top.length, seat.h) + center.h + blockHeight(bottom.length, seat.h) + 2 * CENTER_PAD)
  return { hand, seat, boardCard: BOARD_CARD, board, center, perRow, top, bottom, width, height }
}

// Где что лежит: места по номеру участника и колонка столов — прямоугольниками в rem
export function layoutBoxes(l: CasinoLayout): { seats: Box[]; center: Box } {
  const seats: Box[] = []
  const place = (block: number[][], y0: number) =>
    block.forEach((row, r) => {
      const rowW = row.length * l.seat.w + (row.length - 1) * GAP
      row.forEach((id, k) => {
        seats[id] = { x: round((l.width - rowW) / 2 + k * (l.seat.w + GAP)), y: round(y0 + r * (l.seat.h + GAP)), ...l.seat }
      })
    })
  place(l.top, 0)
  const centerY = blockHeight(l.top.length, l.seat.h) + CENTER_PAD
  place(l.bottom, centerY + l.center.h + CENTER_PAD)
  return { seats, center: { x: round((l.width - l.center.w) / 2), y: round(centerY), ...l.center } }
}

// Прямоугольники пересекаются — общая площадь больше нуля
export function overlaps(a: Box, b: Box): boolean {
  const eps = 1e-6
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps
}

// k мест по рядам не длиннее perRow: рядов как можно меньше, длинные — первыми, разница не больше одного
function rows(ids: number[], perRow: number): number[][] {
  const count = Math.ceil(ids.length / perRow)
  const out: number[][] = []
  let at = 0
  for (let r = 0; r < count; r++) {
    const size = Math.ceil((ids.length - at) / (count - r))
    out.push(ids.slice(at, at + size))
    at += size
  }
  return out
}

function blockHeight(rowCount: number, seatH: number): number {
  return rowCount === 0 ? 0 : rowCount * seatH + (rowCount - 1) * GAP
}

function round(x: number): number {
  return Math.round(x * 100) / 100
}
