// Один экземпляр синхронизации на приложение (#265): состояние прохода и таймеры живут в нём.
// Запуск — startAutoSync в src/main.tsx; экран — раздел «Синхронизация» в «Настройках»
import { useEffect, useState } from 'react'
import { onChange } from '../store/db'
import { localConfig } from './config'
import { lastSyncAt, realPorts } from './ports'
import { createSync, type SyncStatus } from './sync'

export const sync = createSync({ config: localConfig, ports: realPorts, onChange, lastAt: lastSyncAt })

// Состояние синхронизации для экрана
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState(sync.getStatus)
  useEffect(() => {
    const off = sync.subscribe(setStatus)
    void sync.refreshStatus()
    return () => {
      off()
    }
  }, [])
  return status
}

// Счётчик влитого с другого устройства: экран кладёт его в зависимости чтения и перечитывает данные.
// Только экраны вне стола (#265): «Прошлые вечера», учёт, чарты, «Настройки»
export function useRemoteVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(
    () =>
      onChange((origin) => {
        if (origin === 'remote') setVersion((n) => n + 1)
      }),
    [],
  )
  return version
}
