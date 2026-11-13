import { describe, expect, it } from 'vitest'
import { settingsWithDefaults, type Game, type Settings } from '../model'
import type { SavedHand } from './evenings'
import {
  backupFileName,
  backupText,
  gamesSinceBackup,
  lastBackupText,
  makeBackup,
  mergePokerPrefs,
  parseBackup,
  planRestore,
  POKER_PREFS_NONE,
  type Backup,
} from './backup'
import { QUICK_ROOM_DEFAULT } from './quickRoom'

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
const SETTINGS: Settings = {
  defaultRate: 0.25,
  players: [ANYA, BORYA],
  quickAmounts: [500],
  defaultBuyin: 2000,
  compareWindow: 3,
}

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
    expect(backup.format).toBe(6)
    expect(backup.savedAt).toBe(NOW)
    expect(backup.hands).toEqual([])
    expect(backup.notes).toEqual({})
    expect(backup.noteLabels).toEqual({})
    expect(backup.look).toEqual({ felt: null, cardBack: null, deck: null })
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

  it('окно сравнения (Р-15): в копии есть и читается обратно; старая копия без него или с негодным — 5', () => {
    const backup = backupOf([])
    expect(JSON.parse(backupText(backup)).settings.compareWindow).toBe(3)
    const parsed = parse(backupText(backup))
    expect(parsed.ok && parsed.backup.settings.compareWindow).toBe(3)
    const { compareWindow: _w, ...old } = SETTINGS
    const withoutWindow = parse(JSON.stringify({ ...backup, settings: old }))
    expect(withoutWindow.ok && withoutWindow.backup.settings.compareWindow).toBe(5)
    const tooBig = parse(JSON.stringify({ ...backup, settings: { ...SETTINGS, compareWindow: 11 } }))
    expect(tooBig.ok && tooBig.backup.settings.compareWindow).toBe(5)
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
    const text = JSON.stringify({ ...backupOf([]), format: 7 })
    expect(parse(text)).toEqual({ ok: false, error: 'Копия из более новой версии «Фишек» — обновите приложение' })
  })

  it('битая игра — ошибка с номером игры', () => {
    const broken = { ...game('g2'), entries: [{ id: 'e', playerId: 'p', kind: 'buyin', chips: -5, at: NOW }] }
    const text = JSON.stringify({ ...backupOf([]), games: [game('g1'), broken] })
    expect(parse(text)).toEqual({ ok: false, error: 'Копия повреждена: игра № 2 не читается' })
    const badLink = { ...game('g3'), players: [{ id: 'p', name: 'Аня', regularId: '' }] }
    expect(parse(JSON.stringify({ ...backupOf([]), games: [badLink] })).ok).toBe(false)
  })

  it('раунды казино (Р-13): целые — восстанавливаются, раунд не в ноль — ошибка', () => {
    const amounts = [
      { playerId: 'p1', kopecks: 30000 },
      { playerId: 'p2', kopecks: -30000 },
    ]
    const withCasino = game('g1', { casino: [{ id: 'c1', amounts, at: NOW }] })
    const ok = parse(backupText(backupOf([withCasino])))
    expect(ok.ok && ok.backup.games[0].casino).toEqual(withCasino.casino)
    const notZero = game('g2', { casino: [{ id: 'c1', amounts: amounts.slice(0, 1), at: NOW }] })
    expect(parse(JSON.stringify({ ...backupOf([]), games: [notZero] })).ok).toBe(false)
    // Копия без поля — игра без казино
    const old = parse(backupText(backupOf([game('g3')])))
    expect(old.ok && old.backup.games[0].casino).toBeUndefined()
  })

  it('режим игры (Р-29): с режимом и без — читаются, чужое значение — ошибка; формат тот же', () => {
    const casinoOnly = game('g1', { entries: [], mode: 'casino' })
    const mixed = game('g2', { mode: 'mixed' })
    const parsed = parse(backupText(backupOf([casinoOnly, mixed, game('g3')])))
    expect(parsed.ok && parsed.backup.format).toBe(6)
    expect(parsed.ok && parsed.backup.games.map((g) => g.mode)).toEqual(['casino', 'mixed', undefined])
    const bad = { ...game('g4'), mode: 'bingo' }
    expect(parse(JSON.stringify({ ...backupOf([]), games: [bad] })).ok).toBe(false)
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
    expect(parsed.backup.format).toBe(6)
    expect(parsed.backup.hands).toEqual([])
    expect(parsed.backup.notes).toEqual({})
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
    expect(planRestore(['g1'], [ANYA], backup)).toEqual({ added: [], existing: 0, players: [ANYA], hands: [] })
  })
})

