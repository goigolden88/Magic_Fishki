// Ход заранее (#115): пока ходит другой, игрок отмечает «Чек/пас» или «Колл любой» — и когда очередь
// доходит до него, телефон сам шлёт обычный ход. Сервер и правила об этом не знают
import type { BetAction } from '../poker/protocol'
import type { ActionsView } from './pokerView'

export type PreAction = 'checkFold' | 'callAny'

// Отмеченный флажок и улица, на которой отмечен: на новой улице он снят
export type PreActionMark = { kind: PreAction; street: string }

// Улица раздачи — «номер раздачи-стадия»; между раздачами — null
export function streetKey(handNumber: number, stage: string | null): string | null {
  return stage === null ? null : `${handNumber}-${stage}`
}

// Флажок, который действует сейчас: отмечен на этой улице; иначе — нет
export function activePreAction(mark: PreActionMark | null, street: string | null): PreAction | null {
  return mark !== null && street !== null && mark.street === street ? mark.kind : null
}

// Тап по флажку: отмеченный — снят, другой — отмечен вместо него (отмечен только один)
export function togglePreAction(current: PreAction | null, kind: PreAction): PreAction | null {
  return current === kind ? null : kind
}

// Флажки видны, когда я в раздаче, торги идут и ход не мой; спасовал, олл-ин, между раздачами — нет
export function showPreActions(actions: ActionsView | null): boolean {
  return actions !== null && !actions.myTurn
}

// Какой ход отправить по флажку, когда пришла очередь: «Чек/пас» — чек, если можно, иначе пас;
// «Колл любой» — чек, если уравнивать нечего, иначе колл (не хватает фишек — сервер ставит остаток,
// олл-ин). Не мой ход, я не в раздаче или флажка нет — null
export function preActionMove(kind: PreAction | null, actions: ActionsView | null): BetAction | null {
  if (kind === null || actions === null || !actions.myTurn) return null
  if (actions.check) return { type: 'check' }
  return kind === 'checkFold' ? { type: 'fold' } : { type: 'call' }
}
