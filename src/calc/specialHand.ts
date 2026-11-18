// Особые руки (#295): короткий праздник на столе. Только экран: стол и сервер о них не знают, считается на телефоне
// из того, что он и так видит.
// Префлоп — AA, KK, AK (только холдем): своя рука, только на своём телефоне — чужим ничего, иначе выдаёт карты.
// Ривер — стрит-флеш и роял-флеш (холдем и омаха, в «Миксе» — по игре раздачи): раздача кончилась, на столе пять
// карт. Открыли на вскрытии — видят все; взял банк без вскрытия — только у себя. Чужие закрытые карты не берутся.
// Прогнали несколько раз (#167) — по первому борду
import { bestHand, type Card } from '../poker/cards'
import type { GameDef } from '../poker/game'
import { hiddenOf, type HandResult } from '../poker/table'

export type SpecialHand = {
  kind: 'preflop' | 'river'
  playerId: string
  label: string // «Карманные тузы», «Роял-флеш», «Стрит-флеш до девятки»
  own: boolean // видно только своему телефону: префлоп и ривер без вскрытия
}

// Игры, где ривер празднуется
const RIVER_GAMES = new Set(['holdem', 'omaha'])

// Префлоп: мои две карты холдема — AA, KK, AK; иначе null
export function preflopSpecial(game: GameDef | undefined, cards: (Card | null)[] | null | undefined): string | null {
  if (game?.id !== 'holdem' || !Array.isArray(cards) || cards.length !== 2) return null
  if (cards.some((c) => typeof c !== 'string' || c.length !== 2)) return null
  const [a, b] = cards as Card[]
  const ranks = [a[0], b[0]].sort().join('')
  if (ranks === 'AA') return 'Карманные тузы'
  if (ranks === 'KK') return 'Карманные короли'
  if (ranks === 'AK') return a[1] === b[1] ? 'Туз-король одной масти' : 'Туз-король'
  return null
}

// Ривер: прошлая раздача — стрит-флеш у открывшего на вскрытии (сильнейший), иначе у меня, если я взял банк без
// вскрытия; иначе null. meId — я на этом телефоне ('' — меня нет)
export function riverSpecial(result: HandResult | null | undefined, meId: string): SpecialHand | null {
  const record = result?.record
  if (!record || !RIVER_GAMES.has(record.game?.id) || !Array.isArray(record.board) || record.board.length !== 5) return null
  try {
    const variant = record.game.variant
    const flush = (cards: unknown) => {
      if (!Array.isArray(cards) || cards.length === 0 || cards.some((c) => typeof c !== 'string')) return null
      const best = bestHand(variant, cards as Card[], record.board)
      return best.category === 'straightFlush' ? best : null
    }
    // На вскрытии — у кого записана рука; карты — открытые всем
    let top: { id: string; value: number; label: string } | null = null
    for (const id of Object.keys(record.hands ?? {})) {
      const best = flush(record.shown?.[id])
      if (best && (!top || best.value[1] > top.value)) top = { id, value: best.value[1], label: best.name }
    }
    if (top) return { kind: 'river', playerId: top.id, label: top.label, own: false }
    // Без вскрытия — только свои карты и только если банк мой
    if (!meId || !result.pots.some((p) => p.winners.includes(meId))) return null
    const mine = flush(hiddenOf(record)[meId] ?? record.shown?.[meId])
    return mine ? { kind: 'river', playerId: meId, label: mine.name, own: true } : null
  } catch {
    // Запись с другого телефона или старой версии — не разобрать — не праздник
    return null
  }
}
