import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { applyOwnBack } from './screens/ownBackImage'
import './styles.css'

// Просим браузер не чистить данные игр при нехватке места
void navigator.storage?.persist?.()

// Своя рубашка картинкой (#220) — на карты до первой отрисовки
applyOwnBack()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
