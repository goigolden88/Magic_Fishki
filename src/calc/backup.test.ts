import { describe, expect, it } from 'vitest'
import { settingsWithDefaults, type Game, type Settings } from '../model'
import { backupFileName, backupText, makeBackup, parseBackup, planRestore, type Backup } from './backup'

const NOW = '2026-10-14T19:00:00.000Z'

function game(id: string, over: Partial<Game> = {}): Game {
  return {
    id,
    name: 'Пятница',
    date: '2026-10-09',
    rate: 0.5,
    players: [
      { id: `${id}-a`, name: 'Аня' },
      { id: `${id}-b`, name: 'Боря' },
    ],
    entries: [
      { id: `${id}-1`, playerId: `${id}-a`, kind: 'buyin', chips: 1000, at: '2026-10-09T20:00:00.000Z' },
      { id: `${id}-2`, playerId: `${id}-b`, kind: 'buyin', chips: 1000, at: '2026-10-09T20:00:00.000Z' },
      { id: `${id}-3`, playerId: `${id}-a`, kind: 'cashout', chips: 1500, at: '2026-10-09T23:00:00.000Z' },
      { id: `${id}-4`, playerId: `${id}-b`, kind: 'cashout', chips: 500, at: '2026-10-09T23:00:00.000Z' },
    ],
    closed: true,
    updatedAt: '2026-10-10T08:00:00.000Z',
    ...over,
  }
}

const SETTINGS: Settings = { defaultRate: 0.25, players: ['Аня', 'Боря'], quickAmounts: [500], defaultBuyin: 2000 }

function backupOf(games: Game[], settings: Settings = SETTINGS): Backup {
  return makeBackup(games, settings, NOW)
}

describe('файл-копия: сохранение (Р-11)', () => {
  it('все игры, кроме демо, и настройки; пометка приложения и версии', () => {
    const real = game('g1')
    const backup = backupOf([real, game('demo1', { demo: true }), game('g2')])
    expect(backup.app).toBe('magic_fishki')
    expect(backup.format).toBe(1)
    expect(backup.savedAt).toBe(NOW)
    expect(backup.games.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(backup.games[0]).toEqual(real)
    expect(backup.settings).toEqual(SETTINGS)
  })

  it('пустая база — копия с нулём игр', () => {
    const backup = backupOf([], settingsWithDefaults())
    expect(backup.games).toEqual([])
    const parsed = parseBackup(backupText(backup))
    expect(parsed).toEqual({ ok: true, backup })
  })

  it('имя файла — по дню; для «Поделиться» — .txt', () => {
    expect(backupFileName('2026-10-14')).toBe('fishki-2026-10-14.json')
    expect(backupFileName('2026-10-14', 'txt')).toBe('fishki-2026-10-14.txt')
  })
})

describe('файл-копия: разбор', () => {
  it('текст копии читается обратно без потерь', () => {
    const backup = backupOf([game('g1'), game('g2', { closed: undefined, name: 'Суббота' })])
    expect(parseBackup(backupText(backup))).toEqual({ ok: true, backup })
  })

  it('метка BOM в начале файла не мешает', () => {
    const backup = backupOf([game('g1')])
    expect(parseBackup('﻿' + backupText(backup)).ok).toBe(true)
  })

  it('не JSON — ошибка', () => {
    const parsed = parseBackup('Аня 1000, Боря 500')
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error).toMatch(/не копия «Фишек»/)
  })

  it('JSON другого приложения — ошибка', () => {
    expect(parseBackup('{"games": []}')).toEqual({ ok: false, error: 'Это не копия «Фишек»' })
    expect(parseBackup('[1, 2]')).toEqual({ ok: false, error: 'Это не копия «Фишек»' })
    expect(parseBackup('null')).toEqual({ ok: false, error: 'Это не копия «Фишек»' })
  })

  it('копия из более новой версии — ошибка', () => {
    const text = JSON.stringify({ ...backupOf([]), format: 2 })
    expect(parseBackup(text)).toEqual({ ok: false, error: 'Копия из более новой версии «Фишек» — обновите приложение' })
  })

  it('битая игра — ошибка с номером игры', () => {
    const broken = { ...game('g2'), entries: [{ id: 'e', playerId: 'p', kind: 'buyin', chips: -5, at: NOW }] }
    const text = JSON.stringify({ ...backupOf([]), games: [game('g1'), broken] })
    expect(parseBackup(text)).toEqual({ ok: false, error: 'Копия повреждена: игра № 2 не читается' })
  })

  it('нет списка игр или настроек — ошибка', () => {
    const { games: _games, ...noGames } = backupOf([])
    expect(parseBackup(JSON.stringify(noGames)).ok).toBe(false)
    const { settings: _settings, ...noSettings } = backupOf([])
    expect(parseBackup(JSON.stringify(noSettings)).ok).toBe(false)
  })

  it('обрезанный файл — ошибка', () => {
    const text = backupText(backupOf([game('g1')]))
    expect(parseBackup(text.slice(0, text.length / 2)).ok).toBe(false)
  })
})

describe('файл-копия: восстановление ничего не перезаписывает', () => {
  it('на пустом устройстве — добавляются все игры и игроки', () => {
    const backup = backupOf([game('g1'), game('g2')])
    const plan = planRestore([], [], backup)
    expect(plan.added).toEqual(backup.games)
    expect(plan.existing).toBe(0)
    expect(plan.players).toEqual(['Аня', 'Боря'])
  })

  it('игры с тем же id остаются как есть, новых добавляется только недостающее', () => {
    const backup = backupOf([game('g1', { name: 'Из копии' }), game('g2'), game('g3')])
    const plan = planRestore(['g1', 'g3', 'g9'], [], backup)
    expect(plan.added.map((g) => g.id)).toEqual(['g2'])
    expect(plan.existing).toBe(2)
  })

  it('игроки из копии — в конец, без повторов по имени; порядок своих не меняется', () => {
    const backup = backupOf([], { ...SETTINGS, players: ['Аня', 'Вера', ' Гоша ', 'Вера', ''] })
    expect(planRestore([], ['Боря', 'Аня'], backup).players).toEqual(['Боря', 'Аня', 'Вера', 'Гоша'])
  })

  it('копия с нулём игр ничего не меняет', () => {
    const backup = backupOf([], settingsWithDefaults())
    expect(planRestore(['g1'], ['Аня'], backup)).toEqual({ added: [], existing: 0, players: ['Аня'] })
  })
})
