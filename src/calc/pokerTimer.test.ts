import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../poker/table'
import { autoStartNote, timeBankNote, timeBankOf, timerSettings, turnChoiceOf, turnSecondsOf } from './pokerTimer'

describe('форма времени на ход', () => {
  it('выкл, готовое число и своё', () => {
    expect(turnSecondsOf('off', '')).toEqual({ ok: true, seconds: null })
    expect(turnSecondsOf(30, '')).toEqual({ ok: true, seconds: 30 })
    expect(turnSecondsOf('custom', ' 45 ')).toEqual({ ok: true, seconds: 45 })
    expect(turnSecondsOf('custom', '10')).toEqual({ ok: true, seconds: 10 })
    expect(turnSecondsOf('custom', '300')).toEqual({ ok: true, seconds: 300 })
  })

  it('своё вне 10…300 или не число — ошибка', () => {
    const error = 'Своё время — целое число от 10 до 300 секунд'
    for (const text of ['9', '301', '', '1,5', 'abc', '-20']) expect(turnSecondsOf('custom', text)).toEqual({ ok: false, error })
  })

  it('выбор по настройке стола', () => {
    expect(turnChoiceOf(null)).toEqual({ choice: 'off', text: '' })
    expect(turnChoiceOf(undefined)).toEqual({ choice: 'off', text: '' })
    expect(turnChoiceOf(60)).toEqual({ choice: 60, text: '' })
    expect(turnChoiceOf(90)).toEqual({ choice: 'custom', text: '90' })
  })

  it('стол без полей таймера — выкл; подпись паузы', () => {
    const { turnSeconds: _t, autoStart: _a, ...old } = DEFAULT_SETTINGS
    expect(timerSettings(old)).toEqual({ turnSeconds: null, timeBank: null, autoStart: 'off' })
    expect(autoStartNote('fast')).toBe('Новая раздача начнётся сама через 3 с после раздачи банков')
    expect(autoStartNote('slow')).toContain('10 с')
    expect(autoStartNote('off')).toBe('Новую раздачу начинает ведущий')
  })

  it('запас времени (#223): только со временем на ход; стол до запаса — выкл; подпись', () => {
    expect(timeBankOf(20, 30)).toBe(30)
    expect(timeBankOf(null, 30)).toBeNull()
    expect(timerSettings({ ...DEFAULT_SETTINGS, turnSeconds: 20, timeBank: 30 })).toEqual({ turnSeconds: 20, timeBank: 30, autoStart: 'off' })
    expect(timerSettings({ ...DEFAULT_SETTINGS, turnSeconds: 20 })).toEqual({ turnSeconds: 20, timeBank: null, autoStart: 'off' })
    expect(timeBankNote(30)).toBe(
      'Время на ход вышло — идёт свой запас, 30 с на вечер; каждые 10 раздач +5 с, не больше 60 с. Вне сети запас не тратится',
    )
    expect(timeBankNote(null)).toContain('ход 20 с и запас 30 с')
  })
})
