import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../poker/table'
import { lookOf } from './pokerLook'
import { turnChoiceOf, turnSecondsOf } from './pokerTimer'
import { quickRoomHost, quickRoomLine, quickRoomSettings, roomSettings, ROOM_DEFAULTS, gameSettings, DEFAULT_GAME } from './quickRoom'
import { formSettings, tournamentForm } from './tournamentForm'

describe('quickRoomSettings', () => {
  it('начальные значения формы и стек — закуп по умолчанию', () => {
    expect(quickRoomSettings(1000)).toEqual({
      sb: 5,
      bb: 10,
      startingStack: 1000,
      cards: 'phones',
      game: 'holdem',
      turnSeconds: null,
      autoStart: 'off',
      felt: 'green',
      cardBack: 'classic',
      format: 'cash',
      ante: 0,
      publicHud: false,
    })
  })

  it('совпадает с тем, что форма шлёт с начальными значениями', () => {
    // Форма: поля — строками и кнопками, разбор — теми же функциями, что у неё
    const timer = turnChoiceOf(DEFAULT_SETTINGS.turnSeconds)
    const turn = turnSecondsOf(timer.choice, timer.text)
    const format = formSettings(tournamentForm(0))
    if (!turn.ok || !format.ok) throw new Error('начальные значения формы не разбираются')
    const form = roomSettings({
      sb: DEFAULT_SETTINGS.sb,
      bb: DEFAULT_SETTINGS.bb,
      startingStack: 2500,
      cards: 'phones',
      variant: DEFAULT_GAME,
      turnSeconds: turn.seconds,
      autoStart: DEFAULT_SETTINGS.autoStart ?? 'off',
      look: lookOf(DEFAULT_SETTINGS),
      format: format.settings,
      publicHud: false,
    })
    expect(quickRoomSettings(2500)).toEqual(form)
  })

  it('холдем — без поля лимита (всегда без лимита)', () => {
    expect(quickRoomSettings(1000)).not.toHaveProperty('limit')
    expect(gameSettings({ game: 'omaha', limit: 'pot' })).toEqual({ game: 'omaha', limit: 'pot' })
  })

  it('не меняет значения по умолчанию', () => {
    quickRoomSettings(700)
    expect(ROOM_DEFAULTS).not.toHaveProperty('startingStack')
  })
})

describe('quickRoomLine', () => {
  it('подпись под кнопкой', () => {
    expect(quickRoomLine(quickRoomSettings(1000))).toBe('Холдем · кэш · карты на телефонах · блайнды 5/10 · стек 1 000')
  })

  it('стек — из закупа по умолчанию', () => {
    expect(quickRoomLine(quickRoomSettings(12000))).toBe('Холдем · кэш · карты на телефонах · блайнды 5/10 · стек 12 000')
  })
})

describe('quickRoomHost', () => {
  const players = [
    { id: 'a', name: 'Аня' },
    { id: 'b', name: 'Боря' },
  ]

  it('постоянный из прошлого раза', () => {
    expect(quickRoomHost(players, 'b')).toEqual({ id: 'b', name: 'Боря' })
  })

  it('прошлого выбора нет, был гостем или постоянных нет — null', () => {
    expect(quickRoomHost(players, '')).toBeNull()
    expect(quickRoomHost(players, 'z')).toBeNull()
    expect(quickRoomHost([], 'a')).toBeNull()
  })
})
