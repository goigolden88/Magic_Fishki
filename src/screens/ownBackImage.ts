// Своя рубашка картинкой (#220): сжатие на устройстве — своим canvas, без библиотек — и картинка на картах
// через CSS-переменную --own-back на корне страницы. Чистая часть (обрезка, проверка строки) — в calc/ownBack.ts.
// Сжатие — с размером и пропорцией параметрами: им же сжимается своя аватарка (#298)
import { AVATAR_MAX_CHARS, AVATAR_PX } from '../poker/avatar'
import {
  coverCrop,
  OWN_BACK_FILE_MAX_MB,
  OWN_BACK_HEIGHT,
  OWN_BACK_MAX_CHARS,
  OWN_BACK_WIDTH,
  ownBackCss,
} from '../calc/ownBack'
import { loadOwnBack, saveOwnBack } from './pokerStorage'

export type OwnBackResult = { ok: true; url: string } | { ok: false; error: string }

const OPEN_FAILED = 'Не удалось открыть картинку'

// Переменная — по сохранённой картинке: при запуске и после каждой смены или удаления
export function applyOwnBack(url: string | null = loadOwnBack()) {
  const css = ownBackCss(url)
  const root = document.documentElement.style
  if (css) root.setProperty('--own-back', css)
  else root.removeProperty('--own-back')
}

function openImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(src)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(src)
      reject(new Error(OPEN_FAILED))
    }
    img.src = src
  })
}

// Во что сжать: размер в px (пропорция — по нему), предел строки, цвет под прозрачным у PNG
// и качество повторов, если строка вышла длиннее предела
type PictureSpec = { width: number; height: number; maxChars: number; fill: string; retries: number[] }

// Рубашка (#220): 240 × 336, повтор — 0,6
const OWN_BACK_SPEC: PictureSpec = {
  width: OWN_BACK_WIDTH,
  height: OWN_BACK_HEIGHT,
  maxChars: OWN_BACK_MAX_CHARS,
  fill: '#5a1c28', // прозрачное у PNG — цветом рубашки, а не чёрным у JPEG
  retries: [0.6],
}

// Аватарка (#298): квадрат 96 × 96, не длиннее 8 000 знаков; повторы — 0,6 и 0,4
const AVATAR_SPEC: PictureSpec = {
  width: AVATAR_PX,
  height: AVATAR_PX,
  maxChars: AVATAR_MAX_CHARS,
  fill: '#3b4a5c',
  retries: [0.6, 0.4],
}

// Файл → data URL width × height: обрезка по центру под пропорцию, WebP 0,8 (браузер его не умеет — JPEG 0,85);
// длиннее предела — ещё раз с качеством повторов; всё ещё длиннее — отказ
async function compressPicture(file: File, spec: PictureSpec): Promise<OwnBackResult> {
  if (file.size > OWN_BACK_FILE_MAX_MB * 1024 * 1024) return { ok: false, error: `Файл больше ${OWN_BACK_FILE_MAX_MB} МБ` }
  if (file.type !== '' && !file.type.startsWith('image/')) return { ok: false, error: OPEN_FAILED }
  let img: HTMLImageElement
  try {
    img = await openImage(file)
  } catch {
    return { ok: false, error: OPEN_FAILED }
  }
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (w === 0 || h === 0) return { ok: false, error: OPEN_FAILED }
  const canvas = document.createElement('canvas')
  canvas.width = spec.width
  canvas.height = spec.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { ok: false, error: OPEN_FAILED }
  const { sx, sy, sw, sh } = coverCrop(w, h, spec.width, spec.height)
  ctx.fillStyle = spec.fill
  ctx.fillRect(0, 0, spec.width, spec.height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, spec.width, spec.height)
  let url = canvas.toDataURL('image/webp', 0.8)
  const type = url.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
  if (type === 'image/jpeg') url = canvas.toDataURL(type, 0.85)
  for (const quality of spec.retries) {
    if (url.length <= spec.maxChars) break
    url = canvas.toDataURL(type, quality)
  }
  if (url.length > spec.maxChars) return { ok: false, error: 'Картинка не сжалась — выберите другую' }
  return { ok: true, url }
}

export const compressOwnBack = (file: File) => compressPicture(file, OWN_BACK_SPEC)
export const compressAvatar = (file: File) => compressPicture(file, AVATAR_SPEC)

// Сохранить сжатую (null — удалить) и сразу показать на картах; браузер отказал — прежняя остаётся
export function setOwnBack(url: string | null): boolean {
  if (!saveOwnBack(url)) return false
  applyOwnBack(url)
  return true
}
