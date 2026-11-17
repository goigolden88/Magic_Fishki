// Копия из FamilyCore@d9e5ec6 (ui/syncDot.ts), правится здесь.
// Точка состояния синхронизации — у раздела «Синхронизация» в «Настройках»: красная — что-то сломалось,
// серая — очередь не ушла. Не настроенная синхронизация точки не даёт: у неё очередь не уходит никогда,
// и вечная точка у того, кто синхронизацию не заводил, — шум
import type { SyncStatus } from './sync'

export type SyncDot = '' | 'dot' | 'dot dot--error'

export function syncDot(status: Pick<SyncStatus, 'state' | 'pending'>): SyncDot {
  if (status.state === 'off') return ''
  if (status.state === 'error') return 'dot dot--error'
  return status.pending > 0 ? 'dot' : ''
}
