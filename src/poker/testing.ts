// Помощник тестов: прогоняет сообщения через стол. roundtrip — состояние сохраняется
// в JSON и поднимается между каждыми двумя сообщениями, как на сервере со сном
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { createTable, handle, setOnline, type Settings, type TableState } from './table'

// Стол: первый — ведущий, остальные садятся по порядку; stacks — стеки, заданные ведущим
export function newTable(ids: string[], settings: Partial<Settings> = {}, stacks: Record<string, number> = {}): TableState {
  const r = createTable(ids[0], ids[0].toUpperCase(), settings, 0)
  if (!r.ok) throw new Error(r.error)
  const steps: Step[] = ids.slice(1).map((id) => sit(id, id.toUpperCase()))
  for (const [playerId, chips] of Object.entries(stacks)) steps.push({ from: ids[0], msg: { type: 'setStack', playerId, chips } })
  return play(r.state, steps, false)
}

export type Step =
  | { from: string; msg: ClientBody; now?: number }
  | { from: string; online: boolean; now?: number }

export function play(state: TableState, steps: Step[], roundtrip: boolean): TableState {
  steps.forEach((step, i) => {
    if (roundtrip) state = JSON.parse(JSON.stringify(state)) as TableState
    const now = step.now ?? 0
    if ('online' in step) {
      state = setOnline(state, step.from, step.online, now)
      return
    }
    const r = handle(state, step.from, { ...step.msg, v: PROTOCOL_VERSION }, now)
    if (!r.ok) throw new Error(`Шаг ${i + 1} (${step.from} ${step.msg.type}): ${r.error}`)
    state = r.state
  })
  return roundtrip ? (JSON.parse(JSON.stringify(state)) as TableState) : state
}

// Короткие шаги для сценариев
export const bet = (from: string, action: Extract<ClientBody, { type: 'act' }>['action']): Step => ({
  from,
  msg: { type: 'act', action },
})
export const fold = (from: string) => bet(from, { type: 'fold' })
export const check = (from: string) => bet(from, { type: 'check' })
export const call = (from: string) => bet(from, { type: 'call' })
export const raise = (from: string, to: number) => bet(from, { type: 'raise', to })
export const allin = (from: string) => bet(from, { type: 'allin' })
export const sit = (from: string, name: string, now = 0): Step => ({ from, msg: { type: 'sit', name }, now })
export const start = (host: string): Step => ({ from: host, msg: { type: 'start' } })
export const award = (host: string, winners: string[][], now = 0): Step => ({ from: host, msg: { type: 'award', winners }, now })

// Оба способа прогона — для describe.each
export const MODES: [string, boolean][] = [
  ['без сохранения', false],
  ['с сохранением между сообщениями', true],
]
