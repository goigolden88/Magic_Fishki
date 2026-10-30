import { useEffect, useState } from 'react'
import { GamesScreen } from './screens/Games'
import { GameScreen } from './screens/Game'
import { CasinoDealScreen } from './screens/CasinoDeal'
import { SettingsScreen } from './screens/Settings'
import { ImportScreen } from './screens/Import'
import { PlayersScreen } from './screens/Players'
import { PlayerScreen } from './screens/Player'
import { HelpScreen } from './screens/Help'
import { PokerHomeScreen } from './screens/PokerHome'
import { PokerBadLinkScreen, PokerRoomScreen } from './screens/PokerRoom'
import { PokerLocalScreen } from './screens/PokerLocal'
import { PokerBotsScreen } from './screens/PokerBots'
import { parseRoomLink, roomHash, type RoomTarget } from './calc/pokerLink'
import { saveSeat } from './screens/pokerStorage'

// Маршруты: #/ — игры, #/game/:id — игра, #/game/:id/deal — раунд казино с картами, #/settings — настройки, #/import — из Телеграма, #/players — игроки,
// #/players/:id — карточка постоянного игрока, #/help — справка, #/poker — покер онлайн,
// #/poker/:код — стол, #/poker/:код/:игрок/:токен — стол с местом («пересадить»); у обоих в конце может быть
// ?server=адрес — комната на своём сервере (#83), кривой адрес — экран «ссылка не открывается»,
// #/poker/local — стол на этом телефоне, #/poker/bots — против ботов (оба под код из 6 знаков не подходят)
type Route =
  | { screen: 'games' }
  | { screen: 'game'; id: string }
  | { screen: 'casinoDeal'; id: string }
  | { screen: 'settings' }
  | { screen: 'import' }
  | { screen: 'players' }
  | { screen: 'player'; id: string }
  | { screen: 'help' }
  | { screen: 'poker' }
  | ({ screen: 'pokerRoom' } & RoomTarget)
  | { screen: 'pokerBadLink'; error: string }
  | { screen: 'pokerLocal' }
  | { screen: 'pokerBots' }

function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  if (path === '/poker/local') return { screen: 'pokerLocal' }
  if (path === '/poker/bots') return { screen: 'pokerBots' }
  const game = path.match(/^\/game\/([^/]+)$/)
  if (game) return { screen: 'game', id: decodeURIComponent(game[1]) }
  const deal = path.match(/^\/game\/([^/]+)\/deal$/)
  if (deal) return { screen: 'casinoDeal', id: decodeURIComponent(deal[1]) }
  const player = path.match(/^\/players\/([^/]+)$/)
  if (player) return { screen: 'player', id: decodeURIComponent(player[1]) }
  const room = path.startsWith('/poker/') ? parseRoomLink(`#${path}`) : null
  if (room && 'error' in room) return { screen: 'pokerBadLink', error: room.error }
  if (room) return { screen: 'pokerRoom', ...room }
  if (path === '/settings') return { screen: 'settings' }
  if (path === '/import') return { screen: 'import' }
  if (path === '/players') return { screen: 'players' }
  if (path === '/help') return { screen: 'help' }
  if (path === '/poker') return { screen: 'poker' }
  return { screen: 'games' }
}

// Место из ссылки «пересадить» запоминается на устройстве (с сервером из ссылки) и убирается из адреса:
// с ним стол откроется и без ссылки, а в адресной строке токена не видно. Сервер в адресе остаётся
function currentRoute(): Route {
  const route = parseRoute(location.hash)
  if (route.screen !== 'pokerRoom' || !route.seat) return route
  saveSeat(route.code, { ...route.seat, server: route.server })
  history.replaceState(null, '', roomHash(route.code, undefined, route.server))
  return { screen: 'pokerRoom', code: route.code, server: route.server }
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
    case 'casinoDeal':
      return <CasinoDealScreen key={route.id} id={route.id} />
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
      return <PokerRoomScreen key={`${route.code} ${route.server ?? ''}`} code={route.code} server={route.server} />
    case 'pokerBadLink':
      return <PokerBadLinkScreen error={route.error} />
    case 'pokerLocal':
      return <PokerLocalScreen />
    case 'pokerBots':
      return <PokerBotsScreen />
    default:
      return <GamesScreen />
  }
}
