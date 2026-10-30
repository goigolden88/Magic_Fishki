import { useEffect, useRef, useState } from 'react'
import { savedHands, unsavedHands, type Evening } from '../calc/evenings'
import type { HistoryHand } from '../poker/history'
import { saveHands } from '../store/db'

export const NO_COPY = 'Память браузера недоступна — раздачи этого вечера на телефоне не сохраняются; игра идёт'

// Копия раздач вечера на этом телефоне (#114): каждый ответ истории — новые раздачи и изменённые
// «Показать» в IndexedDB; записанные второй раз не пишутся. false — запись не удалась: одно
// предупреждение на весь стол, игра идёт дальше
export function useHandCopy(evening: Evening, hands: HistoryHand[] | null): boolean {
  const [works, setWorks] = useState(true)
  const known = useRef<{ evening: string; hands: Map<number, string> }>({ evening: evening.id, hands: new Map() })
  const latest = useRef(evening)
  latest.current = evening

  useEffect(() => {
    if (!hands) return
    const e = latest.current
    if (known.current.evening !== e.id) known.current = { evening: e.id, hands: new Map() }
    const mine = known.current
    const fresh = unsavedHands(mine.hands, hands)
    if (fresh.length === 0) return
    saveHands(savedHands(e, fresh)).then(
      () => {
        for (const h of fresh) mine.hands.set(h.number, JSON.stringify(h))
      },
      () => setWorks(false),
    )
  }, [hands, evening.id])

  return works
}
