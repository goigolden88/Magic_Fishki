import { useEffect, useRef, useState } from 'react'
import { savedHands, unsavedHands, type Evening } from '../calc/evenings'
import type { Card } from '../poker/cards'
import type { HistoryHand } from '../poker/history'
import type { TableState } from '../poker/table'
import { saveHands } from '../store/db'

export const NO_COPY = 'Память браузера недоступна — раздачи этого вечера на телефоне не сохраняются; игра идёт'

// Копия раздач вечера на этом телефоне (#114): каждый ответ истории — новые раздачи и изменённые
// «Показать» в IndexedDB; записанные второй раз не пишутся. false — запись не удалась: одно
// предупреждение на весь стол, игра идёт дальше. mine — свои карты по номеру раздачи (Р-54)
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
      },
      () => setWorks(false),
    )
  }, [hands, evening.id])

  return works
}

// Свои карты в раздачах (Р-54): пока раздача идёт, телефон их видит — запоминаем по номеру.
// Запись раздачи карт сбросивших не хранит, а в выгрузке свои карты нужны и после паса
export function useMyCards(table: TableState, myCards: Card[] | null): ReadonlyMap<number, Card[]> {
  const mine = useRef(new Map<number, Card[]>())
  const number = table.hand?.number
  if (number !== undefined && myCards && !mine.current.has(number)) mine.current.set(number, myCards)
  return mine.current
}
