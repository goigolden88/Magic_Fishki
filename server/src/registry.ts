// Реестр комнат: коды живых комнат и предел — не больше MAX_ROOMS одновременно.
// Один на сервер (объект с постоянным именем), поэтому заявки идут по одной.
// Комната, стираясь, освобождает место сама; если весть потерялась — при полном
// реестре каждую комнату спрашивают, жива ли она
export const MAX_ROOMS = 10
export const FULL = `Комнат уже ${MAX_ROOMS}`

// Код — без похожих знаков (0/O, 1/I/L): его диктуют голосом и вводят руками
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6
export const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`)

// Заявка моложе этого считается живой: комнату в ней, может быть, ещё создают
export const FRESH_MS = 60_000

export type RegistryStorage = {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
}

type Rooms = Record<string, number> // код → когда заявлен

const KEY = 'rooms'

export async function reserve(
  storage: RegistryStorage,
  isAlive: (code: string) => Promise<boolean>,
  now: number,
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const rooms = (await storage.get<Rooms>(KEY)) ?? {}
  if (Object.keys(rooms).length >= MAX_ROOMS) {
    for (const [code, at] of Object.entries(rooms)) {
      if (now - at > FRESH_MS && !(await isAlive(code))) delete rooms[code]
    }
  }
  if (Object.keys(rooms).length >= MAX_ROOMS) {
    await storage.put(KEY, rooms)
    return { ok: false, error: FULL }
  }
  let code = newCode()
  while (code in rooms) code = newCode()
  rooms[code] = now
  await storage.put(KEY, rooms)
  return { ok: true, code }
}

export async function release(storage: RegistryStorage, code: string): Promise<void> {
  const rooms = (await storage.get<Rooms>(KEY)) ?? {}
  if (!(code in rooms)) return
  delete rooms[code]
  await storage.put(KEY, rooms)
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}