// Раздачи прошлых вечеров покера в копии (Р-54)
describe('файл-копия формата 3: раздачи', () => {
  function record(evening: string, number: number): SavedHand {
    return {
      evening,
      code: 'KQ7MZP',
      startedAt: 1000,
      number,
      hand: { number, pots: [{ amount: 100, winners: ['p0'] }], payouts: { p0: 100 } },
      mine: ['As', 'Kd'],
    }
  }

  it('раздачи — в копии и читаются обратно без потерь', () => {
    const backup = makeBackup([game('g1')], SETTINGS, NOW, [record('E1', 1), record('E1', 2)])
    expect(backup.hands).toHaveLength(2)
    expect(parse(backupText(backup))).toEqual({ ok: true, backup })
  })

  it('копия формата 2 (без раздач) читается как раньше — раздач нет, без ошибки', () => {
    const { hands: _h, ...old } = backupOf([game('g1')])
    const parsed = parse(JSON.stringify({ ...old, format: 2 }))
    expect(parsed).toEqual({ ok: true, backup: backupOf([game('g1')]) })
  })

  it('формат 3 без списка раздач или с битой раздачей — ошибка с номером', () => {
    const { hands: _h, ...noHands } = backupOf([])
    expect(parse(JSON.stringify(noHands))).toEqual({ ok: false, error: 'Копия повреждена: нет списка раздач' })
    const broken = { ...record('E1', 2), hand: { ...record('E1', 2).hand, number: 7 } }
    const text = JSON.stringify(makeBackup([], SETTINGS, NOW, [record('E1', 1), broken as SavedHand]))
    expect(parse(text)).toEqual({ ok: false, error: 'Копия повреждена: раздача № 2 не читается' })
  })

  it('восстановление: раздачи, которых нет по «вечер + номер», добавляются; записанные — не трогаются', () => {
    const backup = makeBackup([], SETTINGS, NOW, [record('E1', 1), record('E1', 2), record('E2', 1)])
    const plan = planRestore([], [], backup, [['E1', 1]])
    expect(plan.hands).toEqual([record('E1', 2), record('E2', 1)])
  })
})

// Заметки об игроках и подписи цветов в копии (Р-56)
describe('файл-копия формата 4: заметки', () => {
  const NOTES = { Аня: { color: 'green' as const, text: 'зовёт всё' }, Боря: { color: null, text: 'блефует на ривере' } }
  const LABELS = { red: 'агро' }

  it('заметки и подписи — в копии и читаются обратно без потерь', () => {
    const backup = makeBackup([game('g1')], SETTINGS, NOW, [], NOTES, LABELS)
    const text = backupText(backup)
    expect(JSON.parse(text).notes).toEqual(NOTES)
    expect(JSON.parse(text).noteLabels).toEqual(LABELS)
    expect(parse(text)).toEqual({ ok: true, backup })
  })

  it('копия формата 3 (без заметок) читается как раньше — заметок нет, без ошибки', () => {
    const { notes: _n, noteLabels: _l, ...old } = backupOf([game('g1')])
    const parsed = parse(JSON.stringify({ ...old, format: 3 }))
    expect(parsed).toEqual({ ok: true, backup: backupOf([game('g1')]) })
  })

  it('формат 4 без заметок или с битой заметкой — ошибка; данные не меняются', () => {
    const { notes: _n, ...noNotes } = backupOf([])
    expect(parse(JSON.stringify(noNotes))).toEqual({ ok: false, error: 'Копия повреждена: заметки об игроках не читаются' })
    const badColor = { ...backupOf([]), notes: { Аня: { color: 'pink', text: '' } } }
    expect(parse(JSON.stringify(badColor)).ok).toBe(false)
    const { noteLabels: _l, ...noLabels } = backupOf([])
    expect(parse(JSON.stringify(noLabels))).toEqual({
      ok: false,
      error: 'Копия повреждена: подписи цветов заметок не читаются',
    })
  })
})

