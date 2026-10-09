import { useEffect, useState } from 'react'
import { GamesScreen } from './screens/Games'
import { GameScreen } from './screens/Game'
import { SettingsScreen } from './screens/Settings'

// Маршруты: #/ — игры, #/game/:id — игра, #/settings — настройки
type Route = { screen: 'games' } | { screen: 'game'; id: string } | { screen: 'settings' }

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const game = path.match(/^\/game\/([^/]+)$/)
  if (game) return { screen: 'game', id: decodeURIComponent(game[1]) }
  if (path === '/settings') return { screen: 'settings' }
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
    default:
      return <GamesScreen />
  }
}
