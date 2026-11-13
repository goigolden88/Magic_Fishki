// Казино-стол (#129): участники сидят рядами над и под столами в центре сукна. На телефоне (Р-66) —
// места одним рядом сверху, пока входят в ширину экрана, столы — по два в ряд, карты мельче: при 3–6
// участниках и 5 столах холдема всё видно без прокрутки на 390 × 844. На широком окне (Р-53) — столы
// рядами по 2–3. Только размеры и порядок мест — правил раунда не держит (они в casinoDeal.ts).
// Размеры — в rem: экран красит места и карты ими же (CSS-переменные), так что тест о том же, что на экране
import { BOARD_CARDS, DEAL_KINDS, type DealKind } from './casinoDeal'

// За казино-столом мест — как у покерного стола (Р-26, #129)
export const MAX_CASINO_SEATS = 10

// Самый узкий экран — 320 px без полей экрана (по 16 px с боков) при rem = 18 px: 16rem.
// Уже раскладка не сжимается
export const MIN_WIDTH = 16
// Сукно не шире 40rem (max-width .casino-table): на планшете мест в ряду — не больше, чем входит в него
export const PHONE_MAX_WIDTH = 40
export const GAP = 0.3 // широкое окно: между местами и между столами
const CENTER_PAD = 0.6 // широкое окно: от рядов мест до столов

// Телефон (Р-66, #193): размеры подобраны под 390 × 844 — сукно с одним рядом мест и тремя рядами столов
// (5 столов по два) не выше PHONE_FIT; шапка экрана, свёрнутые настройки и панель внизу — вне сукна
export const PHONE_FIT = 22.5
export const PHONE_COLS = 2 // столов в ряду на телефоне
const PHONE_GAP = 0.2
const PHONE_CENTER_PAD = 0.4
// Карты у места: холдем — две, омаха — четыре мельче; шесть мест холдема входят в ряд и на 375 px
const PHONE_HAND: Record<DealKind, { w: number; h: number }> = {
  holdem: { w: 1.2, h: 1.7 },
  omaha: { w: 1, h: 1.4 },
}
const PHONE_SEAT_PAD = 0.52 // поля 0,15rem и рамка 2px с боков
// Имя (0,85rem × 1,15), подпись (0,7rem × 1,15), поля карт по 0,1rem, поля места 0,15rem и рамка 2px —
// сверху и снизу; с запасом
const PHONE_SEAT_TEXT_H = 2.56
const PHONE_BOARD_CARD = { w: 1.25, h: 1.75 }
const PHONE_BOARD_GAP = 0.12
const PHONE_BOARD_PAD = 0.52 // поля 0,15rem и рамка 2px с двух сторон
const PHONE_BOARD_TEXT_H = 2.02 // «Стол N · часть банка», строка шансов или победителя (по 0,96) и поля карт
const PHONE_WIN_CARD = { w: 0.85, h: 1.2 }
const PHONE_WIN_ROW_PAD = 0.1

// Широкое окно (до Р-66 — и телефон). Карта у места: холдем — две крупнее, омаха — четыре мельче
// (как у чужих мест покерного стола)
const HAND_CARD: Record<DealKind, { w: number; h: number }> = {
  holdem: { w: 1.7, h: 2.35 },
  omaha: { w: 1.1, h: 1.55 },
}
const HAND_GAP = 0.06
const SEAT_PAD = 0.4 // поля и рамка места по ширине
const SEAT_MIN_W = 4.8 // имя читается и у холдема с двумя картами
const SEAT_TEXT_H = 2.4 // имя и подпись руки победителя, с полями

const BOARD_CARD = { w: 2.2, h: 3.05 }
const BOARD_GAP = 0.2
const BOARD_PAD = 0.6
const BOARD_TEXT_H = 1.4 // «Стол N · часть банка» и под картами — кто берёт
// Строка победителя открытого стола (Р-50): под подписью «Имя · рука» — пять мелких карт его лучшей руки.
// Место под ряд держит каждый стол, и ещё не открытый: открылся — столы ниже не сдвигаются.
// Ничья — ещё по строке на каждого следующего победителя: стол выше, как раскрытые шансы
const WIN_GAP = 0.06
const WIN_ROW_PAD = 0.2 // поля ряда сверху и снизу

