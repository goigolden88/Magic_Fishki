// Подделки Cloudflare для тестов: хранилище кладёт значения JSON-строкой (как объект
// между сообщениями — в памяти ничего не держится), соединение копит присланное
import type { Peer, RoomEnv, RoomStorage } from './room'

export class FakeStorage implements RoomStorage {
  data = new Map<string, string>()
  alarmAt: number | null = null

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key)
    return raw === undefined ? undefined : (JSON.parse(raw) as T)
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value))
  }
  async deleteAll(): Promise<void> {
    this.data.clear()
  }
  async setAlarm(time: number): Promise<void> {
    this.alarmAt = time
  }
  async deleteAlarm(): Promise<void> {
    this.alarmAt = null
  }
}

export class FakePeer implements Peer {
  sent: Record<string, unknown>[] = []
  closed: { code: number; reason: string } | null = null
  attachment: string | null = null

  send(text: string): void {
    if (this.closed) throw new Error('closed')
    this.sent.push(JSON.parse(text) as Record<string, unknown>)
  }
  close(code: number, reason: string): void {
    this.closed ??= { code, reason }
  }
  playerId(): string | null {
    return this.attachment
  }
  setPlayerId(id: string): void {
    this.attachment = id
  }
  last(): Record<string, unknown> | undefined {
    return this.sent.at(-1)
  }
}

export function fakeRoom(): { env: RoomEnv; storage: FakeStorage; peers: FakePeer[]; released: string[] } {
  const storage = new FakeStorage()
  const peers: FakePeer[] = []
  const released: string[] = []
  const env: RoomEnv = {
    storage,
    peers: () => peers.filter((p) => !p.closed),
    release: async (code) => {
      released.push(code)
    },
  }
  return { env, storage, peers, released }
}
