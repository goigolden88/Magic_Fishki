import { describe, expect, it } from 'vitest'
import { formatNumber } from '../calc/format'
import { HELP_VALUES, helpSections, type HelpValues } from './helpText'

// Вместо чисел — метка: цифра в выводе значит, что число вписано в текст руками
const PLACEHOLDERS: HelpValues = {
  rate: '‹курс›',
  buyin: '‹закуп›',
  amounts: '‹суммы›',
  window: '‹окно›',
  recent: '‹последние›',
  previous: '‹предыдущие›',
}

describe('справка', () => {
  it('разделы: по экрану, расчёт, данные и «если что-то не так»', () => {
    expect(helpSections(HELP_VALUES).map((s) => s.title)).toEqual([
      'Игры',
      'Игра',
      'Игроки',
      'Карточка игрока',
      'Из Телеграма',
      'Настройки',
      'Как считаются переводы',
      'Данные',
      'Если что-то не так',
    ])
  })

  it('цифрами в тексте ничего не написано', () => {
    for (const s of helpSections(PLACEHOLDERS)) {
      expect(s.title).not.toMatch(/\d/)
      for (const p of s.text) expect(p).not.toMatch(/\d/)
    }
  })

  it('каждое число берётся из констант и попадает в текст', () => {
    const all = helpSections(PLACEHOLDERS)
      .flatMap((s) => s.text)
      .join('\n')
    for (const mark of Object.values(PLACEHOLDERS)) expect(all).toContain(mark)
  })

  it('числа — те же, что у экранов', () => {
    expect(HELP_VALUES).toEqual({
      rate: '0,5',
      buyin: formatNumber(1000),
      amounts: [500, 1000, 2000].map(formatNumber).join(', '),
      window: '5',
      recent: 'Последние 5 игр',
      previous: 'Предыдущие 5 игр',
    })
  })
})
