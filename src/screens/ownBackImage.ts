// Своя рубашка картинкой (#220): сжатие на устройстве — своим canvas, без библиотек — и картинка на картах
// через CSS-переменную --own-back на корне страницы. Чистая часть (обрезка, проверка строки) — в calc/ownBack.ts
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

// Файл → data URL 240 × 336: обрезка по центру под 5 : 7, WebP 0,8 (браузер его не умеет — JPEG 0,85);
// длиннее предела — ещё раз с качеством 0,6; всё ещё длиннее — отказ
export async function compressOwnBack(file: File): Promise<OwnBackResult> {
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
  canvas.width = OWN_BACK_WIDTH
  canvas.height = OWN_BACK_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return { ok: false, error: OPEN_FAILED }
  const { sx, sy, sw, sh } = coverCrop(w, h)
  ctx.fillStyle = '#5a1c28' // прозрачное у PNG — цветом рубашки, а не чёрным у JPEG
  ctx.fillRect(0, 0, OWN_BACK_WIDTH, OWN_BACK_HEIGHT)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OWN_BACK_WIDTH, OWN_BACK_HEIGHT)
  let url = canvas.toDataURL('image/webp', 0.8)
  const type = url.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
  if (type === 'image/jpeg') url = canvas.toDataURL(type, 0.85)
  if (url.length > OWN_BACK_MAX_CHARS) url = canvas.toDataURL(type, 0.6)
  if (url.length > OWN_BACK_MAX_CHARS) return { ok: false, error: 'Картинка не сжалась — выберите другую' }
  return { ok: true, url }
}

// Сохранить сжатую (null — удалить) и сразу показать на картах; браузер отказал — прежняя остаётся
export function setOwnBack(url: string | null): boolean {
  if (!saveOwnBack(url)) return false
  applyOwnBack(url)
  return true
}
