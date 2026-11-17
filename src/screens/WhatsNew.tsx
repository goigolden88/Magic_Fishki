// Копия из FamilyCore@d9e5ec6 (Я-06), правится здесь
// (screens/WhatsNew.tsx и screens/useWhatsNew.ts ядра — одним файлом)
import { useEffect, useState } from 'react'
import { latestChange, unseenChanges, type Change } from '../calc/changes'
import { formatDate } from '../dates'
import { chartIds, handKeys, listGames } from '../store/db'
import { loadSeenChange, saveSeenChange, storageWorks } from './pokerStorage'
import { GearPop } from './TableGear'

/**
 * Что показать в «Что нового». Своё вместо ядра (#261): прочитанное — в localStorage этого устройства
 * (`fishki.whatsNew.seen`, `pokerStorage.ts`), а не в базе. Ждёт, пока посчитано, пуста ли база: по ней свежая
 * установка отличается от обновившейся копии. Пустая — нет ни игр, ни прошлых вечеров, ни своих чартов.
 * Память браузера не читается (приватный режим iPhone) — окна нет: иначе оно всплывало бы при каждом запуске.
 *
 * `changes` — список приложения, `CHANGES` из `src/changes.ts` (Я-06).
 */
export function useWhatsNew(changes: readonly Change[]): {
  show: Change[]
  dismiss: () => void
} {
  // undefined — память не работает, окна нет; null — ключа нет
  const [seen, setSeen] = useState<number | null | undefined>(() => (storageWorks() ? loadSeenChange() : undefined))
  // Пуста ли база — только когда ключа нет: иначе не нужна
  const [empty, setEmpty] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    if (seen !== null || empty !== undefined) return
    let alive = true
    Promise.all([listGames(), handKeys(), chartIds()])
      .then(([games, hands, charts]) => {
        if (alive) setEmpty(games.length === 0 && hands.length === 0 && charts.length === 0)
      })
      .catch(() => {
        // база не открылась — показать последнюю запись, как обновившейся копии
        if (alive) setEmpty(false)
      })
    return () => {
      alive = false
    }
  }, [seen, empty])

  const plan = seen === undefined || (seen === null && empty === undefined) ? null : unseenChanges(changes, seen, empty ?? false)
  const mark = plan?.markSeen ?? null

  // Свежая установка: всё прочитано сразу, без показа.
  useEffect(() => {
    if (mark === null) return
    setSeen(mark)
    saveSeenChange(mark)
  }, [mark])

  return {
    show: plan?.show ?? [],
    dismiss: () => {
      const latest = latestChange(changes)
      setSeen(latest)
      saveSeenChange(latest)
    },
  }
}

/**
 * «Что нового» поверх экрана при запуске после обновления (#261, Р-96). Обновления приходят сами и молча,
 * и без этого окна человек не узнает, что поменялось. «Понятно» (и Esc, и касание мимо) — прочитано.
 */
export function WhatsNew({ changes, onDone }: { changes: readonly Change[]; onDone: () => void }) {
  return (
    <GearPop title="Что нового" done="Понятно" onClose={onDone}>
      <ChangeList changes={changes} />
    </GearPop>
  )
}

/** Записи от новых к старым: свежее — первым. */
export function ChangeList({ changes }: { changes: readonly Change[] }) {
  return (
    <>
      {[...changes].reverse().map((change) => (
        <div key={change.id} className="change">
          <p className="muted">{formatDate(change.date)}</p>
          <ul>
            {change.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}
