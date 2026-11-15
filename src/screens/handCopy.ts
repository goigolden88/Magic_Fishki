import { useEffect, useRef, useState } from 'react'
import { savedHands, unsavedHands, type Evening } from '../calc/evenings'
import type { Card } from '../poker/cards'
import type { HistoryHand } from '../poker/history'
import type { TableState } from '../poker/table'
import { eveningRecords, saveHands } from '../store/db'
import { clearPendingMine, loadPendingMine, savePendingMine } from './pokerStorage'

export const NO_COPY = 'Память браузера недоступна — раздачи этого вечера на телефоне не сохраняются; игра идёт'

// Копия раздач вечера на этом телефоне (#114): каждый ответ истории — новые раздачи и изменённые
// «Показать» в IndexedDB; записанные второй раз не пишутся. false — запись не удалась: одно
// предупреждение на весь стол, игра идёт дальше. mine — свои карты по номеру раздачи (Р-54);
// записанные раздачи — из ожидающих записи своих карт комнаты (#239) стираются
export function useHandCopy(evening: Evening, hands: HistoryHand[] | null, mine?: ReadonlyMap<number, Card[]>): boolean {
  const [works, setWorks] = useState(true)
  const known = useRef<{ evening: string; hands: Map<number, string> }>({ evening: evening.id, hands: new Map() })
  const latest = useRef(evening)
  latest.current = evening

  useEffect(() => {
    if (!hands) return
    const e = latest.current
    if (known.current.evening !== e.id) known.current = { evening: e.id, hands: new Map() }
    const saved = known.current
    const fresh = unsavedHands(saved.hands, hands)
    if (fresh.length === 0) return
    saveHands(savedHands(e, fresh, mine)).then(
      () => {
        for (const h of fresh) saved.hands.set(h.number, JSON.stringify(h))
        clearPendingMine(e.id, fresh.map((h) => h.number))
      },
      () => setWorks(false),
    )
  }, [hands, evening.id])

  return works
}

// Свои карты в раздачах (Р-54, #239): пока раздача идёт, телефон их видит — запоминаем по номеру.
// Запись раздачи карт сбросивших не хранит, а в истории и выгрузке свои карты нужны и после паса.
// Уже записанные в «Прошлые вечера» — оттуда: после перезагрузки и входа позже история за столом с ними.
// keep — комната: карты незаписанной раздачи — ещё и в localStorage (`loadPendingMine`), перезагрузка
// посреди раздачи их не теряет; стол с ботами их не держит — стол с картами хранится после каждого хода
export function useMyCards(evening: string, table: TableState, myCards: Card[] | null, keep: boolean): ReadonlyMap<number, Card[]> {
  const mine = useRef<{ evening: string; cards: Map<number, Card[]> } | null>(null)
  const [, setLoaded] = useState(0)
  if (mine.current?.evening !== evening) mine.current = { evening, cards: keep ? loadPendingMine(evening) : new Map() }
  const cards = mine.current.cards
  const number = table.hand?.number
  if (number !== undefined && myCards && !cards.has(number)) {
    cards.set(number, myCards)
    if (keep) savePendingMine(evening, number, myCards)
  }

  useEffect(() => {
    let alive = true
    eveningRecords(evening).then(
      (records) => {
        const now = mine.current
        if (!alive || now?.evening !== evening) return
        let added = false
        for (const r of records) {
          if (!r.mine || now.cards.has(r.number)) continue
          now.cards.set(r.number, r.mine)
          added = true
        }
        if (added) setLoaded((n) => n + 1)
      },
      () => {}, // память браузера не читается — карты только этого захода
    )
    return () => {
      alive = false
    }
  }, [evening])

  return cards
}
