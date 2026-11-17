import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { applyOwnBack } from './screens/ownBackImage'
import { sync } from './sync/instance'
import './styles.css'

// Просим браузер не чистить данные игр при нехватке места
void navigator.storage?.persist?.()

// Своя рубашка картинкой (#220) — на карты до первой отрисовки
applyOwnBack()

// Синхронизация между устройствами (#265): не настроена — ни одного запроса в сеть; ошибка записи не мешает
sync.startAutoSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
