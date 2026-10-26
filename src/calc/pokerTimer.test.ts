import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../poker/table'
import { autoStartNote, timerSettings, turnChoiceOf, turnSecondsOf } from './pokerTimer'

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
    expect(timerSettings(old)).toEqual({ turnSeconds: null, autoStart: 'off' })
    expect(autoStartNote('fast')).toBe('Новая раздача начнётся сама через 3 с после раздачи банков')
    expect(autoStartNote('slow')).toContain('10 с')
    expect(autoStartNote('off')).toBe('Новую раздачу начинает ведущий')
  })
})
