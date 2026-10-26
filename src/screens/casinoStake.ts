// Ставка прошлого раунда казино с картами (#76) — в модели раунда её нет, помнится на устройстве:
// в localStorage, не в IndexedDB и не в копии
const STAKE_KEY = 'fishki.casino.stake'

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
