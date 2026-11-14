import { describe, expect, it } from 'vitest'
import indexHtml from '../../index.html?raw'
import { parseTheme, THEME_COLOR, THEME_DEFAULT, THEME_KEY, THEME_LABELS, themeOf } from './theme'

// Гамма приложения (Р-70)
describe('гамма: разбор', () => {
  it('готовые гаммы читаются как есть', () => {
    expect(parseTheme('night')).toBe('night')
    expect(parseTheme('club')).toBe('club')
    expect(parseTheme('day')).toBe('day')
  })

  it('пусто и мусор — не выбрано', () => {
    for (const raw of [null, undefined, '', 'Night', 'dark', 'constructor', 1, true, {}, ['day']]) {
      expect(parseTheme(raw)).toBeNull()
    }
  })

  it('не выбрано — «Ночь»; выбранное — как есть', () => {
    expect(THEME_DEFAULT).toBe('night')
    expect(themeOf(null)).toBe('night')
    expect(themeOf('day')).toBe('day')
  })

  it('кнопки «Оформления» — «Ночь», «Клуб», «День»', () => {
    expect(THEME_LABELS).toEqual([
      ['night', 'Ночь'],
      ['club', 'Клуб'],
      ['day', 'День'],
    ])
  })
})

// Скрипт в index.html ставит гамму до первой отрисовки: ключ и theme-color — те же, что здесь
describe('гамма: index.html', () => {
  it('скрипт читает тот же ключ', () => {
    expect(indexHtml).toContain(`localStorage.getItem('${THEME_KEY}')`)
  })

  it('theme-color «Ночи» — в <meta>, «Клуба» и «Дня» — в скрипте', () => {
    expect(indexHtml).toContain(`<meta name="theme-color" content="${THEME_COLOR.night}" />`)
    const colors = /var themeColors = (\{[^}]*\})/.exec(indexHtml)?.[1]
    expect(colors).toBe(`{ club: '${THEME_COLOR.club}', day: '${THEME_COLOR.day}' }`)
  })
})
