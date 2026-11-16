// Какие разделы «Настроек» развёрнуты (#234) — состояние экрана, а не данные: в localStorage этого устройства,
// не в IndexedDB и не в копию. В первый раз развёрнуто только «Оформление»
export const SETTINGS_GROUPS = ['look', 'accounting', 'players', 'poker', 'notes', 'backup', 'demo'] as const
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]
export type OpenGroups = Record<SettingsGroup, boolean>

export const OPEN_GROUPS_DEFAULT: OpenGroups = {
  look: true,
  accounting: false,
  players: false,
  poker: false,
  notes: false,
  backup: false,
  demo: false,
}

const OPEN_GROUPS_KEY = 'fishki.settingsOpen'

// Запись → выбор; чего нет или что не «да/нет» — как по умолчанию; не JSON — всё по умолчанию
export function parseOpenGroups(raw: string | null): OpenGroups {
  let parsed: unknown = null
  try {
    parsed = raw === null ? null : JSON.parse(raw)
  } catch {
    parsed = null
  }
  const saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  const open = { ...OPEN_GROUPS_DEFAULT }
  for (const group of SETTINGS_GROUPS) {
    const value = saved[group]
    if (typeof value === 'boolean') open[group] = value
  }
  return open
}

export function loadOpenGroups(): OpenGroups {
  try {
    return parseOpenGroups(localStorage.getItem(OPEN_GROUPS_KEY))
  } catch {
    return { ...OPEN_GROUPS_DEFAULT }
  }
}

export function saveOpenGroups(open: OpenGroups) {
  try {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(open))
  } catch {
    // нет места или запрещено — выбор действует до закрытия
  }
}
