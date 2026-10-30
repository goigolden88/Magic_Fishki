// Прошлые вечера (#114, Р-37): копия раздач вечера на телефоне. Каждая раздача — записью
// хранилища hands (store/db.ts) под ключом «вечер + номер»: та же раздача второй раз заменяет
// запись, а не дописывается. Здесь — чем вечер назван, что записать и как показать список
import type { HistoryHand } from '../poker/history'
import type { TableState } from '../poker/table'

// Вечер — один стол: комната по коду или стол на этом телефоне (code — null)
export type Evening = {
  id: string
  code: string | null
  startedAt: number // мс — закуп ведущего при создании стола
}

// Запись хранилища: раздача и её вечер; раздача — как пришла за столом (HistoryHand)
export type SavedHand = { evening: string; code: string | null; startedAt: number; number: number; hand: HistoryHand }

export type EveningSummary = Evening & { hands: number } // hands — сколько раздач записано

// Начало стола — первая запись журнала фишек: закуп ведущего при создании (createTable)
function startOf(table: TableState): number {
  return table.chipLog[0]?.at ?? 0
}

// Комната: код комнаты не уникален во времени (освобождается после конца) — вечер по коду и началу стола
export function roomEvening(code: string, table: TableState): Evening {
  const startedAt = startOf(table)
  return { id: `${code}-${startedAt}`, code, startedAt }
}

// Стол на этом телефоне — по своему id стола
export function localEvening(localId: string, table: TableState): Evening {
  return { id: `local-${localId}`, code: null, startedAt: startOf(table) }
}

export function savedHands(evening: Evening, hands: HistoryHand[]): SavedHand[] {
  return hands.map((hand) => ({ evening: evening.id, code: evening.code, startedAt: evening.startedAt, number: hand.number, hand }))
}

// Что записать из ответа истории: новые раздачи и изменённые «Показать»; known — записанные: номер → запись текстом
export function unsavedHands(known: ReadonlyMap<number, string>, hands: HistoryHand[]): HistoryHand[] {
  return hands.filter((h) => known.get(h.number) !== JSON.stringify(h))
}

// Новые вечера сверху
export function byNewest(evenings: EveningSummary[]): EveningSummary[] {
  return [...evenings].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
}

// Строка вечера: «Стол KQ7MZP · раздач 12» или «Стол на телефоне · раздач 3»
export function eveningLine(e: EveningSummary): string {
  return `${e.code ? `Стол ${e.code}` : 'Стол на телефоне'} · раздач ${e.hands}`
}

// День вечера по часам телефона: YYYY-MM-DD
export function eveningDay(e: Evening): string {
  const d = new Date(e.startedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