// Личный «Вид стола» в копии (Р-61)
describe('файл-копия формата 5: вид стола', () => {
  const LOOK = { felt: 'navy' as const, cardBack: 'chip' as const, deck: 'four' as const }

  it('выбор вида — в копии и читается обратно без потерь', () => {
    const backup = makeBackup([game('g1')], SETTINGS, NOW, [], {}, {}, LOOK)
    const text = backupText(backup)
    expect(JSON.parse(text).look).toEqual(LOOK)
    expect(parse(text)).toEqual({ ok: true, backup })
  })

  it('копия формата 4 (без вида) читается как раньше — «Как у стола», колода не выбрана', () => {
    const { look: _l, ...old } = makeBackup([game('g1')], SETTINGS, NOW, [], {}, {}, LOOK)
    const parsed = parse(JSON.stringify({ ...old, format: 4 }))
    expect(parsed).toEqual({ ok: true, backup: backupOf([game('g1')]) })
    expect(parsed.ok && parsed.backup.look.deck).toBeNull()
  })

  it('формат 5: вида нет или значение не из готовых — «Как у стола», колода не выбрана, копия читается', () => {
    const { look: _l, ...noLook } = backupOf([])
    const parsed = parse(JSON.stringify(noLook))
    expect(parsed.ok && parsed.backup.look).toEqual({ felt: null, cardBack: null, deck: null })
    const odd = parse(JSON.stringify({ ...backupOf([]), look: { felt: 'pink', cardBack: 'dark', deck: 'six' } }))
    expect(odd.ok && odd.backup.look).toEqual({ felt: null, cardBack: 'dark', deck: null })
  })

  it('колода не выбрана — в копии null и читается обратно так же; «две масти» — как записаны (#192)', () => {
    const none = makeBackup([], SETTINGS, NOW)
    expect(JSON.parse(backupText(none)).look.deck).toBeNull()
    expect(parse(backupText(none))).toEqual({ ok: true, backup: none })
    const two = makeBackup([], SETTINGS, NOW, [], {}, {}, { felt: null, cardBack: null, deck: 'two' })
    const parsed = parse(backupText(two))
    expect(parsed.ok && parsed.backup.look.deck).toBe('two')
    expect(parsed.ok && parsed.backup.format).toBe(6)
  })
})

