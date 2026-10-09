import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createGame, type NewGame, type Settings } from '../model'
import { deleteGame, getGame, getSettings, listGames, saveGame, saveSettings } from './db'

const NOW = '2026-10-09T20:00:00.000Z'

function counter(): () => string {
  let n = 0
  return () => `id${++n}`
}

function input(over: Partial<NewGame> = {}): NewGame {
  return { name: 'Пятница', date: '2026-10-09', rate: 0.5, players: [], buyin: null, now: NOW, ...over }
}

describe('новая игра: закуп всем (Р-09)', () => {
  it('«Да» — у каждого участника один закуп на сумму из настроек, время — сейчас', async () => {
    await saveSettings({ defaultRate: 0.5, players: [], quickAmounts: [500], defaultBuyin: 2000 })
    const settings = await getSettings()
    const names = ['Аня', 'Боря', 'Вера', 'Гоша', 'Даша', 'Егор']
    const game = createGame(input({ players: names, buyin: settings.defaultBuyin }), counter())

    expect(game.players.map((p) => p.name)).toEqual(names)
    expect(game.entries).toHaveLength(6)
    for (const p of game.players) {
      const own = game.entries.filter((e) => e.playerId === p.id)
      expect(own).toEqual([{ id: expect.any(String), playerId: p.id, kind: 'buyin', chips: 2000, at: NOW }])
    }
    expect(new Set(game.entries.map((e) => e.id)).size).toBe(6)
  })

  it('нет поля в настройках — закуп 1000', async () => {
    await saveSettings({ defaultRate: 0.5 } as Settings)
    const settings = await getSettings()
    expect(settings.defaultBuyin).toBe(1000)
    const game = createGame(input({ players: ['Аня', 'Боря'], buyin: settings.defaultBuyin }), counter())
    expect(game.entries.map((e) => e.chips)).toEqual([1000, 1000])
  })

  it('«Нет» — игра без записей', () => {
    const game = createGame(input({ players: ['Аня', 'Боря'] }), counter())
    expect(game.players).toHaveLength(2)
    expect(game.entries).toEqual([])
  })

  it('поля игры — из ввода, id игры, участников и записей не совпадают', () => {
    const game = createGame(input({ players: ['Аня'], buyin: 500 }), counter())
    expect(game).toMatchObject({ name: 'Пятница', date: '2026-10-09', rate: 0.5, updatedAt: NOW })
    expect(new Set([game.id, game.players[0].id, game.entries[0].id]).size).toBe(3)
  })
})

describe('удаление игры (Р-09)', () => {
  it('удалённой игры нет в списке, остальные на месте', async () => {
    const make = counter()
    const keep = createGame(input({ name: 'Оставить', players: ['Аня'], buyin: 1000 }), make)
    const drop = createGame(input({ name: 'Тестовая', players: ['Боря'] }), make)
    await saveGame(keep)
    await saveGame(drop)
    expect((await listGames()).map((g) => g.id)).toContain(drop.id)

    await deleteGame(drop.id)

    const ids = (await listGames()).map((g) => g.id)
    expect(ids).not.toContain(drop.id)
    expect(ids).toContain(keep.id)
    expect(await getGame(drop.id)).toBeUndefined()
    expect((await getGame(keep.id))?.entries).toEqual(keep.entries)
  })
})
