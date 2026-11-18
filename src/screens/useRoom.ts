import { useEffect, useRef, useState } from 'react'
import {
  closeKind,
  errorKind,
  NO_CONNECTION,
  retryDelay,
  roomServer,
  socketUrl,
  versionGap,
  type Seat,
  type VersionGap,
} from '../calc/pokerLink'
import { PING, PING_MS, PONG, PROTOCOL_VERSION, SILENT_MS, type ClientBody, type RoomMessage, type RosterEntry } from '../poker/protocol'
import type { HistoryHand } from '../poker/history'
import type { TableState } from '../poker/table'
import { loadMyAvatar, loadSeat, loadServer, saveSeat, subscribeLook } from './pokerStorage'

// Соединение с комнатой: вход, стол, обрывы. Обрыв или сон телефона — переподключение само,
// с местом из памяти устройства (токен) — без повторного выбора

type WithoutV<T> = T extends unknown ? Omit<T, 'v'> : never
export type RoomBody = ClientBody | WithoutV<RoomMessage>

// loading — ещё нет ни списка, ни стола; lobby — выбрать себя; seated — за столом;
// closed — комнаты нет; update — другая версия; replaced — стол открыт на другом устройстве
export type RoomPhase = 'loading' | 'lobby' | 'seated' | 'closed' | 'update' | 'replaced'

// closed (#313) — стол закрыт ведущим: новым по ссылке не сесть
export type Lobby = { roster: RosterEntry[]; seated: string[]; closed: boolean }

export type Room = {
  server: string // сервер комнаты (#83): он — в ссылках «Поделиться» и строке «Сервер: …»
  phase: RoomPhase
  versionGap: VersionGap // при phase 'update' (#107): что старее — сервер или приложение
  online: boolean // соединение открыто
  failed: boolean // попытка связи не удалась — «Нет связи с сервером»
  lobby: Lobby | null
  table: TableState | null
  me: string | null
  ended: { table: TableState | null; reason: string } | null
  error: string | null // отказ сервера на последнее действие
  reseated: { playerId: string; token: string } | null // ведущему: новое место для «Пересадить»
  history: HistoryHand[] | null // история раздач вечера (#113) — последний ответ сервера; null — ещё не приходила
  avatars: Record<string, string> // аватарки комнаты (#298): id игрока → аватарка; у кого нет — по умолчанию
  askHistory: () => void // попросить историю; без связи — ничего, отказ последнего действия не трогает
  send: (body: RoomBody) => boolean
  join: (choice: { regularId: string } | { name: string }) => void
  resume: () => void // после «стол открыт на другом устройстве» — вернуться сюда
  clearError: () => void
  clearReseated: () => void
  // Время сервера по часам телефона: поправка — по времени, присланному со столом. Сроки хода — в нём
  serverNow: () => number
}

const OPEN_TIMEOUT_MS = 8000
const HIDDEN_RECONNECT_MS = 15_000 // телефон спал дольше — соединение могло умереть молча

