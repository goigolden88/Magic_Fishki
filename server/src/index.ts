// Сервер комнат на Cloudflare: Worker принимает запросы, объект Room — одна комната
// (WebSocket со сном), объект Registry — реестр комнат. Логика — в room.ts, registry.ts,
// http.ts; здесь только привязка к Cloudflare
import { DurableObject } from 'cloudflare:workers'
import { PROTOCOL_VERSION, type RosterEntry } from '../../src/poker/protocol'
import type { Settings } from '../../src/poker/table'
import { CORS_HEADERS, createRoom, json, STATUS_TEXT } from './http'
import * as registry from './registry'
import * as room from './room'

export type Env = {
  ROOMS: DurableObjectNamespace<Room>
  REGISTRY: DurableObjectNamespace<Registry>
  ROOM_PASSWORD?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(STATUS_TEXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS } })
    }
    if (url.pathname === '/rooms' && request.method === 'POST') {
      const body: unknown = await request.json().catch(() => null)
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('registry'))
      const r = await createRoom(body, {
        password: env.ROOM_PASSWORD,
        reserve: () => reg.reserve(),
        init: (code, name, settings, roster, regularId) => roomStub(env, code).init(code, name, settings, roster, regularId),
        release: (code) => reg.release(code),
      })
      return json(r.status, r.body)
    }
    // Подключение к комнате: /rooms/<код>, WebSocket
    const match = /^\/rooms\/([^/]+)$/.exec(url.pathname)
    if (match && request.method === 'GET') {
      if (request.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'Нужно подключение WebSocket' })
      const code = match[1].toUpperCase()
      // Кривой код — комнаты точно нет: объект не будим, отвечаем сами
      if (!registry.CODE_PATTERN.test(code)) return noRoomSocket()
      return roomStub(env, code).fetch(request)
    }
    return json(404, { error: 'Нет такого адреса' })
  },
}

function roomStub(env: Env, code: string): DurableObjectStub<Room> {
  return env.ROOMS.get(env.ROOMS.idFromName(code))
}

function noRoomSocket(): Response {
  const [client, server] = Object.values(new WebSocketPair())
  server.accept()
  server.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'error', error: room.NO_ROOM }))
  server.close(room.CLOSE_NO_ROOM, 'no room')
  return new Response(null, { status: 101, webSocket: client })
}

export class Room extends DurableObject<Env> {
  // Обёртки соединений — одна на сокет, чтобы сравнивать их как сами сокеты
  private wrapped = new WeakMap<WebSocket, room.Peer>()

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'Нужно подключение WebSocket' })
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    await room.open(this.roomEnv(), this.peer(server))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
    await room.message(this.roomEnv(), this.peer(ws), text, Date.now())
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await room.close(this.roomEnv(), this.peer(ws), Date.now())
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye')
    } catch {
      // уже закрыт
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await room.close(this.roomEnv(), this.peer(ws), Date.now())
  }

  async alarm(): Promise<void> {
    await room.alarm(this.roomEnv(), Date.now())
  }

  // Зовёт Worker при создании комнаты
  async init(code: string, name: unknown, settings: Partial<Settings>, roster: RosterEntry[], regularId: string | null) {
    return room.initRoom(this.roomEnv(), code, name, settings, Date.now(), roster, regularId)
  }

  // Зовёт реестр, когда комнат уже предел: жива ли эта
  async alive(): Promise<boolean> {
    return room.isAlive(this.roomEnv())
  }

  private roomEnv(): room.RoomEnv {
    return {
      storage: this.ctx.storage,
      peers: () => this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.READY_STATE_OPEN).map((ws) => this.peer(ws)),
      release: async (code) => {
        await this.env.REGISTRY.get(this.env.REGISTRY.idFromName('registry')).release(code)
      },
    }
  }

  private peer(ws: WebSocket): room.Peer {
    let p = this.wrapped.get(ws)
    if (!p) {
      p = {
        send: (text) => ws.send(text),
        close: (code, reason) => {
          try {
            ws.close(code, reason)
          } catch {
            // уже закрыт
          }
        },
        playerId: () => (ws.deserializeAttachment() as { playerId?: string } | null)?.playerId ?? null,
        setPlayerId: (playerId) => ws.serializeAttachment({ playerId }),
      }
      this.wrapped.set(ws, p)
    }
    return p
  }
}

export class Registry extends DurableObject<Env> {
  async reserve() {
    return registry.reserve(
      this.ctx.storage,
      (code) => this.env.ROOMS.get(this.env.ROOMS.idFromName(code)).alive(),
      Date.now(),
    )
  }

  async release(code: string): Promise<void> {
    await registry.release(this.ctx.storage, code)
  }
}
