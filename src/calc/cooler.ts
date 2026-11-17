// Кулер (#262, Р-97): на вскрытии сошлись две сильные руки, и проигравший вложил много — у мест обоих
// короткая подпись «Кулер!», а в истории раздач — пометка «кулер». Только экран: стол и сервер о нём не знают,
// нового поля в записи раздачи нет — считается по ней каждый раз.
// Кулер, если всё сразу: раздача с картами на телефонах (record) и дошла до вскрытия; холдем — у двоих рука
// не слабее флеша, омаха — не слабее фулл-хауса, другие игры (шорт-дек, свои) — нет; в «Миксе» — по игре
// этой раздачи (record.game). Проигравший — дошёл до вскрытия и не взял ни одного банка, вложил от 20 ББ.
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
    const strong: { id: string; hand: Strength }[] = []
    for (const id of showdown) {
      const cards = record.shown?.[id]
      if (!Array.isArray(cards) || cards.length === 0 || cards.some((c) => c === null)) continue
      strong.push({ id, hand: bestHand(variant, cards as Card[], record.board) })
    }
    const top = (list: typeof strong) => list.reduce<(typeof strong)[number] | null>((a, b) => (!a || compareHands(b.hand, a.hand) > 0 ? b : a), null)
    const winner = top(strong.filter((s) => took.has(s.id)))
    const loser = top(strong.filter((s) => !took.has(s.id)))
    if (!winner || !loser) return null
    if (winner.hand.value[0] < min || loser.hand.value[0] < min) return null
    if ((invested(record).get(loser.id) ?? 0) < COOLER_MIN_BB * record.bb) return null
    return { winner: winner.id, loser: loser.id }
  } catch {
    // Запись с другого телефона или старой версии — без доверия к полям: не разобрать — не кулер
    return null
  }
}