// linkServer — сервер из ссылки (#83); нет — запомненный местом, иначе — из «Настроек»
export function useRoom(code: string, linkServer?: string): Room {
  const [target] = useState(() => roomServer(linkServer, loadSeat(code), loadServer()))
  const base = target.base
  const [phase, setPhase] = useState<RoomPhase>('loading')
  const [gap, setGap] = useState<VersionGap>('app')
  const [online, setOnline] = useState(false)
  const [failed, setFailed] = useState(false)
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [table, setTable] = useState<TableState | null>(null)
  const [me, setMe] = useState<string | null>(() => target.seat?.playerId ?? null)
  const [ended, setEnded] = useState<Room['ended']>(null)
  const [error, setError] = useState<string | null>(null)
  const [reseated, setReseated] = useState<Room['reseated']>(null)
  const [history, setHistory] = useState<HistoryHand[] | null>(null)
  const [avatars, setAvatars] = useState<Record<string, string>>({})
  const sentAvatar = useRef<string | null | undefined>(undefined) // своя аватарка, что ушла этим соединением

  const ws = useRef<WebSocket | null>(null)
  const seat = useRef<Seat | null>(target.seat)
  const joining = useRef<'seat' | 'new' | null>(null)
  const attempt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stopped = useRef(false)
  const connectRef = useRef<() => void>(() => {})
  const heardAt = useRef(0) // когда сервер последний раз что-то прислал
  const clockOffset = useRef(0) // время сервера минус часы телефона — при последнем столе
  const serverVersion = useRef<unknown>(undefined) // v последнего сообщения сервера — для «другой версии» (#107)

  function forgetSeat() {
    seat.current = null
    saveSeat(code, null)
  }

  function stop(next: RoomPhase) {
    stopped.current = true
    clearTimeout(timer.current)
    if (next === 'update') setGap(versionGap(serverVersion.current, base))
    setPhase(next)
  }

  function onMessage(raw: unknown) {
    heardAt.current = Date.now()
    if (raw === PONG) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(String(raw)) as Record<string, unknown>
    } catch {
      return
    }
    serverVersion.current = msg.v
    switch (msg.type) {
      case 'lobby':
        setLobby({ roster: msg.roster as RosterEntry[], seated: msg.seated as string[], closed: msg.closed === true })
        if (!seat.current && joining.current !== 'new') setPhase((p) => (p === 'loading' ? 'lobby' : p))
        return
      case 'welcome': {
        const next = { playerId: msg.playerId as string, token: msg.token as string }
        seat.current = next
        saveSeat(code, { ...next, server: base })
        joining.current = null
        setMe(next.playerId)
        setError(null)
        setPhase('seated')
        syncAvatar() // сменили, пока шёл вход, — догнать
        return
      }
      case 'state':
        // Отсчёт хода — от остатка у сервера: часы телефона могут расходиться с ним
        if (typeof msg.now === 'number') clockOffset.current = msg.now - Date.now()
        setTable(msg.table as TableState)
        return
      case 'reseated':
        setReseated({ playerId: msg.playerId as string, token: msg.token as string })
        return
      case 'history':
        if (Array.isArray(msg.hands)) setHistory(msg.hands as HistoryHand[])
        return
      // Аватарки (#298): при входе — все заданные в комнате, при смене — одна; кривые экран не рисует (avatarOf)
      case 'avatars':
        if (msg.avatars && typeof msg.avatars === 'object') setAvatars({ ...(msg.avatars as Record<string, string>) })
        return
      case 'avatar': {
        const id = msg.playerId
        if (typeof id !== 'string') return
        const avatar = typeof msg.avatar === 'string' ? msg.avatar : null
        setAvatars((all) => {
          const next = { ...all }
          if (avatar === null) delete next[id]
          else next[id] = avatar
          return next
        })
        return
      }
      case 'ended':
        forgetSeat()
        setEnded({ table: msg.table as TableState, reason: String(msg.reason) })
        stop('closed')
        return
      case 'error': {
        const text = String(msg.error)
        const kind = errorKind(text)
        if (kind === 'closed') {
          forgetSeat()
          setEnded((e) => e ?? { table: null, reason: '' })
          return stop('closed')
        }
        if (kind === 'update') return stop('update')
        if (joining.current === 'seat') {
          // Место на этом устройстве больше не действует (пересадили или убрали) — выбрать заново
          joining.current = null
          forgetSeat()
          setMe(null)
          setError('Ваше место на этом устройстве больше не действует — выберите себя снова')
          setPhase('lobby')
          return
        }
        if (joining.current === 'new') joining.current = null
        setError(text)
        return
      }
    }
  }

  // Своя аватарка (#298) сменилась («Мой вид стола» в «⚙» или в «Настройках») — за столом отправить новую,
  // одним сообщением avatar; стол не трогается. Не за столом или без связи — уйдёт со следующим входом
  function syncAvatar() {
    const socket = ws.current
    if (!seat.current || joining.current !== null || !socket || socket.readyState !== WebSocket.OPEN) return
    const avatar = loadMyAvatar()
    if (avatar === sentAvatar.current) return
    sentAvatar.current = avatar
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'avatar', avatar }))
  }
  const syncAvatarRef = useRef(syncAvatar)
  syncAvatarRef.current = syncAvatar

  function scheduleRetry() {
    if (stopped.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => connectRef.current(), retryDelay(attempt.current))
    attempt.current++
  }

  function connect() {
    clearTimeout(timer.current)
    if (stopped.current) return
    serverVersion.current = undefined // версия — только этого соединения: сервер могли выкатить заново
    let socket: WebSocket
    try {
      socket = new WebSocket(socketUrl(base, code))
    } catch {
      setFailed(true)
      scheduleRetry()
      return
    }
    ws.current = socket
    const openTimer = setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) socket.close()
    }, OPEN_TIMEOUT_MS)
    socket.onopen = () => {
      clearTimeout(openTimer)
      attempt.current = 0
      heardAt.current = Date.now()
      setOnline(true)
      setFailed(false)
      const s = seat.current
      sentAvatar.current = undefined
      if (s) {
        joining.current = 'seat'
        const avatar = loadMyAvatar()
        sentAvatar.current = avatar
        socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'join', playerId: s.playerId, token: s.token, avatar }))
      }
    }
    socket.onmessage = (e) => onMessage(e.data)
    socket.onclose = (e) => {
      clearTimeout(openTimer)
      if (ws.current !== socket) return // это соединение уже заменили
      ws.current = null
      setOnline(false)
      if (joining.current === 'new') joining.current = null
      const kind = closeKind(e.code)
      if (kind === 'closed') {
        forgetSeat()
        setEnded((x) => x ?? { table: null, reason: '' })
        return stop('closed')
      }
      if (kind === 'update') return stop('update')
      if (kind === 'replaced') return stop('replaced')
      setFailed(true)
      scheduleRetry()
    }
  }
  connectRef.current = connect

  useEffect(() => {
    stopped.current = false
    attempt.current = 0
    connectRef.current()
    // Соединение могло умереть молча — открыть новое; старое забыть
    const reopen = () => {
      const old = ws.current
      ws.current = null
      old?.close(1000)
      attempt.current = 0
      connectRef.current()
    }
    // Признак жизни серверу; сервер молчит дольше SILENT_MS — переподключиться.
    // В фоне таймеры редкие, поэтому молчание там не считается: после сна решает wake
    const beat = setInterval(() => {
      const socket = ws.current
      if (stopped.current || !socket || socket.readyState !== WebSocket.OPEN) return
      if (document.visibilityState === 'visible' && Date.now() - heardAt.current > SILENT_MS) return reopen()
      socket.send(PING)
    }, PING_MS)
    let hiddenAt = 0
    const wake = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (stopped.current) return
      const slept = hiddenAt > 0 && Date.now() - hiddenAt > HIDDEN_RECONNECT_MS
      hiddenAt = 0
      if (ws.current && !slept) {
        // Короткий сон: сразу подать признак жизни; молчание — считать заново, во сне ответы не шли
        heardAt.current = Date.now()
        if (ws.current.readyState === WebSocket.OPEN) ws.current.send(PING)
        return
      }
      reopen()
    }
    const back = () => {
      if (!stopped.current && !ws.current) {
        attempt.current = 0
        connectRef.current()
      }
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', back)
    const unsubscribeLook = subscribeLook(() => syncAvatarRef.current())
    return () => {
      unsubscribeLook()
      stopped.current = true
      clearTimeout(timer.current)
      clearInterval(beat)
      const old = ws.current
      ws.current = null
      old?.close(1000)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', back)
    }
  }, [code])

  function send(body: RoomBody): boolean {
    const socket = ws.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError(NO_CONNECTION)
      return false
    }
    setError(null)
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...body }))
    return true
  }

  return {
    server: base,
    phase,
    versionGap: gap,
    online,
    failed,
    lobby,
    table,
    me,
    ended,
    error,
    reseated,
    history,
    avatars,
    askHistory() {
      const socket = ws.current
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'history' }))
    },
    send,
    join(choice) {
      const avatar = loadMyAvatar()
      if (send({ type: 'join', ...choice, avatar })) {
        joining.current = 'new'
        sentAvatar.current = avatar
      }
    },
    resume() {
      stopped.current = false
      attempt.current = 0
      setPhase(seat.current ? 'loading' : 'lobby')
      connectRef.current()
    },
    clearError: () => setError(null),
    clearReseated: () => setReseated(null),
    serverNow: () => Date.now() + clockOffset.current,
  }
}