// Покер-рум телефона в копии (Р-62): своя «Быстрая комната», показ в ББ, быстрые ставки
describe('файл-копия формата 6: покер-рум', () => {
  const ROOM = { ...QUICK_ROOM_DEFAULT, sb: 25, bb: 50, startingStack: 5000, variant: { game: 'omaha' as const, limit: 'pot' as const } }
  const POKER = {
    quickRoom: ROOM,
    bigBlinds: true,
    quickBets: { pot: [50, 100], pre: [20, 35] },
    tableSize: 85,
    dockSize: 'large' as const,
    betStep: 'half' as const,
  }

  it('всё — в копии и читается обратно без потерь', () => {
    const backup = makeBackup([game('g1')], SETTINGS, NOW, [], {}, {}, undefined, POKER)
    const text = backupText(backup)
    expect(JSON.parse(text).poker).toEqual(POKER)
    expect(parse(text)).toEqual({ ok: true, backup })
  })

  it('копия формата 5 (без покер-рума) читается — ничего не задано', () => {
    const { poker: _p, ...old } = makeBackup([game('g1')], SETTINGS, NOW, [], {}, {}, undefined, POKER)
    const parsed = parse(JSON.stringify({ ...old, format: 5 }))
    expect(parsed).toEqual({ ok: true, backup: backupOf([game('g1')]) })
    expect(parsed.ok && parsed.backup.poker).toEqual(POKER_PREFS_NONE)
  })

  it('негодное значение — не задано, копия читается', () => {
    const odd = {
      quickRoom: { ...ROOM, startingStack: 10 },
      bigBlinds: 'да',
      quickBets: { pot: [0], pre: [] },
      tableSize: 120,
      dockSize: 'huge',
      betStep: 3,
    }
    const parsed = parse(JSON.stringify({ ...backupOf([]), poker: odd }))
    expect(parsed.ok && parsed.backup.poker).toEqual(POKER_PREFS_NONE)
  })

  it('восстановление: из копии — то, что здесь не задано; своё остаётся', () => {
    const local = { ...POKER_PREFS_NONE, bigBlinds: false, dockSize: 'small' as const }
    expect(mergePokerPrefs(local, POKER)).toEqual({
      quickRoom: ROOM,
      bigBlinds: false,
      quickBets: POKER.quickBets,
      tableSize: 85,
      dockSize: 'small',
      betStep: 'half',
    })
    // Шаг колеса (Р-69): выбранный здесь «1 ББ» копия не перезаписывает
    expect(mergePokerPrefs({ ...POKER_PREFS_NONE, betStep: 'bb' }, POKER).betStep).toBe('bb')
    expect(mergePokerPrefs(POKER_PREFS_NONE, POKER_PREFS_NONE)).toEqual(POKER_PREFS_NONE)
  })

  // Р-63: размер стола и панели — в том же формате 6; копия 6 без них (до Р-63) читается — не заданы
  it('копия формата 6 без размера стола и панели — они не заданы, остальное на месте', () => {
    const { tableSize: _t, dockSize: _d, betStep: _s, ...before } = POKER
    const parsed = parse(JSON.stringify({ ...backupOf([]), poker: before }))
    expect(parsed.ok && parsed.backup.poker).toEqual({ ...before, tableSize: null, dockSize: null, betStep: null })
  })

  // Р-69: шаг колеса и «−»/«+» — в том же формате 6; копия без него читается — не задан (1 ББ)
  it('копия формата 6 без шага колеса — он не задан, остальное на месте', () => {
    const { betStep: _s, ...before } = POKER
    const parsed = parse(JSON.stringify({ ...backupOf([]), poker: before }))
    expect(parsed.ok && parsed.backup.poker).toEqual({ ...before, betStep: null })
  })
})

describe('когда была последняя копия', () => {
  const LAST = { at: '2026-10-10T09:00:00.000Z', date: '2026-10-10' }

  it('копии не было', () => {
    expect(lastBackupText(null, [game('g1')], '2026-10-22')).toBe('Копию на этом устройстве ещё не делали')
  })

  it('только что: сегодня, игр после неё — 0', () => {
    expect(lastBackupText(LAST, [game('g1')], '2026-10-10')).toBe('Последняя копия — сегодня · игр после неё: 0')
  })

  it('считает игры, заведённые или изменённые после копии, без демо', () => {
    const games = [
      game('old'),
      game('new', { updatedAt: '2026-10-11T20:00:00.000Z' }),
      game('closed', { updatedAt: '2026-10-12T23:00:00.000Z' }),
      game('demo', { demo: true, updatedAt: '2026-10-12T23:00:00.000Z' }),
    ]
    expect(gamesSinceBackup(games, LAST)).toBe(2)
    expect(lastBackupText(LAST, games, '2026-10-22')).toBe('Последняя копия — 12 дней назад · игр после неё: 2')
  })

  it('дни — по календарю, со склонением', () => {
    const at = (today: string) => lastBackupText(LAST, [], today)
    expect(at('2026-10-11')).toBe('Последняя копия — вчера · игр после неё: 0')
    expect(at('2026-10-12')).toBe('Последняя копия — 2 дня назад · игр после неё: 0')
    expect(at('2026-10-15')).toBe('Последняя копия — 5 дней назад · игр после неё: 0')
    expect(at('2026-10-31')).toBe('Последняя копия — 21 день назад · игр после неё: 0')
    expect(at('2026-11-21')).toBe('Последняя копия — 42 дня назад · игр после неё: 0')
  })

  it('часы телефона ушли назад — «сегодня», а не минус дни', () => {
    expect(lastBackupText(LAST, [], '2026-10-09')).toBe('Последняя копия — сегодня · игр после неё: 0')
  })
})
