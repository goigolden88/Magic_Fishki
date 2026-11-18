// Своя рубашка карт (#220): картинка с устройства, сжатая на нём же. Хранится только на этом телефоне
// (localStorage), на сервер и в копию не уходит. Здесь — чистая часть: обрезка под карту и проверка строки

// Карта — 5 : 7; картинка рисуется в 240 × 336 px: крупная карта 4 rem (72 px) на экране с плотностью 3 — 216 px
export const OWN_BACK_WIDTH = 240
export const OWN_BACK_HEIGHT = 336
// Длиннее — сжать ещё раз, хуже; всё ещё длиннее — не сохранить (≈ 73 КБ)
export const OWN_BACK_MAX_CHARS = 100_000
// Файл больше — не открываем вовсе
export const OWN_BACK_FILE_MAX_MB = 20

export type Crop = { sx: number; sy: number; sw: number; sh: number }

// Кусок картинки w × h под пропорцию rw : rh по центру — как object-fit: cover: шире — режутся бока, выше — верх
// и низ. Сначала — карта 5 : 7; аватарка (#298) — квадрат 1 : 1
export function coverCrop(w: number, h: number, rw = 5, rh = 7): Crop {
  if (w * rh > h * rw) {
    const sw = Math.max(1, Math.round((h * rw) / rh))
    return { sx: Math.floor((w - sw) / 2), sy: 0, sw, sh: h }
  }
  const sh = Math.max(1, Math.round((w * rh) / rw))
  return { sx: 0, sy: Math.floor((h - sh) / 2), sw: w, sh }
}

const OWN_BACK_URL = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/

// Только картинка base64 и не длиннее предела: в CSS не попадёт ничего чужого
export function isOwnBackUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= OWN_BACK_MAX_CHARS && OWN_BACK_URL.test(v)
}

// Значение переменной --own-back; строка не прошла проверку — null, переменной нет
export function ownBackCss(url: string | null): string | null {
  return isOwnBackUrl(url) ? `url("${url}")` : null
}