// Широкое окно (Р-53): колонка экрана от 1024 px — 66rem без полей по 2rem, ≈ 1116 px при rem = 18 px.
// Столы — рядами по 2–3, места — в ряд на всю ширину. Строка победителя (Р-60) — под картами своего стола,
// как на телефоне, но «Имя · рука» переносится, а не сжимается (место — на две строки), и карты руки
// крупнее — не меньше половины карты стола и крупнее телефонных
export const WIDE_WIDTH = 62
const WIDE_WIN_CARD = { w: 1.4, h: 1.95 }
const WIDE_WIN_LINE = 0.96 // вторая строка «Имя · рука»: 1,2 × 0,8rem

export type Size = { w: number; h: number }
export type Box = { x: number; y: number; w: number; h: number } // rem: x — слева, y — сверху

export type CasinoLayout = {
  hand: Size // карта у места
  seat: Size
  boardCard: Size
  board: Size // стол: подпись, пять карт и строка победителя
  winCard: Size // мелкая карта в строке победителя (Р-50)
  winRow: Size // ряд пяти мелких карт победителя
  boardCards: number // ширина пяти карт стола, rem
  wide: boolean // раскладка широкого окна (Р-53, Р-60): столы рядами, победитель под картами, карты руки крупнее
  cols: number // столов в ряду: на телефоне — до двух (Р-66), на широком окне — 2–3
  center: Size // столы рядами
  gap: number // между местами и между столами
  centerPad: number // от рядов мест до столов
  perRow: number // мест в ряду, не больше
  top: number[][] // номера участников над столами: ряды сверху вниз, в ряду — слева направо
  bottom: number[][] // под столами: так же
  width: number // нужная ширина, rem
  height: number // нужная высота: места, столы и отступы между ними
}

