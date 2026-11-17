// Копия из FamilyCore@d9e5ec6 (Я-06), правится здесь
/**
 * «Что нового»: механика списка изменений (Я-06).
 *
 * Сам список — `CHANGES` в `src/changes.ts` приложения: он пишется руками
 * в том же коммите, что и видимое изменение, и у каждого приложения свой.
 * Здесь — что из него показать после обновления и что отметить прочитанным.
 *
 * Взято из `src/changes.ts` «Делу Время» с d86f0aa, механика у них —
 * из «Дневников».
 */

/** День `YYYY-MM-DD` — как `DateStr` ядра. */
export type DateStr = string

export type Change = {
  /** Растёт на единицу с каждой записью. По нему устройство помнит прочитанное. */
  id: number
  date: DateStr
  lines: readonly string[]
}

/**
 * Что показать после обновления и что отметить прочитанным.
 *
 * `seen` — последний прочитанный `id`, null — ключа на устройстве нет.
 * Ключа нет у двух разных установок, и различает их база:
 *
 * - пустая — свежая установка: ей всё новое, и список изменений ей ни о чём
 *   не говорит. Показываем ничего, отмечаем прочитанным всё
 * - с записями — копия, обновившаяся с версии, где этого окна не было:
 *   показываем последнюю запись, ради неё окно и появилось
 */
export function unseenChanges(
  changes: readonly Change[],
  seen: number | null,
  empty: boolean,
): { show: Change[]; markSeen: number | null } {
  const latest = changes.at(-1)?.id ?? null
  if (seen === null) {
    if (empty) return { show: [], markSeen: latest }
    const last = changes.at(-1)
    return { show: last ? [last] : [], markSeen: null }
  }
  return { show: changes.filter((change) => change.id > seen), markSeen: null }
}

/** Последний `id` — его пишет «Понятно». */
export function latestChange(changes: readonly Change[]): number {
  return changes.at(-1)?.id ?? 0
}
