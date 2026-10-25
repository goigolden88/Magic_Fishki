import { useEffect, useRef, useState } from 'react'
import { closeKind, DEFAULT_SERVER, errorKind, NO_CONNECTION, retryDelay, serverBase, socketUrl, type Seat } from '../calc/pokerLink'
import { PROTOCOL_VERSION, type ClientBody, type RoomMessage, type RosterEntry } from '../poker/protocol'
import type { TableState } from '../poker/table'
import { loadSeat, loadServer, saveSeat } from './pokerStorage'

// Соединение с комнатой: вход, стол, обрывы. Обрыв или сон телефона — переподключение само,
// с местом из памяти устройства (токен) — без повторного выбора

type WithoutV<T> = T extends unknown ? Omit<T, 'v'> : never
export type RoomBody = ClientBody | WithoutV<RoomMessage>

// loading — ещё нет ни списка, ни стола; lobby — выбрать себя; seated — за столом;
// closed — комнаты нет; update — другая версия; replaced — стол открыт на другом устройстве
export type RoomPhase = 'loading' | 'lobby' | 'seated' | 'closed' | 'update' | 'replaced'

export type Lobby = { roster: RosterEntry[]; seated: string[] }

export type Room = {
  phase: RoomPhase
  online: boolean // соединение открыто
  failed: boolean // попытка связи не удалась — «Нет связи с сервером»
  lobby: Lobby | null
  table: TableState | null
  me: string | null
  ended: { table: TableState | null; reason: string } | null
  error: string | null // отказ сервера на последнее действие
  reseated: { playerId: string; token: string } | null // ведущему: новое место для «Пересадить»
  send: (body: RoomBody) => boolean
  join: (choice: { regularId: string } | { name: string }) => void
  resume: () => void // после «стол открыт на другом устройстве» — вернуться сюда
  clearError: () => void
  clearReseated: () => void
}

const OPEN_TIMEOUT_MS = 8000
const HIDDEN_RECONNECT_MS = 15_000 // телефон спал дольше — соединение могло умереть молча

export function useRoom(code: string): Room {
  const [phase, setPhase] = useState<RoomPhase>('loading')
  const [online, setOnline] = useState(false)
  const [failed, setFailed] = useState(false)
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [table, setTable] = useState<TableState | null>(null)
  const [me, setMe] = useState<string | null>(() => loadSeat(code)?.playerId ?? null)
  const [ended, setEnded] = useState<Room['ended']>(null)
  const [error, setError] = useState<string | null>(null)
  const [reseated, setReseated] = useState<Room['reseated']>(null)

  const ws = useRef<WebSocket | null>(null)
  const seat = useRef<Seat | null>(loadSeat(code))
  const joining = useRef<'seat' | 'new' | null>(null)
  const attempt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stopped = useRef(false)
  const connectRef = useRef<() => void>(() => {})

  function forgetSeat() {
    seat.current = null
    saveSeat(code, null)
  }

  function stop(next: RoomPhase) {
    stopped.current = true
    clearTimeout(timer.current)
    setPhase(next)
  }

  function onMessage(raw: unknown) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(String(raw)) as Record<string, unknown>
    } catch {
      return
    }
    switch (msg.type) {
      case 'lobby':
        setLobby({ roster: msg.roster as RosterEntry[], seated: msg.seated as string[] })
        if (!seat.current && joining.current !== 'new') setPhase((p) => (p === 'loading' ? 'lobby' : p))
        return
      case 'welcome': {
        const next = { playerId: msg.playerId as string, token: msg.token as string }
        seat.current = next
        saveSeat(code, next)
        joining.current = null
        setMe(next.playerId)
        setError(null)
        setPhase('seated')
        return
      }
      case 'state':
        setTable(msg.table as TableState)
        return
      case 'reseated':
        setReseated({ playerId: msg.playerId as string, token: msg.token as string })
        return
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

  function scheduleRetry() {
    if (stopped.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => connectRef.current(), retryDelay(attempt.current))
    attempt.current++
  }

  function connect() {
    clearTimeout(timer.current)
    if (stopped.current) return
    const base = serverBase(loadServer()) ?? DEFAULT_SERVER
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
      setOnline(true)
      setFailed(false)
      const s = seat.current
      if (s) {
        joining.current = 'seat'
        socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'join', playerId: s.playerId, token: s.token }))
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
    let hiddenAt = 0
    const wake = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (stopped.current) return
      const slept = hiddenAt > 0 && Date.now() - hiddenAt > HIDDEN_RECONNECT_MS
      hiddenAt = 0
      if (ws.current && !slept) return
      // Соединение после сна могло умереть молча — открыть новое; старое забыть
      const old = ws.current
      ws.current = null
      old?.close(1000)
      attempt.current = 0
      connectRef.current()
    }
    const back = () => {
      if (!stopped.current && !ws.current) {
        attempt.current = 0
        connectRef.current()
      }
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', back)
    return () => {
      stopped.current = true
      clearTimeout(timer.current)
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
    phase,
    online,
    failed,
    lobby,
    table,
    me,
    ended,
    error,
    reseated,
    send,
    join(choice) {
      if (send({ type: 'join', ...choice })) joining.current = 'new'
    },
    resume() {
      stopped.current = false
      attempt.current = 0
      setPhase(seat.current ? 'loading' : 'lobby')
      connectRef.current()
    },
    clearError: () => setError(null),
    clearReseated: () => setReseated(null),
  }
}
