// Какие годы раскрыты на «Играх» — состояние экрана, а не данные игр: в localStorage, не в IndexedDB и не в копию
const OPEN_YEARS_KEY = 'fishki.gamesOpenYears'

export function loadOpenYears(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OPEN_YEARS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

export function saveOpenYears(saved: Record<string, boolean>) {
  try {
    localStorage.setItem(OPEN_YEARS_KEY, JSON.stringify(saved))
  } catch {
    // нет места или запрещено — просто не запомним
  }
}

// Новая игра — кнопкой или из Телеграма — раскрывает свой год; остальные годы как были
export function openGameYear(date: string) {
  saveOpenYears({ ...loadOpenYears(), [date.slice(0, 4)]: true })
}
