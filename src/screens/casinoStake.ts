import { AUTO_OPEN_CHOICES, DEFAULT_AUTO_OPEN } from '../calc/casinoReveal'
import { CARD_BACK_LABELS, FELT_LABELS, lookOf, type Look } from '../calc/pokerLook'
import { parseSavedCasinoRound, type SavedCasinoRound } from '../calc/savedCasino'

// Ставка прошлого раунда казино с картами (#76) — в модели раунда её нет, помнится на устройстве:
// в localStorage, не в IndexedDB и не в копии
const STAKE_KEY = 'fishki.casino.stake'
// Сукно и рубашка казино-стола (#129) — так же, на устройстве. С Р-59 только читается: выбор — «Вид стола» в «Настройках»
const LOOK_KEY = 'fishki.casino.look'
// «Открывать столы сами» (#134) — секунды, 0 — «Нет»; так же, на устройстве
const AUTO_OPEN_KEY = 'fishki.casino.autoOpen'
// «Шансы» (#137) — да или нет; так же, на устройстве
const ODDS_KEY = 'fishki.casino.odds'

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

// Незаписанный раунд казино-стола (#151) — свой ключ у каждой игры, так же на устройстве.
// Нет, битый, чужой или память браузера недоступна — null: стол как без него
const roundKey = (gameId: string) => `fishki.casino.round.${gameId}`

export function loadRound(gameId: string, players: string[]): SavedCasinoRound | null {
  try {
    return parseSavedCasinoRound(localStorage.getItem(roundKey(gameId)) ?? '', gameId, players)
  } catch {
    return null
  }
}

export function saveRound(round: SavedCasinoRound) {
  try {
    localStorage.setItem(roundKey(round.gameId), JSON.stringify(round))
  } catch {
    // так же — не запомним: после перезапуска раунда не будет
  }
}

export function clearRound(gameId: string) {
  try {
    localStorage.removeItem(roundKey(gameId))
  } catch {
    // память недоступна — и стирать нечего
  }
}

// Нет или не похоже — «Да»
export function loadOdds(): boolean {
  try {
    return JSON.parse(localStorage.getItem(ODDS_KEY) ?? 'true') !== false
  } catch {
    return true
  }
}

export function saveOdds(on: boolean) {
  try {
    localStorage.setItem(ODDS_KEY, JSON.stringify(on))
  } catch {
    // так же — не запомним
  }
}
