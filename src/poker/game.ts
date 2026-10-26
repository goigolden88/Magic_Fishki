// Карты на телефонах (этап 2, Р-23): вариант игры — данными (Ш-169), колода, сдача по описанию.
// Описание хранится у раздачи — под будущий «микс». Тасует сервер комнаты (shuffle) и подаёт
// колоду в handle; сами функции чистые. Карты сдаются по описанию, без сжигания
import { buildDeck, HOLDEM, type Card, type Variant } from './cards'
import type { Street } from './hand'
import type { RandomBytes } from './tokens'

// Режим карт комнаты: живые — на столе (этап 1), на телефонах — сдаёт программа
export type CardsMode = 'live' | 'phones'

// Шаг сдачи перед кругом торгов
export type DealStep =
  | { kind: 'hole'; down: number; up: number } // каждому в раздаче: закрытых и открытых
  | { kind: 'flip'; count: number } // каждому открыть столько своих закрытых
  | { kind: 'board'; count: number } // на стол

// Круг торгов и сдача перед ним. Свой режим со своими кругами — новое имя круга в Street
export type GameRound = { street: Street; deal: DealStep[] }

export type GameDef = {
  id: string
  variant: Variant // колода и правило руки
  rounds: GameRound[]
}

export const HOLDEM_GAME: GameDef = {
  id: 'holdem',
  variant: HOLDEM,
  rounds: [
    { street: 'preflop', deal: [{ kind: 'hole', down: 2, up: 0 }] },
    { street: 'flop', deal: [{ kind: 'board', count: 3 }] },
    { street: 'turn', deal: [{ kind: 'board', count: 1 }] },
    { street: 'river', deal: [{ kind: 'board', count: 1 }] },
  ],
}

// Карты раздачи. На сервере — все; в виде для телефона (viewFor) колоды нет, а чужие
// закрытые — null (рубашка)
export type HandCards = {
  game: GameDef
  deck: Card[] // остаток колоды по порядку сдачи
  hole: Record<string, (Card | null)[]> // карты игрока по порядку сдачи
  open: Record<string, number[]> // какие из них видны всем (открытые по описанию)
  board: Card[]
  dealt: number // сколько кругов описания уже сдано
}

// Колода варианта описания — по порядку; перемешивает shuffle
export function deckFor(game: GameDef): Card[] {
  return buildDeck(game.variant)
}

// Фишер–Йейтс на криптослучайности; random — для тестов
export function shuffle<T>(items: T[], random: RandomBytes = (b) => crypto.getRandomValues(b)): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, random)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Равномерно 0…n−1: числа из хвоста, где n не укладывается целиком, отбрасываются
function randomBelow(n: number, random: RandomBytes): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n
  for (;;) {
    const b = random(new Uint8Array(4))
    const x = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
    if (x < limit) return x % n
  }
}

// Колода подходит описанию: ровно его карты, каждая по разу
export function isDeckOf(game: GameDef, deck: unknown): deck is Card[] {
  const full = deckFor(game)
  if (!Array.isArray(deck) || deck.length !== full.length) return false
  const set = new Set<unknown>(deck)
  return set.size === full.length && full.every((c) => set.has(c))
}

// Сколько карт уйдёт из колоды при n игроках, если сдать всё описание
export function cardsNeeded(game: GameDef, n: number): number {
  let total = 0
  for (const round of game.rounds) {
    for (const step of round.deal) {
      if (step.kind === 'hole') total += (step.down + step.up) * n
      if (step.kind === 'board') total += step.count
    }
  }
  return total
}

// Начало раздачи: пустые руки игроков (ids — по местам)
export function newCards(game: GameDef, deck: Card[], ids: string[]): HandCards {
  return {
    game,
    deck: [...deck],
    hole: Object.fromEntries(ids.map((id) => [id, []])),
    open: Object.fromEntries(ids.map((id) => [id, []])),
    board: [],
    dealt: 0,
  }
}

// Сдать следующий круг описания. order — игроки в раздаче по кругу от первого после кнопки,
// сбросившие уже пропущены
export function dealRound(cards: HandCards, order: string[]): void {
  const round = cards.game.rounds[cards.dealt]
  if (!round) return
  cards.dealt++
  for (const step of round.deal) {
    if (step.kind === 'board') cards.board.push(...take(cards, step.count))
    else if (step.kind === 'hole') {
      // По одной карте по кругу: сначала закрытые, затем открытые
      for (let k = 0; k < step.down + step.up; k++) {
        for (const id of order) {
          const [card] = take(cards, 1)
          if (k >= step.down) cards.open[id].push(cards.hole[id].length)
          cards.hole[id].push(card)
        }
      }
    } else {
      for (const id of order) {
        const closed = cards.hole[id].map((_, i) => i).filter((i) => !cards.open[id].includes(i))
        cards.open[id].push(...closed.slice(0, step.count))
      }
    }
  }
}

function take(cards: HandCards, n: number): Card[] {
  return cards.deck.splice(0, n)
}

// Торги закрыты, а в раздаче двое и больше: досдать оставшиеся круги (олл-ин до ривера)
export function runOut(cards: HandCards, order: string[]): void {
  while (cards.dealt < cards.game.rounds.length) dealRound(cards, order)
}

// Карты игрока, которые видят все: открытые по описанию; закрытые — null
export function publicCards(cards: HandCards, id: string): (Card | null)[] {
  return (cards.hole[id] ?? []).map((c, i) => (cards.open[id]?.includes(i) ? c : null))
}