// Раскладка на n участников и m столов. Порядок — по часовой: первая половина — над столами слева
// направо, вторая — под столами справа налево. Мест больше MAX_CASINO_SEATS или меньше одного — ошибка.
// wide — широкое окно (Р-53, Р-60): ширина до WIDE_WIDTH, столы рядами, строка победителя — под картами стола
// в две строки, карты руки крупнее.
// Телефон (Р-66): space — ширина сукна, rem (берётся от MIN_WIDTH до PHONE_MAX_WIDTH); все места входят в один
// ряд — одним рядом над столами, иначе пополам, как прежде; столы — по два в ряд, карты мельче
export function casinoLayout(
  kind: DealKind,
  players: number,
  tables: number,
  wide = false,
  space = MIN_WIDTH,
): CasinoLayout {
  if (!Number.isInteger(players) || players < 1 || players > MAX_CASINO_SEATS) {
    throw new Error(`За столом казино от 1 до ${MAX_CASINO_SEATS} участников`)
  }
  if (!Number.isInteger(tables) || tables < 1) throw new Error('Столов должно быть не меньше одного')
  const cards = DEAL_KINDS[kind].hand
  const hand = wide ? HAND_CARD[kind] : PHONE_HAND[kind]
  const gap = wide ? GAP : PHONE_GAP
  const centerPad = wide ? CENTER_PAD : PHONE_CENTER_PAD
  const seat = wide
    ? { w: round(Math.max(SEAT_MIN_W, cards * hand.w + (cards - 1) * HAND_GAP + SEAT_PAD)), h: round(hand.h + SEAT_TEXT_H) }
    : { w: round(cards * hand.w + (cards - 1) * HAND_GAP + PHONE_SEAT_PAD), h: round(hand.h + PHONE_SEAT_TEXT_H) }
  const winCard = wide ? WIDE_WIN_CARD : PHONE_WIN_CARD
  const winRow = {
    w: round(BOARD_CARDS * winCard.w + (BOARD_CARDS - 1) * WIN_GAP),
    h: round(winCard.h + (wide ? WIN_ROW_PAD : PHONE_WIN_ROW_PAD)),
  }
  const boardCard = wide ? BOARD_CARD : PHONE_BOARD_CARD
  const boardCards = round(BOARD_CARDS * boardCard.w + (BOARD_CARDS - 1) * (wide ? BOARD_GAP : PHONE_BOARD_GAP))
  // Строка победителя — под картами; на широком окне под «Имя · рука» — две строки
  const board = wide
    ? { w: round(boardCards + BOARD_PAD), h: round(boardCard.h + BOARD_TEXT_H + WIDE_WIN_LINE + winRow.h + BOARD_PAD) }
    : { w: round(boardCards + PHONE_BOARD_PAD), h: round(boardCard.h + PHONE_BOARD_TEXT_H + winRow.h + PHONE_BOARD_PAD) }
  const limit = wide ? WIDE_WIDTH : Math.min(PHONE_MAX_WIDTH, Math.max(MIN_WIDTH, space))
  const perRow = Math.max(1, Math.floor((limit + gap) / (seat.w + gap)))
  const ids = Array.from({ length: players }, (_, i) => i)
  // Телефон: все в один ряд — одним рядом сверху, не пополам (Р-66)
  const upper = !wide && players <= perRow ? players : Math.ceil(players / 2)
  const top = rows(ids.slice(0, upper), perRow)
  const bottom = rows(ids.slice(upper).reverse(), perRow)
  const cols = wide ? boardCols(tables) : Math.min(PHONE_COLS, tables)
  const boardRows = Math.ceil(tables / cols)
  const center = {
    w: round(cols * board.w + (cols - 1) * gap),
    h: round(boardRows * board.h + (boardRows - 1) * gap),
  }
  const width = round(Math.max(perRow * seat.w + (perRow - 1) * gap, center.w))
  const height = round(
    blockHeight(top.length, seat.h, gap) + center.h + blockHeight(bottom.length, seat.h, gap) + 2 * centerPad,
  )
  return {
    hand,
    seat,
    boardCard,
    board,
    winCard,
    winRow,
    boardCards,
    wide,
    cols,
    center,
    gap,
    centerPad,
    perRow,
    top,
    bottom,
    width,
    height,
  }
}

// Столов в ряду на широком окне (Р-53): до трёх в ряд; четыре — квадратом 2 × 2, а не 3 + 1
export function boardCols(tables: number): number {
  return tables === 4 ? 2 : Math.min(tables, 3)
}

// Где что лежит: места по номеру участника и колонка столов — прямоугольниками в rem
export function layoutBoxes(l: CasinoLayout): { seats: Box[]; center: Box } {
  const seats: Box[] = []
  const place = (block: number[][], y0: number) =>
    block.forEach((row, r) => {
      const rowW = row.length * l.seat.w + (row.length - 1) * l.gap
      row.forEach((id, k) => {
        seats[id] = {
          x: round((l.width - rowW) / 2 + k * (l.seat.w + l.gap)),
          y: round(y0 + r * (l.seat.h + l.gap)),
          ...l.seat,
        }
      })
    })
  place(l.top, 0)
  const centerY = blockHeight(l.top.length, l.seat.h, l.gap) + l.centerPad
  place(l.bottom, centerY + l.center.h + l.centerPad)
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

function blockHeight(rowCount: number, seatH: number, gap: number): number {
  return rowCount === 0 ? 0 : rowCount * seatH + (rowCount - 1) * gap
}

// Ширина сукна на телефоне, rem (Р-66): колонка экрана (.screen — не шире 640 px, поля по 16 px) в rem окна;
// от MIN_WIDTH до PHONE_MAX_WIDTH
export function phoneSpace(windowPx: number, remPx: number): number {
  const column = Math.min(windowPx, 640) - 2 * 16
  return Math.min(PHONE_MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor((column / remPx) * 100) / 100))
}

function round(x: number): number {
  return Math.round(x * 100) / 100
}
