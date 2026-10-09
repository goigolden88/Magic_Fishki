// ULID: 10 знаков времени + 16 случайных, Crockford base32 — сортируется по времени создания
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(now = Date.now()): string {
  let time = ''
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[now % 32] + time
    now = Math.floor(now / 32)
  }
  let random = ''
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) random += ALPHABET[byte % 32]
  return time + random
}
