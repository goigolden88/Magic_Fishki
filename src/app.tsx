import { useEffect, useState } from 'react'
import { GamesScreen } from './screens/Games'
import { GameScreen } from './screens/Game'
import { SettingsScreen } from './screens/Settings'
import { ImportScreen } from './screens/Import'
import { PlayersScreen } from './screens/Players'
import { PlayerScreen } from './screens/Player'
import { HelpScreen } from './screens/Help'
import { PokerHomeScreen } from './screens/PokerHome'
import { PokerRoomScreen } from './screens/PokerRoom'
import { normalizeCode, roomHash, type Seat } from './calc/pokerLink'
import { saveSeat } from './screens/pokerStorage'

// Маршруты: #/ — игры, #/game/:id — игра, #/settings — настройки, #/import — из Телеграма, #/players — игроки,
// #/players/:id — карточка постоянного игрока, #/help — справка, #/poker — покер онлайн,
// #/poker/:код — стол, #/poker/:код/:игрок/:токен — стол с местом («пересадить»)
type Route =
  | { screen: 'games' }
  | { screen: 'game'; id: string }
  | { screen: 'settings' }
  | { screen: 'import' }
  | { screen: 'players' }
  | { screen: 'player'; id: string }
  | { screen: 'help' }
  | { screen: 'poker' }
  | { screen: 'pokerRoom'; code: string; seat?: Seat }

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const game = path.match(/^\/game\/([^/]+)$/)
  if (game) return { screen: 'game', id: decodeURIComponent(game[1]) }
  const player = path.match(/^\/players\/([^/]+)$/)
  if (player) return { screen: 'player', id: decodeURIComponent(player[1]) }
  const room = path.match(/^\/poker\/([^/]+)(?:\/([^/]+)\/([^/]+))?$/)
  const code = room ? normalizeCode(decodeURIComponent(room[1])) : null
  if (room && code) {
    const seat = room[2] && room[3] ? { playerId: decodeURIComponent(room[2]), token: decodeURIComponent(room[3]) } : undefined
    return { screen: 'pokerRoom', code, seat }
  }
  if (path === '/settings') return { screen: 'settings' }
  if (path === '/import') return { screen: 'import' }
  if (path === '/players') return { screen: 'players' }
  if (path === '/help') return { screen: 'help' }
  if (path === '/poker') return { screen: 'poker' }
  return { screen: 'games' }
}

// Место из ссылки «пересадить» запоминается на устройстве и убирается из адреса:
// с ним стол откроется и без ссылки, а в адресной строке токена не видно
function currentRoute(): Route {
  const route = parseRoute(location.hash)
  if (route.screen !== 'pokerRoom' || !route.seat) return route
  saveSeat(route.code, route.seat)
  history.replaceState(null, '', roomHash(route.code))
  return { screen: 'pokerRoom', code: route.code }
}

export function App() {
  const [route, setRoute] = useState(currentRoute)

  useEffect(() => {
    const onChange = () => {
      setRoute(currentRoute())
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
    case 'poker':
      return <PokerHomeScreen />
    case 'pokerRoom':
      return <PokerRoomScreen key={route.code} code={route.code} />
    default:
      return <GamesScreen />
  }
}
