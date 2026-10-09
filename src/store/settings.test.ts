import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { moveItem, playersFromNames, settingsWithDefaults, type Game, type Settings } from '../model'
import { getGame, getSettings, saveGame, saveSettings } from './db'

describe('настройки: умолчания (Р-07)', () => {
  it('записи нет — все умолчания', () => {
    expect(settingsWithDefaults(undefined)).toEqual({
      defaultRate: 0.5,
      players: [],
      quickAmounts: [500, 1000, 2000],
      defaultBuyin: 1000,
    })
  })

  it('старая запись без новых полей — курс свой, игроки, суммы и закуп по умолчанию', () => {
    expect(settingsWithDefaults({ defaultRate: 1 })).toEqual({
      defaultRate: 1,
      players: [],
      quickAmounts: [500, 1000, 2000],
      defaultBuyin: 1000,
    })
  })

  it('заданные поля не подменяются, в том числе пустые списки', () => {
    expect(
      settingsWithDefaults({ defaultRate: 0.25, players: ['Аня'], quickAmounts: [], defaultBuyin: 2000 }),
    ).toEqual({
      defaultRate: 0.25,
      players: ['Аня'],
      quickAmounts: [],
      defaultBuyin: 2000,
    })
  })

  it('умолчание сумм не делится между вызовами', () => {
    settingsWithDefaults().quickAmounts.push(7)
    expect(settingsWithDefaults().quickAmounts).toEqual([500, 1000, 2000])
  })

  it('из базы: запись прошлой версии читается с умолчаниями', async () => {
    await saveSettings({ defaultRate: 0.2 } as Settings)
    expect(await getSettings()).toEqual({
      defaultRate: 0.2,
      players: [],
      quickAmounts: [500, 1000, 2000],
      defaultBuyin: 1000,
    })
  })
})

describe('постоянные игроки и прошлые игры', () => {
  it('удаление и переименование постоянного игрока не трогают сохранённую игру', async () => {
    await saveSettings({ defaultRate: 0.5, players: ['Аня', 'Боря', 'Вера'], quickAmounts: [500], defaultBuyin: 1000 })
    const settings = await getSettings()
    let n = 0
    const game: Game = {
      id: 'g1',
      name: 'Пятница',
      date: '2026-10-09',
      rate: settings.defaultRate,
      players: playersFromNames(settings.players, () => `p${++n}`),
      entries: [{ id: 'e1', playerId: 'p2', kind: 'buyin', chips: 1000, at: '2026-10-09T20:00:00.000Z' }],
      updatedAt: '2026-10-09T20:00:00.000Z',
    }
    await saveGame(game)

    await saveSettings({ ...settings, players: ['Аня', 'Вера Н.'] })

    const stored = await getGame('g1')
    expect(stored?.players).toEqual([
      { id: 'p1', name: 'Аня' },
      { id: 'p2', name: 'Боря' },
      { id: 'p3', name: 'Вера' },
    ])
    expect(stored?.entries).toEqual(game.entries)
    expect((await getSettings()).players).toEqual(['Аня', 'Вера Н.'])
  })
})

describe('порядок в списках', () => {
  it('сдвиг вверх и вниз', () => {
    expect(moveItem([500, 1000, 2000], 2, -1)).toEqual([500, 2000, 1000])
    expect(moveItem(['А', 'Б', 'В'], 0, 1)).toEqual(['Б', 'А', 'В'])
  })

  it('за край — без изменений', () => {
    const list = [1, 2]
    expect(moveItem(list, 0, -1)).toBe(list)
    expect(moveItem(list, 1, 1)).toBe(list)
  })
})
