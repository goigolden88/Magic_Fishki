import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './styles.css'

// Просим браузер не чистить данные игр при нехватке места
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
