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
      { id: `${id}-a`, name: 'Аня', regularId: 'r-anya' },
      { id: `${id}-b`, name: 'Боря', regularId: 'r-borya' },
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

const ANYA = { id: 'r-anya', name: 'Аня' }
const BORYA = { id: 'r-borya', name: 'Боря' }
const SETTINGS: Settings = { defaultRate: 0.25, players: [ANYA, BORYA], quickAmounts: [500], defaultBuyin: 2000 }

function backupOf(games: Game[], settings: Settings = SETTINGS): Backup {
  return makeBackup(games, settings, NOW)
}

function ids() {
  let n = 0
  return () => `new${++n}`
}

const parse = (text: string) => parseBackup(text, ids())

// Копия формата 1 (до Р-12): игроки в настройках — строки, у участников нет regularId
function oldText(games: Game[], players: string[]): string {
  const plain = games.map((g) => ({ ...g, players: g.players.map(({ id, name }) => ({ id, name })) }))
  return JSON.stringify({ ...backupOf([]), format: 1, games: plain, settings: { ...SETTINGS, players } })
}

describe('файл-копия: сохранение (Р-11)', () => {
  it('все игры, кроме демо, и настройки; пометка приложения и версии', () => {
    const real = game('g1')
    const backup = backupOf([real, game('demo1', { demo: true }), game('g2')])
    expect(backup.app).toBe('magic_fishki')
    expect(backup.format).toBe(2)
    expect(backup.savedAt).toBe(NOW)
    expect(backup.games.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(backup.games[0]).toEqual(real)
    expect(backup.settings).toEqual(SETTINGS)
  })

  it('пустая база — копия с нулём игр', () => {
    const backup = backupOf([], settingsWithDefaults())
    expect(backup.games).toEqual([])
    const parsed = parse(backupText(backup))
    expect(parsed).toEqual({ ok: true, backup })
  })

  it('имя файла — по дню; для «Поделиться» — .txt', () => {
    expect(backupFileName('2026-10-14')).toBe('fishki-2026-10-14.json')
    expect(backupFileName('2026-10-14', 'txt')).toBe('fishki-2026-10-14.txt')
  })
})

describe('файл-копия: разбор', () => {
  it('текст копии читается обратно без потерь: id постоянных и связи участников', () => {
    const guest = { id: 'g2-c', name: 'Ира' }
    const g2 = game('g2', { closed: undefined, name: 'Суббота' })
    const backup = backupOf([game('g1'), { ...g2, players: [...g2.players, guest] }])
    expect(parse(backupText(backup))).toEqual({ ok: true, backup })
  })

  it('метка BOM в начале файла не мешает', () => {
    const backup = backupOf([game('g1')])
    expect(parse('﻿' + backupText(backup)).ok).toBe(true)
  })

  it('не JSON — ошибка', () => {
    const parsed = parse('Аня 1000, Боря 500')
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error).toMatch(/не копия «Фишек»/)
  })

  it('JSON другого приложения — ошибка', () => {
    expect(parse('{"games": []}')).toEqual({ ok: false, error: 'Это не копия «Фишек»' })
    expect(parse('[1, 2]')).toEqual({ ok: false, error: 'Это не копия «Фишек»' })
    expect(parse('null')).toEqual({ ok: false, error: 'Это не копия «Фишек»' })
  })

  it('копия из более новой версии — ошибка', () => {
    const text = JSON.stringify({ ...backupOf([]), format: 3 })
    expect(parse(text)).toEqual({ ok: false, error: 'Копия из более новой версии «Фишек» — обновите приложение' })
  })

  it('битая игра — ошибка с номером игры', () => {
    const broken = { ...game('g2'), entries: [{ id: 'e', playerId: 'p', kind: 'buyin', chips: -5, at: NOW }] }
    const text = JSON.stringify({ ...backupOf([]), games: [game('g1'), broken] })
    expect(parse(text)).toEqual({ ok: false, error: 'Копия повреждена: игра № 2 не читается' })
    const badLink = { ...game('g3'), players: [{ id: 'p', name: 'Аня', regularId: '' }] }
    expect(parse(JSON.stringify({ ...backupOf([]), games: [badLink] })).ok).toBe(false)
  })

  it('нет списка игр или настроек — ошибка', () => {
    const { games: _games, ...noGames } = backupOf([])
    expect(parse(JSON.stringify(noGames)).ok).toBe(false)
    const { settings: _settings, ...noSettings } = backupOf([])
    expect(parse(JSON.stringify(noSettings)).ok).toBe(false)
  })

  it('игроки не того вида для версии — ошибка', () => {
    const strings = { ...backupOf([]), settings: { ...SETTINGS, players: ['Аня'] } }
    expect(parse(JSON.stringify(strings))).toEqual({ ok: false, error: 'Копия повреждена: нет настроек' })
    const objects = { ...backupOf([]), format: 1 }
    expect(parse(JSON.stringify(objects))).toEqual({ ok: false, error: 'Копия повреждена: нет настроек' })
  })

  it('обрезанный файл — ошибка', () => {
    const text = backupText(backupOf([game('g1')]))
    expect(parse(text.slice(0, text.length / 2)).ok).toBe(false)
  })
})

