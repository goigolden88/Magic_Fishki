import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { moveItem, playersFromRegulars, settingsWithDefaults, type Game, type Settings } from '../model'
import { getGame, getSettings, saveGame, saveSettings } from './db'

describe('настройки: умолчания (Р-07)', () => {
  it('записи нет — все умолчания', () => {
    expect(settingsWithDefaults(undefined)).toEqual({
      defaultRate: 0.5,
      players: [],
      quickAmounts: [500, 1000, 2000],
      defaultBuyin: 1000,
      compareWindow: 5,
    })
  })

  it('старая запись без новых полей — курс свой, игроки, суммы, закуп и окно по умолчанию', () => {
    expect(settingsWithDefaults({ defaultRate: 1 })).toEqual({
      defaultRate: 1,
      players: [],
      quickAmounts: [500, 1000, 2000],
      defaultBuyin: 1000,
      compareWindow: 5,
    })
  })

  it('заданные поля не подменяются, в том числе пустые списки', () => {
    expect(
      settingsWithDefaults({
        defaultRate: 0.25,
        players: [{ id: 'r1', name: 'Аня' }],
        quickAmounts: [],
        defaultBuyin: 2000,
        compareWindow: 3,
      }),
    ).toEqual({
      defaultRate: 0.25,
      players: [{ id: 'r1', name: 'Аня' }],
      quickAmounts: [],
      defaultBuyin: 2000,
      compareWindow: 3,
    })
  })

  it('окно сравнения (Р-15): от 3 до 10 целым, иначе — 5', () => {
    const windowOf = (compareWindow: unknown) => settingsWithDefaults({ compareWindow } as Partial<Settings>).compareWindow
    expect([3, 7, 10].map(windowOf)).toEqual([3, 7, 10])
    expect([2, 11, 0, -5, 4.5, '4', null, NaN].map(windowOf)).toEqual([5, 5, 5, 5, 5, 5, 5, 5])
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
      compareWindow: 5,
    })
  })

  it('из базы: окно сравнения сохраняется и читается обратно', async () => {
    await saveSettings({ ...(await getSettings()), compareWindow: 8 })
    expect((await getSettings()).compareWindow).toBe(8)
  })
})

describe('постоянные игроки и прошлые игры', () => {
  it('удаление и переименование постоянного игрока не трогают сохранённую игру; связь по id остаётся (Р-12)', async () => {
    const [anya, borya, vera] = [
      { id: 'r1', name: 'Аня' },
      { id: 'r2', name: 'Боря' },
      { id: 'r3', name: 'Вера' },
    ]
    await saveSettings({
      defaultRate: 0.5,
      players: [anya, borya, vera],
      quickAmounts: [500],
      defaultBuyin: 1000,
      compareWindow: 5,
    })
    const settings = await getSettings()
    let n = 0
    const game: Game = {
      id: 'g1',
      name: 'Пятница',
      date: '2026-10-09',
      rate: settings.defaultRate,
      players: playersFromRegulars(settings.players, () => `p${++n}`),
      entries: [{ id: 'e1', playerId: 'p2', kind: 'buyin', chips: 1000, at: '2026-10-09T20:00:00.000Z' }],
      updatedAt: '2026-10-09T20:00:00.000Z',
    }
    await saveGame(game)

    // Как «Настройки»: переименование — то же id, новое имя; удаление — без записи
    await saveSettings({ ...settings, players: [anya, { ...vera, name: 'Вера Н.' }] })

    const stored = await getGame('g1')
    expect(stored?.players).toEqual([
      { id: 'p1', name: 'Аня', regularId: 'r1' },
      { id: 'p2', name: 'Боря', regularId: 'r2' },
      { id: 'p3', name: 'Вера', regularId: 'r3' },
    ])
    expect(stored?.entries).toEqual(game.entries)
    expect((await getSettings()).players).toEqual([
      { id: 'r1', name: 'Аня' },
      { id: 'r3', name: 'Вера Н.' },
    ])
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
