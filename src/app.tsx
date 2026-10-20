import { useEffect, useState } from 'react'
import { GamesScreen } from './screens/Games'
import { GameScreen } from './screens/Game'
import { SettingsScreen } from './screens/Settings'
import { ImportScreen } from './screens/Import'
import { PlayersScreen } from './screens/Players'
import { PlayerScreen } from './screens/Player'
import { HelpScreen } from './screens/Help'

// Маршруты: #/ — игры, #/game/:id — игра, #/settings — настройки, #/import — из Телеграма, #/players — игроки,
// #/players/:id — карточка постоянного игрока, #/help — справка
type Route =
  | { screen: 'games' }
  | { screen: 'game'; id: string }
  | { screen: 'settings' }
  | { screen: 'import' }
  | { screen: 'players' }
  | { screen: 'player'; id: string }
  | { screen: 'help' }

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const game = path.match(/^\/game\/([^/]+)$/)
  if (game) return { screen: 'game', id: decodeURIComponent(game[1]) }
  const player = path.match(/^\/players\/([^/]+)$/)
  if (player) return { screen: 'player', id: decodeURIComponent(player[1]) }
  if (path === '/settings') return { screen: 'settings' }
  if (path === '/import') return { screen: 'import' }
  if (path === '/players') return { screen: 'players' }
  if (path === '/help') return { screen: 'help' }
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
    case 'players':
      return <PlayersScreen />
    case 'player':
      return <PlayerScreen key={route.id} id={route.id} />
    case 'help':
      return <HelpScreen />
    default:
      return <GamesScreen />
  }
}
