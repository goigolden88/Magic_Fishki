import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { backupText, makeBackup, parseBackup, planRestore } from '../calc/backup'
import { playerTotals } from '../calc/totals'
import { transfers } from '../calc/transfers'
import type { Game } from '../model'
import { deleteGame, getSettings, listGames, restoreGames, saveGame, saveSettings } from './db'

function game(id: string, date: string, names: string[], rows: [number, number][]): Game {
  const players = names.map((name, i) => ({ id: `${id}-p${i}`, name }))
  const entries = rows.flatMap(([buyin, cashout], i) => [
    { id: `${id}-in${i}`, playerId: `${id}-p${i}`, kind: 'buyin' as const, chips: buyin, at: `${date}T19:00:00.000Z` },
    ...(cashout > 0
      ? [{ id: `${id}-out${i}`, playerId: `${id}-p${i}`, kind: 'cashout' as const, chips: cashout, at: `${date}T23:00:00.000Z` }]
      : []),
  ])
  return { id, name: 'Пятница', date, rate: 0.5, players, entries, closed: true, updatedAt: `${date}T23:30:00.000Z` }
}

// Сохранить копию → «очистить данные» → восстановить, как это делает экран «Настройки»
async function restore(text: string) {
  const parsed = parseBackup(text)
  if (!parsed.ok) throw new Error(parsed.error)
  const settings = await getSettings()
  const plan = planRestore(
    (await listGames()).map((g) => g.id),
    settings.players,
    parsed.backup,
  )
  await restoreGames(plan.added)
  await saveSettings({ ...settings, players: plan.players })
  return plan
}

async function clearAll() {
  for (const g of await listGames()) await deleteGame(g.id)
  await saveSettings({ defaultRate: 0.5, players: [], quickAmounts: [500, 1000, 2000], defaultBuyin: 1000 })
}

describe('файл-копия через базу (Р-11)', () => {
  it('после очистки — те же игры, записи, итоги, переводы и время правки; игроки в настройках', async () => {
    const g1 = await saveGame(game('01A', '2026-10-02', ['Аня', 'Боря', 'Вера'], [[1000, 2500], [1000, 0], [1000, 500]]))
    const g2 = await saveGame(game('01B', '2026-10-09', ['Гоша', 'Даша'], [[2000, 1000], [2000, 3000]]))
    await saveGame({ ...game('01C', '2026-10-09', ['Демо'], [[500, 500]]), demo: true })
    await saveSettings({ defaultRate: 0.25, players: ['Аня', 'Боря'], quickAmounts: [500], defaultBuyin: 2000 })

    const before = (await listGames()).filter((g) => !g.demo)
    const text = backupText(makeBackup(await listGames(), await getSettings(), '2026-10-14T19:00:00.000Z'))

    await clearAll()
    expect(await listGames()).toEqual([])

    const plan = await restore(text)
    expect(plan).toMatchObject({ existing: 0 })
    expect(plan.added).toHaveLength(2)

    const after = await listGames()
    expect(after).toEqual(before)
    expect(after.map((g) => g.updatedAt)).toEqual([g2.updatedAt, g1.updatedAt])
    for (const [a, b] of after.map((g, i) => [g, before[i]])) {
      const ta = playerTotals(a.players, a.entries, a.rate)
      expect(ta).toEqual(playerTotals(b.players, b.entries, b.rate))
      expect(transfers(ta, a.rate)).toEqual(transfers(playerTotals(b.players, b.entries, b.rate), b.rate))
    }
    expect((await getSettings()).players).toEqual(['Аня', 'Боря'])
  })

  it('на устройстве с играми: своё не перезаписывается, недостающее добавляется', async () => {
    await clearAll()
    const mine = await saveGame({ ...game('02A', '2026-10-09', ['Аня'], [[1000, 1000]]), name: 'Своя правка' })
    await saveGame(game('02X', '2026-10-01', ['Ира'], [[1000, 1000]]))
    await saveSettings({ ...(await getSettings()), players: ['Ира'], defaultRate: 1 })

    const other = makeBackup(
      [
        { ...game('02A', '2026-10-09', ['Аня'], [[1000, 1000]]), name: 'Старое имя' },
        game('02B', '2026-10-10', ['Боря'], [[500, 500]]),
      ],
      { defaultRate: 0.1, players: ['Боря', 'Ира'], quickAmounts: [], defaultBuyin: 5 },
      '2026-10-14T19:00:00.000Z',
    )
    const plan = await restore(backupText(other))
    expect(plan.added.map((g) => g.id)).toEqual(['02B'])
    expect(plan.existing).toBe(1)

    const games = await listGames()
    expect(games.map((g) => g.id)).toEqual(['02B', '02A', '02X'])
    expect(games.find((g) => g.id === '02A')).toEqual(mine)
    const settings = await getSettings()
    expect(settings.players).toEqual(['Ира', 'Боря'])
    expect(settings.defaultRate).toBe(1)
    expect(settings.quickAmounts).toEqual([500, 1000, 2000])
  })

  it('копия пустой базы ничего не стирает', async () => {
    await clearAll()
    const empty = backupText(makeBackup(await listGames(), await getSettings(), '2026-10-14T19:00:00.000Z'))
    const kept = await saveGame(game('03A', '2026-10-09', ['Аня'], [[1000, 1000]]))

    const plan = await restore(empty)
    expect(plan).toEqual({ added: [], existing: 0, players: [] })
    expect(await listGames()).toEqual([kept])
  })
})
