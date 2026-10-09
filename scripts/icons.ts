// Иконка «Фишек» — покерная фишка на зелёном сукне. PNG рисуется при сборке,
// без сторонних библиотек: попиксельно, со сглаживанием, сжатие — zlib из Node.
// Тот же рисунок векторно — public/favicon.svg.
import { deflateSync } from 'node:zlib'

type RGB = [number, number, number]

const FELT: RGB = [15, 94, 61]
const RED: RGB = [198, 40, 40]
const WHITE: RGB = [245, 245, 240]

// Цвет точки; x, y — от −1 до 1 от центра. Фишка — в круге 0,78: целиком в «безопасной зоне»
// маскируемой иконки Android (круг 0,8), так что одна картинка годится и для неё.
function color(x: number, y: number): RGB {
  const r = Math.hypot(x, y)
  if (r > 0.78) return FELT
  if (r > 0.6) {
    // Обод: 6 белых и 6 красных долей
    const turn = (Math.atan2(y, x) / (2 * Math.PI) + 1 + 1 / 24) % 1
    return Math.floor(turn * 12) % 2 === 0 ? WHITE : RED
  }
  if (r > 0.54) return RED
  if (r > 0.49) return WHITE
  return RED
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

// Квадратная PNG size×size, RGB; каждый пиксель — среднее 4×4 точек
export function chipIcon(size: number): Buffer {
  const SS = 4
  const row = 1 + size * 3
  const raw = Buffer.alloc(row * size)
  for (let py = 0; py < size; py++) {
    raw[py * row] = 0 // фильтр строки: без фильтра
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 2 - 1
          const y = ((py + (sy + 0.5) / SS) / size) * 2 - 1
          const c = color(x, y)
          sum[0] += c[0]
          sum[1] += c[1]
          sum[2] += c[2]
        }
      }
      const at = py * row + 1 + px * 3
      for (let i = 0; i < 3; i++) raw[at + i] = Math.round(sum[i] / (SS * SS))
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // бит на канал
  header[9] = 2 // RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Имя файла → сторона в пикселях
export const ICONS: Record<string, number> = {
  'icon-192.png': 192,
  'icon-512.png': 512,
  'apple-touch-icon.png': 180,
}
