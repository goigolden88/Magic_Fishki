import { parseTheme, THEME_COLOR, THEME_KEY, themeOf, type Theme } from '../calc/theme'

// Гамма приложения (Р-70) на этом телефоне: localStorage, в копию идёт (poker.theme).
// При запуске её ставит скрипт в index.html — до первой отрисовки; здесь — выбор в «Настройках» и восстановление
export function loadThemeChoice(): Theme | null {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return null
  }
}

// Сохранить и сразу применить, без перезагрузки. null — снова не выбрано: «Ночь»
export function saveTheme(choice: Theme | null) {
  try {
    if (choice) localStorage.setItem(THEME_KEY, choice)
    else localStorage.removeItem(THEME_KEY)
  } catch {
    // нет места или запрещено — гамма действует до закрытия
  }
  applyTheme(themeOf(choice))
}

// «Ночь» — без атрибута (цвета :root), иначе data-theme на <html>; theme-color — фон гаммы
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'night') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}
