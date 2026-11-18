// Кулер (#262, Р-97): на вскрытии сошлись две сильные руки, и проигравший вложил много — у мест обоих
// короткая подпись «Кулер!», а в истории раздач — пометка «кулер». Только экран: стол и сервер о нём не знают,
// нового поля в записи раздачи нет — считается по ней каждый раз.
// Кулер, если всё сразу: раздача с картами на телефонах (record) и дошла до вскрытия; холдем — у двоих рука
// не слабее флеша, омаха — не слабее фулл-хауса, другие игры (шорт-дек, свои) — нет; в «Миксе» — по игре
// этой раздачи (record.game). Холдем, кроме того (#295): у проигравшего стрит или сет (тройка с карманной парой),
// и обе его карты — в его лучшей пятёрке; победитель тогда сильнее сам собой. Проигравший — дошёл до вскрытия
// и не взял ни одного банка, вложил от 20 ББ.
// Прогнали несколько раз (#167) — по первому борду. Проигравших несколько — тот, у кого рука сильнее
import { bestHand, compareHands, type Card, type Category, type HandResult as Strength } from '../poker/cards'
import type { HandResult } from '../poker/table'
import { invested } from './invested'

export type Cooler = { winner: string; loser: string }

// Порог силы руки по игре раздачи; игры нет в списке — кулера нет
const FLOOR: Record<string, Category> = { holdem: 'flush', omaha: 'fullHouse' }
export const COOLER_MIN_BB = 20

export function coolerOf(result: HandResult): Cooler | null {
  const record = result.record
  const floor = record?.game ? FLOOR[record.game.id] : undefined
  if (!record || !floor || !(record.bb > 0)) return null
  try {
    const variant = record.game.variant
    const min = variant.order.indexOf(floor)
    // Дошедшие до вскрытия — у кого записана рука
    const showdown = Object.keys(record.hands ?? {})
    if (showdown.length < 2 || !Array.isArray(record.board)) return null
    // Взявшие банк на первом борде: прогонов несколько — победители первого, иначе — банков раздачи
    const first = record.runs?.[0]?.winners ?? result.pots.map((p) => p.winners)
    const took = new Set(first.flat())
    const strong: { id: string; hand: Strength; cards: Card[] }[] = []
    for (const id of showdown) {
      const cards = record.shown?.[id]
      if (!Array.isArray(cards) || cards.length === 0 || cards.some((c) => c === null)) continue
      strong.push({ id, hand: bestHand(variant, cards as Card[], record.board), cards: cards as Card[] })
    }
    const top = (list: typeof strong) => list.reduce<(typeof strong)[number] | null>((a, b) => (!a || compareHands(b.hand, a.hand) > 0 ? b : a), null)
    const winner = top(strong.filter((s) => took.has(s.id)))
    const loser = top(strong.filter((s) => !took.has(s.id)))
    if (!winner || !loser) return null
    const both = winner.hand.value[0] >= min && loser.hand.value[0] >= min
    if (!both && !(record.game.id === 'holdem' && setOrStraight(loser))) return null
    if ((invested(record).get(loser.id) ?? 0) < COOLER_MIN_BB * record.bb) return null
    return { winner: winner.id, loser: loser.id }
  } catch {
    // Запись с другого телефона или старой версии — без доверия к полям: не разобрать — не кулер
    return null
  }
}

// Холдем (#295): рука проигравшего — стрит или сет, и обе его карты в лучшей пятёрке. Сет — тройка из карманной
// пары: трипс с одной картой руки (вторая — кикер) не годится
function setOrStraight(p: { hand: Strength; cards: Card[] }): boolean {
  const { hand, cards } = p
  if (cards.length !== 2 || !cards.every((c) => hand.cards.includes(c))) return false
  if (hand.category === 'straight') return true
  return hand.category === 'trips' && cards[0][0] === cards[1][0] && hand.cards[0][0] === cards[0][0]
}
