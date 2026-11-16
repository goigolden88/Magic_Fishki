import { describe, expect, it } from 'vitest'
import type { OwnGame } from '../poker/ownGame'
import { createTable, DEFAULT_SETTINGS } from '../poker/table'
import { lookOf } from './pokerLook'
import { turnChoiceOf, turnSecondsOf } from './pokerTimer'
import {
  DEFAULT_GAME,
  gameSettings,
  parseQuickRoom,
  QUICK_ROOM_DEFAULT,
  quickRoomChoice,
  quickRoomError,
  quickRoomHost,
  quickRoomLine,
  quickRoomSettings,
  ROOM_DEFAULTS,
  roomSettings,
  type QuickRoom,
} from './quickRoom'
import { formSettings, tournamentForm, tournamentFormOf } from './tournamentForm'

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

  it('«Микс» (#166) — только с картами на телефонах, с долей «против»; выключен — полей нет', () => {
    const base = { ...ROOM_DEFAULTS, startingStack: 1000 }
    expect(roomSettings({ ...base, mix: 'half' })).toMatchObject({ mix: true, mixAgainst: 'half' })
    expect(roomSettings({ ...base, mix: 'third' })).toMatchObject({ mix: true, mixAgainst: 'third' })
    expect(roomSettings({ ...base, cards: 'live', mix: 'half' })).not.toHaveProperty('mix')
    expect(roomSettings({ ...base, mix: null })).not.toHaveProperty('mix')
    expect(quickRoomSettings(1000)).not.toHaveProperty('mix')
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

describe('своя «Быстрая комната» (Р-62)', () => {
  const ROOM: QuickRoom = {
    ...QUICK_ROOM_DEFAULT,
    sb: 25,
    bb: 50,
    startingStack: 5000,
    variant: { game: 'omaha', limit: 'pot' },
    turnSeconds: 30,
    autoStart: 'fast',
    look: { felt: 'blue', cardBack: 'geo' },
    publicHud: true,
    mix: 'third',
    maxRuns: 2,
  }

  it('создаёт комнату так, как задано; стек null — закуп по умолчанию', () => {
    expect(quickRoomSettings(1000, ROOM)).toEqual({
      sb: 25,
      bb: 50,
      startingStack: 5000,
      cards: 'phones',
      game: 'omaha',
      limit: 'pot',
      turnSeconds: 30,
      autoStart: 'fast',
      felt: 'blue',
      cardBack: 'geo',
      format: 'cash',
      ante: 0,
      publicHud: true,
      mix: true,
      mixAgainst: 'third',
      maxRuns: 2,
    })
    expect(quickRoomSettings(1500, { ...ROOM, startingStack: null }).startingStack).toBe(1500)
    expect(quickRoomSettings(1000, null)).toEqual(quickRoomSettings(1000))
    expect(quickRoomChoice(null, 800)).toEqual({ ...QUICK_ROOM_DEFAULT, startingStack: 800 })
  })

  it('подпись под кнопкой показывает своё', () => {
    expect(quickRoomLine(quickRoomSettings(1000, ROOM))).toBe(
      'Омаха пот-лимит · кэш · карты на телефонах · блайнды 25/50 · стек 5 000 · ход 30 с'.replace(/ 000/, ' 000'),
    )
  })

  it('запас времени (#223): в настройки и подпись — только со временем на ход; из памяти без поля — выкл', () => {
    const banked: QuickRoom = { ...ROOM, turnSeconds: 20, timeBank: 30 }
    expect(quickRoomSettings(1000, banked)).toMatchObject({ turnSeconds: 20, timeBank: 30 })
    expect(quickRoomLine(quickRoomSettings(1000, banked))).toBe(
      'Омаха пот-лимит · кэш · карты на телефонах · блайнды 25/50 · стек 5 000 · ход 20 с · запас 30 с'.replace(/ 000/, ' 000'),
    )
    expect(quickRoomSettings(1000, ROOM)).not.toHaveProperty('timeBank')
    expect(quickRoomSettings(1000, { ...banked, turnSeconds: null })).not.toHaveProperty('timeBank')
    expect(parseQuickRoom(JSON.parse(JSON.stringify(banked)))).toEqual(banked)
    // Выбор, сохранённый до запаса (поля нет), — выкл; без времени на ход запаса нет
    const { timeBank: _b, ...old } = banked
    expect(parseQuickRoom(old)).toEqual({ ...banked, timeBank: null })
    expect(parseQuickRoom({ ...banked, turnSeconds: null })).toEqual({ ...banked, turnSeconds: null, timeBank: null })
    expect(parseQuickRoom({ ...banked, timeBank: 20 })).toBeNull()
  })

  it('сохранить нельзя: блайнды не годятся, стек меньше большого блайнда', () => {
    expect(quickRoomError({ sb: 5, bb: 10, startingStack: 1000 })).toBeNull()
    expect(quickRoomError({ sb: 10, bb: 10, startingStack: 10 })).toBeNull()
    expect(quickRoomError({ sb: 20, bb: 10, startingStack: 1000 })).toMatch(/Блайнды/)
    expect(quickRoomError({ sb: 0, bb: 10, startingStack: 1000 })).toMatch(/Блайнды/)
    expect(quickRoomError({ sb: 5, bb: 10, startingStack: 9 })).toBe('Стек — не меньше большого блайнда')
  })

  it('из памяти и копии: читается обратно без потерь; негодное — null', () => {
    expect(parseQuickRoom(JSON.parse(JSON.stringify(ROOM)))).toEqual(ROOM)
    expect(parseQuickRoom(QUICK_ROOM_DEFAULT)).toEqual(QUICK_ROOM_DEFAULT)
    const tournament = { ...ROOM, format: formSettings({ ...tournamentForm(4), format: 'tournament' }) }
    if (!tournament.format.ok) throw new Error('турнир по умолчанию не разбирается')
    const t = { ...ROOM, format: tournament.format.settings }
    expect(parseQuickRoom(JSON.parse(JSON.stringify(t)))).toEqual(t)
    // Без «Микса» и прогона (поля нет) — выкл
    const { mix: _m, maxRuns: _r, ...old } = ROOM
    expect(parseQuickRoom(old)).toEqual({ ...ROOM, mix: null, maxRuns: 1 })
    for (const bad of [
      { ...ROOM, sb: 60 },
      { ...ROOM, startingStack: 40 },
      { ...ROOM, variant: { game: 'stud', limit: 'pot' } },
      { ...ROOM, turnSeconds: 5 },
      { ...ROOM, look: { felt: 'pink', cardBack: 'geo' } },
      { ...ROOM, format: { format: 'cash', ante: -1 } },
      { ...ROOM, format: { format: 'tournament', tournament: {} } },
      { ...ROOM, mix: 'all' },
      null,
      {},
    ]) {
      expect(parseQuickRoom(bad)).toBeNull()
    }
  })

  it('своя игра (#224): сохраняется; в комнату — её описание и места по картам; её нет на телефоне — холдем', () => {
    const omaha7: OwnGame = { id: 'own-o7', name: 'Омаха-7', hole: 7, fromHand: 2, deck: 52, order: 'standard', board: [3, 1, 1], limit: 'pot' }
    const mine: OwnGame = { ...omaha7, id: 'own-h', name: 'Мой холдем', hole: 2, fromHand: 'any', limit: 'nolimit' }
    const room: QuickRoom = { ...ROOM, variant: { game: 'own-o7', limit: 'pot' }, mix: null }
    expect(parseQuickRoom(JSON.parse(JSON.stringify(room)))).toEqual(room)
    const s = quickRoomSettings(1000, room, [mine, omaha7])
    expect(s).toMatchObject({ cards: 'phones', game: 'own-o7', games: [omaha7], maxSeats: 6 })
    expect(s).not.toHaveProperty('limit')
    expect(createTable('h', 'H', s, 0).ok).toBe(true)
    expect(quickRoomLine(s)).toMatch(/^Омаха-7 пот-лимит · кэш · карты на телефонах · блайнды 25\/50 · стек 5.000 · ход 30 с$/)
    // С «Миксом» — все свои, выбранная первой; места — по самой «тесной»
    expect(quickRoomSettings(1000, { ...room, mix: 'half' }, [mine, omaha7])).toMatchObject({ games: [omaha7, mine], maxSeats: 6, mix: true })
    expect(quickRoomSettings(1000, { ...ROOM, mix: 'half' }, [mine])).toMatchObject({ game: 'omaha', games: [mine], maxSeats: 9 })
    // Своей игры на телефоне уже нет — холдем, без своих игр
    const gone = quickRoomSettings(1000, room, [mine])
    expect(gone).toMatchObject({ game: 'holdem' })
    expect(gone).not.toHaveProperty('games')
    expect(gone).not.toHaveProperty('maxSeats')
    expect(quickRoomLine(gone)).toMatch(/^Холдем · /)
    // Живые карты — своих игр нет
    expect(quickRoomSettings(1000, { ...room, cards: 'live' }, [omaha7])).toMatchObject({ game: 'holdem', cards: 'live' })
    expect(quickRoomSettings(1000, { ...room, cards: 'live' }, [omaha7])).not.toHaveProperty('games')
  })

  it('форма из разобранного выбора: formSettings возвращает то же', () => {
    const cash = { format: 'cash' as const, ante: 5 }
    expect(formSettings(tournamentFormOf(cash, 4))).toEqual({ ok: true, settings: cash })
    const own = formSettings({ ...tournamentForm(4), format: 'tournament', prizesOwn: true, prizes: ['70', '30'], rebuy: true, rebuyLevels: '3' })
    if (!own.ok) throw new Error(own.error)
    expect(formSettings(tournamentFormOf(own.settings, 4))).toEqual(own)
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
