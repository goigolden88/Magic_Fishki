// Гамма всего приложения (Р-70): «Ночь» (сначала), «Клуб» (прежние цвета до Р-70), «День» (светлая).
// Сами цвета — переменные в styles.css: «Ночь» — :root, остальные — [data-theme] на <html>.
// Хранится на этом телефоне (localStorage, THEME_KEY), в копии — poker.theme. null — не выбрано: «Ночь»
export type Theme = 'night' | 'club' | 'day'

export const THEME_DEFAULT: Theme = 'night'

// Ключ в localStorage; его же читает скрипт в index.html до первой отрисовки (тест сверяет)
export const THEME_KEY = 'fishki.theme'

export const THEME_LABELS: [Theme, string][] = [
  ['night', 'Ночь'],
  ['club', 'Клуб'],
  ['day', 'День'],
]

// <meta name="theme-color"> — фон гаммы (--bg); те же значения — в index.html (тест сверяет)
export const THEME_COLOR: Record<Theme, string> = {
  night: '#101217',
  club: '#0f1a15',
  day: '#eef1f4',
}

// Образец в «Оформлении»: половина — фон гаммы, половина — её главная кнопка (--accent)
export const THEME_ACCENT: Record<Theme, string> = {
  night: '#5b9dff',
  club: '#2e9e5b',
  day: '#14784a',
}

// Не из готовых (мусор, пусто) — не выбрано
export function parseTheme(raw: unknown): Theme | null {
  return raw === 'night' || raw === 'club' || raw === 'day' ? raw : null
}

export const themeOf = (choice: Theme | null): Theme => choice ?? THEME_DEFAULT
