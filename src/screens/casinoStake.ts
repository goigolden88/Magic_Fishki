import { AUTO_OPEN_CHOICES, DEFAULT_AUTO_OPEN } from '../calc/casinoReveal'
import { CARD_BACK_LABELS, FELT_LABELS, lookOf, type Look } from '../calc/pokerLook'

// Ставка прошлого раунда казино с картами (#76) — в модели раунда её нет, помнится на устройстве:
// в localStorage, не в IndexedDB и не в копии
const STAKE_KEY = 'fishki.casino.stake'
// Сукно и рубашка казино-стола (#129) — так же, на устройстве
const LOOK_KEY = 'fishki.casino.look'
// «Открывать столы сами» (#134) — секунды, 0 — «Нет»; так же, на устройстве
const AUTO_OPEN_KEY = 'fishki.casino.autoOpen'

// Копейки; нет или не похоже — null
export function loadStake(): number | null {
  try {
    const n: unknown = JSON.parse(localStorage.getItem(STAKE_KEY) ?? 'null')
    return Number.isSafeInteger(n) && (n as number) > 0 ? (n as number) : null
  } catch {
    return null
  }
}

export function saveStake(kopecks: number) {
  try {
    localStorage.setItem(STAKE_KEY, JSON.stringify(kopecks))
  } catch {
    // нет места или запрещено — просто не запомним
  }
}

// Нет или не из готовых — зелёное сукно и классическая рубашка, как у покерного стола
export function loadLook(): Look {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null')
    const o = typeof v === 'object' && v !== null ? (v as Partial<Look>) : {}
    return lookOf({
      felt: FELT_LABELS.some(([f]) => f === o.felt) ? o.felt : undefined,
      cardBack: CARD_BACK_LABELS.some(([b]) => b === o.cardBack) ? o.cardBack : undefined,
    })
  } catch {
    return lookOf({})
  }
}

export function saveLook(look: Look) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look))
  } catch {
    // так же — не запомним
  }
}

// Нет или не из готовых — по умолчанию (5 с)
export function loadAutoOpen(): number {
  try {
    const n: unknown = JSON.parse(localStorage.getItem(AUTO_OPEN_KEY) ?? 'null')
    return AUTO_OPEN_CHOICES.includes(n as number) ? (n as number) : DEFAULT_AUTO_OPEN
  } catch {
    return DEFAULT_AUTO_OPEN
  }
}

export function saveAutoOpen(seconds: number) {
  try {
    localStorage.setItem(AUTO_OPEN_KEY, JSON.stringify(seconds))
  } catch {
    // так же — не запомним
  }
}