describe('файл-копия прежней версии (формат 1): игроки и связи — по имени (Р-12)', () => {
  it('постоянным — новые id в прежнем порядке; участникам с тем же именем — связь, прочим — нет', () => {
    const g = game('g1', { players: [...game('g1').players, { id: 'g1-c', name: 'Ира' }] })
    const parsed = parse(oldText([g], ['Боря', ' Аня ', '', 'Боря']))
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.backup.format).toBe(2)
    expect(parsed.backup.settings.players).toEqual([
      { id: 'new1', name: 'Боря' },
      { id: 'new2', name: 'Аня' },
    ])
    expect(parsed.backup.games[0]).toEqual({
      ...g,
      players: [
        { id: 'g1-a', name: 'Аня', regularId: 'new2' },
        { id: 'g1-b', name: 'Боря', regularId: 'new1' },
        { id: 'g1-c', name: 'Ира' },
      ],
    })
  })

  it('на устройстве с теми же постоянными — связи на здешние id, список не растёт', () => {
    const parsed = parse(oldText([game('g1')], ['Аня', 'Боря', 'Вера']))
    if (!parsed.ok) throw new Error(parsed.error)
    const plan = planRestore([], [BORYA, ANYA], parsed.backup)
    expect(plan.players).toEqual([BORYA, ANYA, { id: 'new3', name: 'Вера' }])
    expect(plan.added[0].players.map((p) => p.regularId)).toEqual(['r-anya', 'r-borya'])
  })
})

describe('файл-копия: восстановление ничего не перезаписывает', () => {
  it('на пустом устройстве — добавляются все игры и игроки с их id', () => {
    const backup = backupOf([game('g1'), game('g2')])
    const plan = planRestore([], [], backup)
    expect(plan.added).toEqual(backup.games)
    expect(plan.existing).toBe(0)
    expect(plan.players).toEqual([ANYA, BORYA])
  })

  it('игры с тем же id остаются как есть, новых добавляется только недостающее', () => {
    const backup = backupOf([game('g1', { name: 'Из копии' }), game('g2'), game('g3')])
    const plan = planRestore(['g1', 'g3', 'g9'], [], backup)
    expect(plan.added.map((g) => g.id)).toEqual(['g2'])
    expect(plan.existing).toBe(2)
  })

  it('игроки из копии — в конец, без повторов по имени; порядок своих не меняется', () => {
    const players = [ANYA, { id: 'r-vera', name: 'Вера' }, { id: 'r-gosha', name: ' Гоша ' }, { id: 'r-x', name: '' }]
    const backup = backupOf([], { ...SETTINGS, players })
    const mine = [{ id: 'my-borya', name: 'Боря' }, { id: 'my-anya', name: 'Аня' }]
    expect(planRestore([], mine, backup).players).toEqual([...mine, { id: 'r-vera', name: 'Вера' }, { id: 'r-gosha', name: 'Гоша' }])
  })

  it('тот же постоянный уже есть по id, хоть и переименован, — остаётся свой, связи не меняются', () => {
    const backup = backupOf([game('g1')])
    const mine = [{ id: 'r-anya', name: 'Анна' }, BORYA]
    const plan = planRestore([], mine, backup)
    expect(plan.players).toEqual(mine)
    expect(plan.added).toEqual(backup.games)
  })

  it('постоянный с тем же именем, но другим id — один человек: связи в добавленных играх — на здешний id', () => {
    const backup = backupOf([game('g1'), game('g2')])
    const mine = [{ id: 'my-anya', name: 'Аня' }]
    const plan = planRestore(['g2'], mine, backup)
    expect(plan.players).toEqual([...mine, BORYA])
    expect(plan.added.map((g) => g.id)).toEqual(['g1'])
    expect(plan.added[0].players.map((p) => p.regularId)).toEqual(['my-anya', 'r-borya'])
    expect(plan.added[0].entries).toEqual(game('g1').entries)
  })

  it('копия с нулём игр ничего не меняет', () => {
    const backup = backupOf([], settingsWithDefaults())
    expect(planRestore(['g1'], [ANYA], backup)).toEqual({ added: [], existing: 0, players: [ANYA] })
  })
})
