// Аватарки за столом (#298, Р-113): рисунок из набора приложения или своя картинка игрока. Общая часть экрана
// и сервера комнат: id набора, проверка строки аватарки, выбор по умолчанию. Аватарка — не в столе: стол уходит
// всем телефонам на каждый ход, а картинка — один раз при входе и при смене (сообщения `avatar`, `avatars`)

// Набор: id — в выборе «Моего вида стола», в копии и на сервере; рисунки — src/screens/Avatar.tsx
export const AVATAR_IDS = ['bolt', 'cloud', 'sun', 'moon', 'car', 'shark', 'cat', 'hedgehog', 'brain', 'heart'] as const
export type AvatarId = (typeof AVATAR_IDS)[number]

// Своя картинка: квадрат 96 × 96 px, WebP (запасной — JPEG), строкой data URL не длиннее предела (≈ 6 КБ картинки)
export const AVATAR_PX = 96
export const AVATAR_MAX_CHARS = 8000

const PICTURE = /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/

export function isAvatarId(v: unknown): v is AvatarId {
  return typeof v === 'string' && (AVATAR_IDS as readonly string[]).includes(v)
}

// Своя картинка: только WebP или JPEG base64 и не длиннее предела — в разметку не попадёт ничего чужого
export function isAvatarPicture(v: unknown): v is string {
  return typeof v === 'string' && v.length <= AVATAR_MAX_CHARS && PICTURE.test(v)
}

// Аватарка, которую принимает сервер и рисует экран: id из набора или своя картинка
export function isAvatar(v: unknown): v is string {
  return isAvatarId(v) || isAvatarPicture(v)
}

// По умолчанию — рисунок набора по имени игрока (у ботов — по id): одна и та же строка на всех телефонах даёт
// один рисунок. Имя — без пробелов по краям и без разницы в регистре: «Аня» и «аня » — один рисунок.
// Хеш — FNV-1a по 32 бита
export function defaultAvatar(key: string): AvatarId {
  let h = 0x811c9dc5
  for (const ch of key.trim().toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return AVATAR_IDS[h % AVATAR_IDS.length]
}

// Выбор телефона в «Моём виде стола»: id из набора, 'own' — своя картинка, null — по умолчанию
export const OWN_AVATAR = 'own'
export type AvatarChoice = AvatarId | typeof OWN_AVATAR

// Что этот телефон шлёт в комнату за себя: выбранный рисунок; «Своя» — картинка, если она есть на устройстве;
// иначе null — другие телефоны рисуют по умолчанию по имени
export function myAvatar(choice: AvatarChoice | null | undefined, picture: string | null): string | null {
  if (choice === OWN_AVATAR) return isAvatarPicture(picture) ? picture : null
  return isAvatarId(choice) ? choice : null
}

// Аватарка места: присланная (сервером комнаты или своя на этом телефоне), иначе — по умолчанию по ключу
export function avatarOf(sent: unknown, key: string): string {
  return isAvatar(sent) ? sent : defaultAvatar(key)
}
