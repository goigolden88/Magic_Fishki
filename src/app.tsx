import { useEffect, useState } from 'react'
import { GamesScreen } from './screens/Games'
import { GameScreen } from './screens/Game'
import { SettingsScreen } from './screens/Settings'
import { ImportScreen } from './screens/Import'

// Маршруты: #/ — игры, #/game/:id — игра, #/settings — настройки, #/import — из Телеграма
type Route = { screen: 'games' } | { screen: 'game'; id: string } | { screen: 'settings' } | { screen: 'import' }

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const game = path.match(/^\/game\/([^/]+)$/)
  if (game) return { screen: 'game', id: decodeURIComponent(game[1]) }
  if (path === '/settings') return { screen: 'settings' }
  if (path === '/import') return { screen: 'import' }
  return { screen: 'games' }
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash))

  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  switch (route.screen) {
    case 'game':
      return <GameScreen key={route.id} id={route.id} />
    case 'settings':
      return <SettingsScreen />
    case 'import':
      return <ImportScreen />
    default:
      return <GamesScreen />
  }
}
